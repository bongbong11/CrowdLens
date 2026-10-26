import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadOriginalCatalog } from '../server-plugin/original-catalog.mjs';
import { createService } from '../server-plugin/service.mjs';
import { rootFor, read, write, profileFile, chatFile, jobFile } from '../server-plugin/storage.mjs';
import { selectConnection, invokeChatRouter, makeGenerator } from '../server-plugin/model-bridge.mjs';
import { capture } from '../src/engine.js';
import { importPlatforms } from '../src/core.js';
const DEFAULT_PLATFORMS = importPlatforms(JSON.parse(await fs.readFile(new URL('../prompts/community-reactions.json', import.meta.url), 'utf8')));
const LEGACY_DEFAULT_PLATFORMS = ['x', 'instagram', 'reddit', 'community'].map(id => ({ id, name: id, style: 'board', prompt: 'Old example.' }));

const person = { name: 'Hunter', occupation: 'Professional player', recognition: 'Public figure', reputation: 'Calm', acquaintanceView: 'Friendly', publicInfo: 'Playing career' };
const modelProfile = JSON.stringify({ character: person, persona: { ...person, name: 'Jamie', occupation: 'Office worker' } });
function modelOutput(options) {
    if (options.systemPrompt.startsWith('Summarize')) return modelProfile;
    if (options.systemPrompt.startsWith('Translate these')) return JSON.stringify({ posts: JSON.parse(options.prompt).posts.map(() => ({ title: '', body: '그 마이크는 누가 계속 주는 거야. 반대는 안 해.' })) });
    const plans = JSON.parse(options.prompt).platforms;
    return JSON.stringify({ feeds: plans.map(plan => ({ platform: plan.id, posts: Object.entries(plan.slots || { public: plan.count }).flatMap(([group, n]) => Array.from({ length: n }, (_, i) => ({ author: `viewer${i}`, group, region: 'us', culture: 'international', body: 'Who keeps handing this man a microphone. I am not complaining.' }))) })) });
}
const jevFetch = async (_url, options) => {
    const questions = JSON.parse(options.body).questions;
    return { ok: true, json: async () => ({ answers: Object.fromEntries(Object.keys(questions).map(key => [key, { noul: key === 'visible' || /^p\d+$/.test(key) || key.endsWith('_public') ? .95 : .1 }])) }) };
};
async function fixture(t, options = {}) {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'crowdlens-test-'));
    t.after(async () => {
        await service.close();
        const target = path.resolve(base), prefix = path.resolve(os.tmpdir()) + path.sep + 'crowdlens-test-';
        if (!target.startsWith(prefix)) throw new Error('Unsafe test cleanup path');
        await fs.rm(target, { recursive: true, force: true });
    });
    const userRoot = path.join(base, 'accountA'); await fs.mkdir(userRoot);
    const request = { user: { directories: { root: userRoot }, profile: { handle: 'accountA' } } };
    const service = createService({ fetchImpl: jevFetch, generateFactory: async () => async options => modelOutput(options), ...options });
    const ctx = { characterId: 0, characters: [{ avatar: 'hunter.png', name: 'Hunter', description: 'A professional player.' }], chatId: 'chatA', name1: 'Jamie', powerUserSettings: { persona_description: 'An office worker.' }, chat: [{ name: 'Hunter', mes: 'A public interview was broadcast.', swipe_id: 0 }] };
    const initial = await service.bootstrap(request);
    const config = { ...initial.settings, enabled: true, platforms: [initial.settings.platforms[0]] };
    const saved = await service.updateSettings(request, { revision: initial.revision, settings: config });
    await service.saveKey(request, { provider: 'typesafe', key: 'test-jev-secret' });
    const snapshot = capture(ctx, { ...config, profiles: {}, results: {} }, 0);
    return { base, request, service, config, revision: saved.revision, snapshot, ctx, root: await rootFor(request) };
}
async function finish(service, request, id) {
    for (let attempt = 0; attempt < 100; attempt++) {
        const data = await service.status(request, id);
        if (!['queued', 'running'].includes(data.job.status)) return data.job;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Test job did not finish');
}
test('server keeps config, keys, profiles and chat data in separate per-user files; keys never returned', async t => {
    const f = await fixture(t);
    const data = await f.service.bootstrap(f.request);
    assert.equal(data.keyStatuses.typesafe, true);
    assert.equal(JSON.stringify(data).includes('test-jev-secret'), false);
    assert.deepEqual(Object.keys(data.keyStatuses).sort(), ['nanogpt', 'typesafe']);
    assert.equal((await read(f.root, 'secrets.json')).typesafe, 'test-jev-secret');
    assert.equal((await read(f.root, 'settings.json')).settings.profiles, undefined);
    await assert.rejects(f.service.saveKey(f.request, { provider: 'openrouter', key: 'not-allowed' }));
});
test('migration is durable, scoped, backed up and idempotent without editing ST settings', async t => {
    const f = await fixture(t);
    const otherRoot = path.join(f.base, 'legacyAccount'); await fs.mkdir(otherRoot);
    const request = { user: { directories: { root: otherRoot } } };
    const old = { ...f.config, version: 1, profiles: { [f.snapshot.profileKey]: { sourceHash: f.snapshot.sourceHash, profile: { character: person, persona: person } } }, results: { [f.snapshot.key]: { identity: JSON.stringify(f.snapshot.identity), result: { feeds: [], reason: 'old scene' } } } };
    const original = JSON.stringify({ extension_settings: { crowdlens: old } }); await fs.writeFile(path.join(otherRoot, 'settings.json'), original);
    const first = await f.service.bootstrap(request, old); assert.equal(first.migratedLegacy, true); assert.equal(first.legacyAccepted, true);
    const scope = await f.service.scopeData(request, f.snapshot.scope);
    assert.equal(scope.results[f.snapshot.key].result.reason, 'old scene');
    assert.ok(scope.profiles[f.snapshot.profileKey]);
    assert.equal((await f.service.bootstrap(request, { ...old, results: {} })).legacyAccepted, false);
    assert.equal((await f.service.scopeData(request, f.snapshot.scope)).results[f.snapshot.key].result.reason, 'old scene');
    assert.equal(await fs.readFile(path.join(otherRoot, 'settings.json'), 'utf8'), original);
    assert.ok(await read(await rootFor(request), 'migration/legacy-settings-backup.json'));
});
test('stale tab settings cannot overwrite a newer server revision', async t => {
    const f = await fixture(t);
    await f.service.updateSettings(f.request, { revision: f.revision, settings: { ...f.config, branch: 'AU' } });
    await assert.rejects(f.service.updateSettings(f.request, { revision: f.revision, settings: f.config }), error => error.status === 409);
    assert.equal((await f.service.bootstrap(f.request)).settings.branch, 'AU');
});
test('branches, manual checks and edited prompts persist; old automatic generation is disabled', async t => {
    const f = await fixture(t);
    const modified = { ...f.config, automatic: true, branch: 'AU', branches: ['main', 'AU', 'AU'], selectionMode: 'manual', selectedPlatforms: [f.config.platforms[0].id, 'unknown'], platforms: [{ ...f.config.platforms[0], prompt: 'Edited platform voice.', sharedPrompt: 'Edited shared instruction.' }] };
    await f.service.updateSettings(f.request, { revision: f.revision, settings: modified });
    const restored = await createService().bootstrap(f.request);
    assert.equal(restored.settings.automatic, false);
    assert.deepEqual(restored.settings.branches, ['main', 'AU']);
    assert.equal(restored.settings.branch, 'AU');
    assert.equal(restored.settings.selectionMode, 'manual');
    assert.deepEqual(restored.settings.selectedPlatforms, [f.config.platforms[0].id]);
    assert.equal(restored.settings.platforms[0].prompt, 'Edited platform voice.');
    assert.equal(restored.settings.platforms[0].sharedPrompt, 'Edited shared instruction.');
});
test('original lorebook restores once verbatim even over placeholder edits; later edits persist', async t => {
    const f = await fixture(t), original = await loadOriginalCatalog();
    const stored = await read(f.root, 'settings.json');
    const legacy = { ...f.config, platforms: structuredClone(LEGACY_DEFAULT_PLATFORMS), selectedPlatforms: ['x', 'reddit'], selectionMode: 'manual', promptSource: 'old-examples.json' };
    delete legacy.originalSourceRevision;
    legacy.platforms.find(p => p.id === 'reddit').prompt = 'Old placeholder edit.';
    await write(f.root, 'settings.json', { ...stored, settings: legacy });
    const first = await f.service.bootstrap(f.request);
    assert.equal(first.settings.platforms.length, 9);
    assert.deepEqual(first.settings.platforms, original.platforms);
    assert.equal(first.settings.originalSourceRevision, original.revision);
    assert.deepEqual(first.settings.selectedPlatforms, ['reddit', 'twitter']);
    assert.equal(first.keyStatuses.typesafe, true);
    assert.equal((await read(f.root, 'migration/original-prompts-backup.json')).platforms.find(p => p.id === 'reddit').prompt, 'Old placeholder edit.');
    const edited = structuredClone(first.settings); edited.platforms[0].prompt = 'My later edit.';
    const saved = await f.service.updateSettings(f.request, { revision: first.revision, settings: edited });
    const restored = await f.service.bootstrap(f.request);
    assert.equal(restored.revision, saved.revision);
    assert.equal(restored.settings.platforms[0].prompt, 'My later edit.');
});
test('an explicitly imported smaller lorebook is never replaced by default catalog repair', async t => {
    const f = await fixture(t);
    await f.service.updateSettings(f.request, { revision: f.revision, settings: { ...f.config, platforms: LEGACY_DEFAULT_PLATFORMS, promptSource: 'chosen-four.json' } });
    const data = await f.service.bootstrap(f.request, { platforms: DEFAULT_PLATFORMS, promptSource: 'another-book.json' });
    assert.equal(data.settings.platforms.length, 4);
    assert.equal(data.settings.promptSource, 'chosen-four.json');
});
test('server completes a detached job without polling and results survive a new client/service', async t => {
    let release;
    const held = new Promise(resolve => release = resolve);
    const calls = [];
    const f = await fixture(t, { generateFactory: async () => async options => { calls.push(options); await held; return modelOutput(options); } });
    const submitted = await f.service.submit(f.request, { revision: f.revision, scope: f.snapshot.scope, snapshot: f.snapshot });
    f.request.browserDisconnected = true;
    release();
    // Read the durable status directly: no browser/status polling advances the worker.
    let durable;
    for (let n = 0; n < 100; n++) { durable = await read(f.root, jobFile(submitted.job.id)); if (durable.status === 'completed') break; await new Promise(r => setTimeout(r, 10)); }
    assert.equal(durable.status, 'completed');
    assert.equal(calls.length, 2); assert.ok(calls.every(c => c.responseLength >= 8000));
    const returned = createService();
    const data = await returned.scopeData(f.request, f.snapshot.scope);
    assert.equal(data.results[f.snapshot.key].result.feeds[0].posts.length, 6);
    assert.ok((await read(f.root, profileFile(f.snapshot.scope))).profiles[f.snapshot.profileKey]);
    assert.ok((await read(f.root, chatFile(f.snapshot.scope))).results[f.snapshot.key]);
});
test('manual jobs require no JEV key, make zero JEV calls, and store English profiles', async t => {
    let jevCalls = 0;
    const f = await fixture(t, { fetchImpl: async () => { jevCalls++; assert.fail('manual JEV call'); } });
    await f.service.saveKey(f.request, { provider: 'typesafe', key: '' });
    const config = { ...f.config, selectionMode: 'manual', selectedPlatforms: [f.config.platforms[0].id], underground: true, commentVolume: 'low', outputLanguage: 'en' };
    const saved = await f.service.updateSettings(f.request, { revision: f.revision, settings: config });
    const snap = capture(f.ctx, config, 0);
    const { job } = await f.service.submit(f.request, { revision: saved.revision, scope: snap.scope, snapshot: snap });
    assert.equal((await finish(f.service, f.request, job.id)).status, 'completed');
    assert.equal(jevCalls, 0);
    const data = await f.service.scopeData(f.request, snap.scope);
    assert.equal(data.results[snap.key].result.feeds[0].posts.length, 3);
    assert.equal(data.profiles[snap.profileKey].language, 'en');
    assert.equal(data.profiles[snap.profileKey].profile.character.occupation, 'Professional player');
});
test('selected-feed translation sends no sheets or lorebook; duplicate and cached requests cost no extra call', async t => {
    const calls = [];
    let release;
    const gate = new Promise(resolve => release = resolve);
    const f = await fixture(t, { generateFactory: async () => async options => { calls.push(options); if (options.systemPrompt.startsWith('Translate these')) await gate; return modelOutput(options); } });
    const generated = await f.service.submit(f.request, { revision: f.revision, scope: f.snapshot.scope, snapshot: f.snapshot });
    assert.equal((await finish(f.service, f.request, generated.job.id)).status, 'completed');
    const before = structuredClone((await f.service.scopeData(f.request, f.snapshot.scope)).results[f.snapshot.key].result.feeds[0]);
    const request = { scope: f.snapshot.scope, key: f.snapshot.key, platform: before.id, revision: f.revision };
    const first = await f.service.translate(f.request, request), duplicate = await f.service.translate(f.request, request);
    assert.equal(first.job.id, duplicate.job.id);
    await assert.rejects(f.service.clear(f.request, { scope: f.snapshot.scope }), /진행 중/);
    release(); assert.equal((await finish(f.service, f.request, first.job.id)).status, 'completed');
    const translations = calls.filter(c => c.systemPrompt.startsWith('Translate these'));
    assert.equal(translations.length, 1);
    assert.deepEqual(Object.keys(JSON.parse(translations[0].prompt)).sort(), ['platform', 'posts', 'style']);
    assert.equal(JSON.parse(translations[0].prompt).posts.length, before.posts.length);
    const after = (await f.service.scopeData(f.request, f.snapshot.scope)).results[f.snapshot.key].result.feeds[0];
    assert.deepEqual(after.posts, before.posts);
    assert.equal(after.translation.posts.length, before.posts.length);
    assert.equal((await f.service.translate(f.request, request)).cached, true);
    assert.equal(calls.filter(c => c.systemPrompt.startsWith('Translate these')).length, 1);
});
test('duplicate submissions share one background job and another account cannot read it', async t => {
    let release; const hold = new Promise(resolve => release = resolve);
    const f = await fixture(t, { generateFactory: async () => async options => { await hold; return modelOutput(options); } });
    const body = { revision: f.revision, scope: f.snapshot.scope, snapshot: f.snapshot };
    const a = await f.service.submit(f.request, body), b = await f.service.submit(f.request, body);
    assert.equal(a.job.id, b.job.id);
    const otherRoot = path.join(f.base, 'accountB'); await fs.mkdir(otherRoot);
    await assert.rejects(f.service.status({ user: { directories: { root: otherRoot } } }, a.job.id), error => error.status === 404);
    release(); assert.equal((await finish(f.service, f.request, a.job.id)).status, 'completed');
});
test('cancellation prevents publishing a detached job result', async t => {
    let release; const hold = new Promise(resolve => release = resolve);
    const f = await fixture(t, { generateFactory: async () => async options => { await hold; return modelOutput(options); } });
    const { job } = await f.service.submit(f.request, { revision: f.revision, scope: f.snapshot.scope, snapshot: f.snapshot });
    await f.service.cancel(f.request, job.id); release();
    assert.equal((await finish(f.service, f.request, job.id)).status, 'cancelled');
    assert.deepEqual((await f.service.scopeData(f.request, f.snapshot.scope)).results, {});
});
test('chat and branch data remain isolated and stale submitted settings are rejected', async t => {
    const f = await fixture(t);
    const { job } = await f.service.submit(f.request, { revision: f.revision, scope: f.snapshot.scope, snapshot: f.snapshot });
    assert.equal((await finish(f.service, f.request, job.id)).status, 'completed');
    for (const scope of [{ ...f.snapshot.scope, chat: 'anotherChat' }, { ...f.snapshot.scope, branch: 'AU' }]) assert.deepEqual((await f.service.scopeData(f.request, scope)).results, {});
    await assert.rejects(f.service.submit(f.request, { revision: 0, scope: f.snapshot.scope, snapshot: f.snapshot }), error => error.status === 409);
});
test('path inputs are hashed, traversal is blocked and corrupt storage is not silently replaced', async t => {
    const f = await fixture(t);
    await assert.rejects(write(f.root, '../outside.json', { bad: true }));
    const weird = { character: '../../outside', chat: '../chat', branch: '../branch' };
    assert.match(profileFile(weird), /^characters\/[a-f0-9]{64}\/branches\/[a-f0-9]{64}\.json$/);
    assert.deepEqual((await f.service.scopeData(f.request, weird)).results, {});
    await fs.writeFile(path.join(f.root, 'settings.json'), '{broken');
    await assert.rejects(f.service.bootstrap(f.request));
    assert.equal(await fs.readFile(path.join(f.root, 'settings.json'), 'utf8'), '{broken');
});
test('after server restart unfinished jobs are marked interrupted instead of reported successful', async t => {
    const f = await fixture(t), id = randomUUID();
    await write(f.root, jobFile(id), { id, key: 'old', status: 'running', phase: 'old phase' });
    const data = await createService().status(f.request, id);
    assert.equal(data.job.status, 'interrupted');
});
test('native ST connection profile is resolved server-side and the backend router uses a detached socket', async t => {
    const f = await fixture(t);
    const saved = { main_api: 'openai', extension_settings: { connectionManager: { selectedProfile: 'p1', profiles: [{ id: 'p1', api: 'google', model: 'gemini-test', 'secret-id': 'secret-selection', 'api-url': 'region-test' }] } } };
    await fs.writeFile(path.join(f.request.user.directories.root, 'settings.json'), JSON.stringify(saved));
    const connection = await selectConnection(f.request.user, 'p1', ['makersuite']);
    assert.equal(connection.chat_completion_source, 'makersuite'); assert.equal(connection.model, 'gemini-test'); assert.equal(connection.secret_id, 'secret-selection');
    let received;
    const router = { handle(req, res) { received = req; setTimeout(() => res.json({ choices: [{ message: { content: '{"ok":true}' } }] }), 5); } };
    const generate = makeGenerator(router, f.request.user, connection, new AbortController().signal);
    assert.equal(await generate({ systemPrompt: 'English instruction', prompt: 'source', responseLength: 8192 }), '{"ok":true}');
    assert.equal(received.user, f.request.user); assert.equal(received.body.max_tokens, 8192); assert.equal(received.body.stream, false);
    assert.equal(received.headers.cookie, undefined); assert.equal(received.headers.authorization, undefined);
    assert.ok(received.socket instanceof Object);
    await assert.rejects(selectConnection(f.request.user, 'missing', ['makersuite']), /프로필/);
});
test('router adapter rejects errors, cancellation and truncated output', async t => {
    const f = await fixture(t);
    await assert.rejects(invokeChatRouter({ handle(req, res) { res.status(401).json({ error: 'do not leak upstream key' }); } }, f.request.user, {}, null), /401/);
    const controller = new AbortController();
    const pending = invokeChatRouter({ handle() {} }, f.request.user, {}, controller.signal); controller.abort(); await assert.rejects(pending, /취소/);
    const generate = makeGenerator({ handle(req, res) { res.send({ choices: [{ finish_reason: 'length', message: { content: '{bad' } }] }); } }, f.request.user, {}, null);
    await assert.rejects(generate({ systemPrompt: '', prompt: '', responseLength: 8192 }), /잘렸/);
});
test('native Text Completion profile uses its saved endpoint and instruct template on the server', async t => {
    const f = await fixture(t), root = f.request.user.directories.root;
    await fs.mkdir(path.join(root, 'instruct'));
    await fs.writeFile(path.join(root, 'instruct', 'ChatML.json'), JSON.stringify({ system_sequence: '<system>', system_suffix: '</system>', input_sequence: '<user>', input_suffix: '</user>', output_sequence: '<assistant>' }));
    await fs.writeFile(path.join(root, 'settings.json'), JSON.stringify({ extension_settings: { connectionManager: { profiles: [{ id: 'local', mode: 'tc', api: 'koboldcpp', model: 'local-model', 'api-url': 'http://127.0.0.1:5001', instruct: 'ChatML' }] } } }));
    const connection = await selectConnection(f.request.user, 'local', ['openai'], ['koboldcpp']);
    let payload;
    const router = { handle(req, res) { payload = req.body; res.json({ results: [{ text: '{"ok":true}' }] }); } };
    const generate = makeGenerator(null, f.request.user, connection, null, router);
    assert.equal(await generate({ systemPrompt: 'rules', prompt: 'source', responseLength: 8192 }), '{"ok":true}');
    assert.equal(payload.api_server, 'http://127.0.0.1:5001'); assert.equal(payload.max_new_tokens, 8192);
    assert.equal(payload.prompt, '<system>rules</system><user>source</user><assistant>');
});
test('Vertex profile retains server authentication mode, project and configured reasoning effort', async t => {
    const f = await fixture(t);
    await fs.writeFile(path.join(f.request.user.directories.root, 'settings.json'), JSON.stringify({ main_api: 'openai', oai_settings: { vertexai_auth_mode: 'full', vertexai_express_project_id: 'my-project', vertexai_region: 'global', reasoning_effort: 'low' }, extension_settings: { connectionManager: { profiles: [{ id: 'vertex', api: 'vertexai', model: 'gemini-test', 'secret-id': 'service-account' }] } } }));
    const connection = await selectConnection(f.request.user, 'vertex', ['vertexai']);
    assert.equal(connection.vertexai_auth_mode, 'full'); assert.equal(connection.vertexai_express_project_id, 'my-project');
    assert.equal(connection.vertexai_region, 'global'); assert.equal(connection.reasoning_effort, 'low');
    const generate = makeGenerator({ handle(_req, res) { res.json({ candidates: [{ finishReason: 'MAX_TOKENS' }] }); } }, f.request.user, connection, null);
    await assert.rejects(generate({ systemPrompt: '', prompt: '', responseLength: 8192 }), /잘렸/);
});
