import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { PROVIDERS, DEFAULT_PLATFORMS, GROUPS, importPlatforms, parseJSON, planFeed, readDecisions, sceneQuestions, postsOf } from '../src/core.js';
import { capture, decide, runScene } from '../src/engine.js';
import { readSheets } from '../src/sheets.js';

const profile = { name: 'Hunter', occupation: '선수', recognition: '스포츠 공인', reputation: '차분함', acquaintanceView: '장난스러움', publicInfo: '선수 경력' };
const profiles = { character: profile, persona: { ...profile, name: 'Jamie', occupation: '일반 회사원', recognition: '일반인' } };
const config = () => ({ branch: 'main', provider: 'typesafe', apiKey: 'test-only', platforms: [DEFAULT_PLATFORMS[0]], profiles: {}, outputTokens: 8192 });
const context = () => ({ characterId: 0, characters: [{ avatar: 'hunter.png', name: 'Hunter', description: '선수. 공개된 선수 경력. 비밀: 향수 수집.' }], chatId: 'chat1', name1: 'Jamie', powerUserSettings: { persona_description: '회사원' }, chat: [{ name: 'Jamie', is_user: true, mes: '경기 인터뷰를 볼까?' }, { name: 'Hunter', mes: '공개 인터뷰가 방송됐다.', swipe_id: 0 }] });
const scores = () => ({ visible: .95, p0: .9, ...Object.fromEntries(Object.keys(GROUPS).map(g => [`p0_${g}`, g === 'public' ? .9 : .1])) });
const modelFeed = () => JSON.stringify({ feeds: [{ platform: 'x', posts: Array.from({ length: 8 }, (_, i) => ({ author: `user${i}`, group: 'public', region: 'us', body: '인터뷰 봤다.' })) }] });

test('uploaded lorebook imports 9 platforms and shares archetypes without SMS or a fake archetype platform', { skip: !existsSync(new URL('../prompts/community-reactions.json', import.meta.url)) }, () => {
    const source = JSON.parse(readFileSync(new URL('../prompts/community-reactions.json', import.meta.url), 'utf8'));
    const rows = importPlatforms(source);
    assert.equal(rows.length, 9);
    assert.deepEqual(rows.map(p => p.id), ['twitch', 'reddit', 'twitter', 'discord', 'youtube', 'ao3', 'instagram', 'tiktok', '4chan']);
    assert.ok(rows.every(p => p.sharedPrompt.includes('User Archetypes')));
    assert.equal(rows.find(p => p.id === 'twitch').style, 'live');
    assert.equal(rows.find(p => p.id === '4chan').style, 'anon');
});
test('imports reject duplicate IDs, missing prompts and empty data', () => {
    for (const bad of [[], { platforms: [{ id: 'a', name: 'A' }] }, [{ id: 'a', name: 'A', prompt: 'x' }, { id: 'a', name: 'B', prompt: 'y' }]]) assert.throws(() => importPlatforms(bad));
});
test('private scenes never create public fandom or media plans', () => {
    assert.deepEqual(planFeed(DEFAULT_PLATFORMS, { visible: .1, p0: 1, p0_fans: 1 }), []);
    assert.deepEqual(planFeed([DEFAULT_PLATFORMS[0]], { visible: 1, p0: 1, p0_fans: .1, p0_media: .1 }), []);
});
test('weighted sampling uses only eligible groups and exact count', () => {
    const [plan] = planFeed([DEFAULT_PLATFORMS[0]], scores(), 8, () => .3);
    assert.deepEqual(plan.slots, { public: 8 });
    const varied = planFeed([DEFAULT_PLATFORMS[0]], { ...scores(), p0_fans: .9 }, 8, () => .9);
    assert.equal(Object.values(varied[0].slots).reduce((a, b) => a + b), 8);
});
test('malformed or incomplete JEV answers fail closed', () => {
    const q = sceneQuestions([DEFAULT_PLATFORMS[0]]);
    assert.throws(() => readDecisions({ answers: { visible: { noul: 1 } } }, q));
    for (const value of [2, -1, '0.9', NaN]) assert.throws(() => readDecisions({ answers: { visible: { noul: value } } }, { visible: {} }));
});
for (const provider of Object.keys(PROVIDERS)) test(`${provider} uses verified endpoint, model, isolated key and correct proxy headers`, async () => {
    const s = { ...config(), provider };
    await decide(s, { scene: ['scene'] }, new AbortController().signal, () => ({ 'X-CSRF-Token': 'csrf-test' }), async (url, options) => {
        assert.equal(options.headers['X-CSRF-Token'], provider !== 'openrouter' ? 'csrf-test' : undefined);
        if (url === PROVIDERS[provider].usage) return { ok: true, json: async () => ({ routing: { paidSpendPolicyAllowsBalance: false, recommendedMode: 'subscription' } }) };
        assert.equal(url, PROVIDERS[provider].endpoint);
        assert.equal(JSON.parse(options.body).model, PROVIDERS[provider].model);
        assert.equal(options.headers.Authorization, 'Bearer test-only');
        const answers = Object.fromEntries(Object.keys(sceneQuestions(s.platforms)).map(k => [k, { noul: .7 }]));
        if (provider === 'nanogpt') {
            assert.equal(JSON.parse(options.body).response_format.type, 'questions');
            return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ answers }) } }] }) };
        }
        return { ok: true, json: async () => ({ answers }) };
    });
});
test('JEV auth failure and missing key never proceed', async () => {
    await assert.rejects(decide({ ...config(), apiKey: '' }, {}, null, null), /API/);
    await assert.rejects(decide(config(), {}, null, null, async () => ({ ok: false, status: 401 })), /401/);
});
test('scene identity separates chat, swipe, edits, branch and persona', () => {
    const c = context(), s = config(), base = capture(c, s, 1);
    for (const change of [v => v.chatId = 'chat2', v => v.chat[1].mes = '수정된 답변', v => v.chat[1].swipe_id++, v => v.powerUserSettings.persona_description = '의사']) {
        const changed = structuredClone(c); change(changed);
        assert.notEqual(capture(changed, s, 1).key, base.key);
    }
    assert.notEqual(capture(c, { ...s, branch: 'AU' }, 1).profileKey, base.profileKey);
    c.characterId = 1; c.characters.push({ ...c.characters[0], avatar: 'other.png' });
    assert.notEqual(capture(c, s, 1).profileKey, base.profileKey);
});
test('first generation builds profiles, judges, writes feeds; second reuses profile; originals immutable', async () => {
    const c = context(), before = JSON.stringify(c), s = config(), calls = [];
    const run = () => runScene({ snapshot: capture(c, s, 1), settings: s, valid: () => true, save() {}, random: () => .5,
        generate: async options => { calls.push(options); return options.systemPrompt.startsWith('Summarize') ? JSON.stringify(profiles) : modelFeed(); }, classify: async () => scores() });
    assert.equal((await run()).feeds[0].posts.length, 8);
    assert.equal(calls.length, 2);
    await run(); assert.equal(calls.length, 3);
    assert.ok(calls.every(c => c.responseLength >= 8000));
    assert.equal(JSON.stringify(c), before);
    c.characters[0].description += ' 새 직업'; await run(); assert.equal(calls.length, 5);
});
test('output token request cannot fall below user minimum', async () => {
    const s = { ...config(), outputTokens: 500 };
    await runScene({ snapshot: capture(context(), s, 1), settings: s, valid: () => true, save() {}, generate: async options => { assert.equal(options.responseLength, 8000); return JSON.stringify(profiles); }, classify: async () => ({ visible: 0 }) });
});
test('cancellation after profile response prevents persistence, JEV and feeds', async () => {
    const s = config(); let valid = true;
    await assert.rejects(runScene({ snapshot: capture(context(), s, 1), settings: s, valid: () => valid, save: () => assert.fail('stale save'), generate: async () => { valid = false; return JSON.stringify(profiles); }, classify: async () => assert.fail('stale classification') }), /취소/);
    assert.deepEqual(s.profiles, {});
});
test('no observable event skips reaction model entirely', async () => {
    const s = config(), snap = capture(context(), s, 1); s.profiles[snap.profileKey] = { sourceHash: snap.sourceHash, profile: profiles };
    const result = await runScene({ snapshot: snap, settings: s, valid: () => true, save() {}, generate: () => assert.fail('unnecessary generation'), classify: async () => ({ visible: .1 }) });
    assert.deepEqual(result.feeds, []);
});
test('post validation rejects fabricated groups, missing posts and invalid JSON', () => {
    const plans = planFeed([DEFAULT_PLATFORMS[0]], scores());
    assert.throws(() => postsOf({ feeds: [] }, plans));
    const raw = parseJSON(modelFeed()); raw.feeds[0].posts[0].group = 'fans';
    assert.throws(() => postsOf(raw, plans));
    assert.throws(() => parseJSON('non-json response'));
    assert.deepEqual(parseJSON('```json\n{"ok":true}\n```'), { ok: true });
});
test('sheet read precedence matches Scene Reader Hub, including active avatar and string entries', () => {
    const c = context(); c.characters[0].data = { name: 'Card Name', description: 'data 원문', personality: 'data 성격' };
    c.user_avatar = 'active.png'; c.powerUserSettings.persona_descriptions = { 'active.png': { description: '선택한 페르소나' }, 'other.png': { description: '다른 페르소나' } };
    const before = JSON.stringify(c);
    assert.equal(readSheets(c).character.description, 'data 원문');
    assert.equal(readSheets(c).persona.description, '선택한 페르소나');
    c.personaDescription = '현재 문맥 우선'; assert.equal(readSheets(c).persona.description, '현재 문맥 우선');
    delete c.personaDescription; c.powerUserSettings.persona_descriptions['active.png'] = '문자열 페르소나';
    assert.equal(readSheets(c).persona.description, '문자열 페르소나');
    const restored = JSON.parse(before); readSheets(restored); assert.equal(JSON.stringify(restored), before);
});
test('NanoGPT refuses balance fallback before sending decision request', async () => {
    let count = 0;
    await assert.rejects(decide({ ...config(), provider: 'nanogpt' }, {}, null, () => ({}), async () => {
        count++; return { ok: true, json: async () => ({ routing: { paidSpendPolicyAllowsBalance: true, recommendedMode: 'subscription' } }) };
    }), /Subscription only/);
    assert.equal(count, 1);
});
test('SMS is excluded from normalized imports and legacy lorebooks', () => {
    const good = { id: 'reddit', name: 'Reddit', prompt: 'Forum comments.' };
    assert.deepEqual(importPlatforms([good, { id: 'sms', name: 'SMS', prompt: 'Texts.' }]).map(p => p.id), ['reddit']);
    const legacy = { entries: { 1: { comment: 'SMS 문자 Format', content: 'Texts.' }, 2: { comment: 'Reddit Format', content: 'Forum.' } } };
    assert.deepEqual(importPlatforms(legacy).map(p => p.id), ['reddit']);
    assert.throws(() => importPlatforms([{ id: 'sms', name: '문자', prompt: 'Texts.' }]));
});
test('regional translated replies preserve raw text and reject unsupported regions or invalid reply links', () => {
    const plans = planFeed([DEFAULT_PLATFORMS[0]], scores());
    const raw = parseJSON(modelFeed());
    raw.feeds[0].posts[0].culture = 'korean'; raw.feeds[0].posts[0].region = 'eastasia';
    raw.feeds[0].posts[1] = { ...raw.feeds[0].posts[1], culture: 'international', region: 'europe', replyTo: 0, body: '그 단어 하나 갖고 이 지랄이라고?' };
    const [feed] = postsOf(raw, plans);
    assert.equal(feed.posts[0].culture, 'korean');
    assert.equal(feed.posts[1].region, 'europe');
    assert.equal(feed.posts[1].replyTo, 0);
    assert.equal(feed.posts[1].body, raw.feeds[0].posts[1].body);
    raw.feeds[0].posts[1].replyTo = 1; assert.throws(() => postsOf(raw, plans), /답글/);
    raw.feeds[0].posts[1].replyTo = null; raw.feeds[0].posts[1].region = 'unsupported'; assert.throws(() => postsOf(raw, plans), /권역/);
});
