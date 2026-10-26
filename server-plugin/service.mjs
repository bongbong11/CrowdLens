import { createProfileService, saveProfile } from './profile-service.mjs';
import { validateProfileSnapshot } from './source-contract.mjs';
import { normalizeSelection } from './runtime/source-selection.js';
import { randomUUID } from 'node:crypto';
import { runScene } from './runtime/engine.js';
import { createJevClassifier } from './jev-bridge.mjs';
import { PROVIDERS, importPlatforms, fingerprint } from './runtime/core.js';
import { rootFor, read, write, serial, scopeOf, profileFile, chatFile, jobFile, digest } from './storage.mjs';
import { loadOriginalCatalog } from './original-catalog.mjs';
import { TRANSLATION_PROMPT } from './runtime/prompts.js';
import { parseJSON } from './runtime/core.js';

export const defaultConfig = () => ({ version: 2, catalogVersion: 1, originalSourceRevision: '', underground: false, outputLanguage: 'en', commentVolume: 'medium', enabled: false, automatic: false, branch: 'main', branches: ['main'], selectionMode: 'auto', selectedPlatforms: [], provider: 'typesafe', profileId: '', outputTokens: 8192, platforms: [] });
const record = value => value && typeof value === 'object' && !Array.isArray(value);
function cleanConfig(raw) {
    const base = defaultConfig();
    const source = record(raw) ? raw : {};
    base.originalSourceRevision = /^[a-f0-9]{64}$/.test(source.originalSourceRevision) ? source.originalSourceRevision : '';
    base.underground = source.underground === true;
    base.outputLanguage = source.outputLanguage === 'ko' ? 'ko' : 'en';
    base.commentVolume = ['low', 'medium', 'high'].includes(source.commentVolume) ? source.commentVolume : 'medium';
    base.enabled = source.enabled === true; base.automatic = false;
    base.branch = String(source.branch || 'main').trim().slice(0, 80) || 'main';
    base.branches = [...new Set(['main', base.branch, ...(Array.isArray(source.branches) ? source.branches.filter(v => typeof v === 'string').map(v => v.trim().slice(0, 80)).filter(Boolean).slice(0, 62) : [])])];
    if (Object.hasOwn(PROVIDERS, source.provider)) base.provider = source.provider;
    base.profileId = typeof source.profileId === 'string' ? source.profileId.slice(0, 200) : '';
    base.outputTokens = Math.min(32768, Math.max(8000, Math.trunc(Number(source.outputTokens) || 8192)));
    if (!source.platforms) throw new Error('커뮤니티 원문 설정이 없습니다. 서버에 다시 연결해 주세요.');
    base.platforms = importPlatforms(source.platforms);
    base.selectionMode = source.selectionMode === 'manual' ? 'manual' : 'auto';
    base.selectedPlatforms = Array.isArray(source.selectedPlatforms) ? base.platforms.filter(p => source.selectedPlatforms.includes(p.id)).map(p => p.id) : base.platforms.map(p => p.id);
    if (typeof source.promptSource === 'string') base.promptSource = source.promptSource.slice(0, 200);
    return base;
}
function snapshotOf(raw, scope) {
    if (!record(raw) || !record(raw.source?.character) || !record(raw.source?.persona) || !Array.isArray(raw.history) || !raw.history.length || raw.history.length > 6 || !Array.isArray(raw.identity)) throw Object.assign(new Error('잘못된 장면 입력입니다.'), { status: 400 });
    if (Buffer.byteLength(JSON.stringify(raw)) > 2_000_000) throw Object.assign(new Error('장면 입력이 너무 큽니다.'), { status: 413 });
    const profile = validateProfileSnapshot(raw, scope);
    const history = raw.history.map(item => {
        if (typeof item?.text !== 'string') throw new Error('장면 메시지를 읽을 수 없습니다.');
        return { name: String(item.name || ''), text: item.text };
    });
    if (raw.key !== fingerprint(raw.identity)) throw new Error('장면 식별자가 일치하지 않습니다.');
    return { ...profile, history, identity: raw.identity, key: raw.key };
}
const keyStatuses = secrets => Object.fromEntries(Object.keys(PROVIDERS).map(provider => [provider, Boolean(secrets[provider])]));
const publicJob = job => job ? { id: job.id, key: job.key, kind: job.kind || 'generation', platform: job.platform, status: job.status, phase: job.phase, error: job.error || '', createdAt: job.createdAt, updatedAt: job.updatedAt } : null;

export function createService({ generateFactory, fetchImpl = fetch, timeoutMs = 300000, logJev } = {}) {
    const running = new Map();
    const runningScopes = new Map();
    const profileService = createProfileService({ running, runningScopes, generateFactory, timeoutMs, publicJob });
    async function bootstrap(request, legacy) {
        const root = await rootFor(request);
        return serial(root, async () => {
            const original = await loadOriginalCatalog();
            let state = await read(root, 'settings.json');
            const existed = Boolean(state);
            if (!state) {
                let skippedLegacy = 0;
                if (record(legacy)) {
                    await write(root, 'migration/legacy-settings-backup.json', legacy);
                    for (const [key, value] of Object.entries(record(legacy.profiles) ? legacy.profiles : {})) {
                        let identity; try { identity = JSON.parse(key); } catch { skippedLegacy++; continue; }
                        if (!Array.isArray(identity) || identity.length < 2) { skippedLegacy++; continue; }
                        const scope = scopeOf({ character: identity[0], branch: identity[1], chat: 'migration' });
                        const file = profileFile(scope), saved = await read(root, file, { profiles: {} });
                        saved.profiles[key] ??= value; await write(root, file, saved);
                    }
                    for (const [key, value] of Object.entries(record(legacy.results) ? legacy.results : {})) {
                        let identity; try { identity = JSON.parse(value.identity); } catch { skippedLegacy++; continue; }
                        const offset = typeof identity?.[0] === 'string' && identity[0].startsWith('ko-reader-') ? 1 : 0;
                        if (!Array.isArray(identity) || identity.length < offset + 3) { skippedLegacy++; continue; }
                        const scope = scopeOf({ character: identity[offset], chat: identity[offset + 1], branch: identity[offset + 2] });
                        const file = chatFile(scope), saved = await read(root, file, { results: {} });
                        saved.results[key] ??= value; await write(root, file, saved);
                    }
                }
                const firstSelection = legacy?.selectionMode === 'manual' && Array.isArray(legacy.selectedPlatforms)
                    ? legacy.selectedPlatforms.map(id => id === 'x' ? 'twitter' : id).filter(id => original.platforms.some(p => p.id === id)) : original.platforms.map(p => p.id);
                const initial = { ...(record(legacy) ? legacy : {}), platforms: original.platforms, selectedPlatforms: firstSelection, promptSource: '커뮤반응모음.json', originalSourceRevision: original.revision };
                state = { schema: 1, revision: 1, settings: cleanConfig(initial), migratedLegacy: record(legacy), skippedLegacy, legacyHash: record(legacy) ? digest(JSON.stringify(legacy)) : '' };
                await write(root, 'settings.json', state);
            }
            if (state.settings.originalSourceRevision !== original.revision) {
                if (existed && !await read(root, 'migration/original-prompts-backup.json')) await write(root, 'migration/original-prompts-backup.json', state.settings);
                const selected = state.settings.selectionMode === 'manual' && Array.isArray(state.settings.selectedPlatforms)
                    ? state.settings.selectedPlatforms.map(id => id === 'x' ? 'twitter' : id).filter(id => original.platforms.some(p => p.id === id)) : original.platforms.map(p => p.id);
                state = { ...state, revision: state.revision + 1, settings: cleanConfig({ ...state.settings, platforms: original.platforms, selectedPlatforms: selected, promptSource: '커뮤반응모음.json', originalSourceRevision: original.revision }) };
                await write(root, 'settings.json', state);
            }
            const secrets = await read(root, 'secrets.json', {});
            return { ok: true, protocol: 5, revision: state.revision, settings: cleanConfig(state.settings), keyStatuses: keyStatuses(secrets), migratedLegacy: state.migratedLegacy === true, legacyAccepted: record(legacy) && !state.skippedLegacy && state.legacyHash === digest(JSON.stringify(legacy)), location: 'data/<account>/crowdlens/' };
        });
    }
    async function updateSettings(request, body) {
        const root = await rootFor(request);
        return serial(root, async () => {
            const previous = await read(root, 'settings.json');
            if (!previous) throw new Error('서버 저장소를 먼저 연결해 주세요.');
            if (body.revision !== previous.revision) throw Object.assign(new Error('다른 탭에서 설정이 변경되었습니다. 새로고침 후 다시 시도해 주세요.'), { status: 409 });
            const next = { ...previous, revision: previous.revision + 1, settings: cleanConfig(body.settings) };
            await write(root, 'settings.json', next);
            return { ok: true, revision: next.revision, settings: next.settings };
        });
    }
    async function saveKey(request, { provider, key }) {
        if (!Object.hasOwn(PROVIDERS, provider) || typeof key !== 'string' || key.length > 2048 || /[\r\n]/.test(key)) throw Object.assign(new Error('제공자와 API 키 형식을 확인해 주세요.'), { status: 400 });
        const root = await rootFor(request);
        return serial(root, async () => {
            const secrets = await read(root, 'secrets.json', {});
            if (key.trim()) secrets[provider] = key.trim(); else delete secrets[provider];
            await write(root, 'secrets.json', secrets);
            return { ok: true, keyStatuses: keyStatuses(secrets) };
        });
    }
    async function getJob(root, id) {
        const job = await read(root, jobFile(id));
        if (!job) throw Object.assign(new Error('이 계정에서 작업을 찾지 못했습니다.'), { status: 404 });
        if (['queued', 'running'].includes(job.status) && !running.has(`${root}:${id}`)) {
            job.status = 'interrupted'; job.error = '서버가 재시작되어 작업이 중단되었습니다. 다시 생성해 주세요.'; job.updatedAt = new Date().toISOString();
            await serial(root, () => write(root, jobFile(id), job));
        }
        return job;
    }
    async function scopeData(request, rawScope) {
        const root = await rootFor(request), scope = scopeOf(rawScope);
        const [profiles, chat] = await Promise.all([read(root, profileFile(scope), { profiles: {} }), read(root, chatFile(scope), { results: {} })]);
        const job = chat.lastJob ? await getJob(root, chat.lastJob) : null;
        return { ok: true, profiles: profiles.profiles, sourceSelections: profiles.selections || {}, sourceSelectionRevisions: profiles.selectionRevisions || {}, results: chat.results, latestResultKey: chat.latestResultKey || Object.keys(chat.results).at(-1) || null, job: publicJob(job) };
    }
    async function clear(request, body) {
        const root = await rootFor(request), scope = scopeOf(body.scope);
        return serial(root, async () => {
            const chat = await read(root, chatFile(scope), { results: {} });
            if ([...runningScopes].some(([key, value]) => key.startsWith(root + ':') && value === JSON.stringify(scope))) throw Object.assign(new Error('진행 중인 서버 작업을 취소한 뒤 지워 주세요.'), { status: 409 });
            if (body.profileKey) {
                const key = JSON.parse(body.profileKey);
                if (key[0] !== scope.character || key[1] !== scope.branch) throw new Error('다른 캐릭터의 프로필을 지울 수 없습니다.');
                const saved = await read(root, profileFile(scope), { profiles: {} });
                delete saved.profiles[body.profileKey]; await write(root, profileFile(scope), saved);
            }
            if (body.key) { delete chat.results[body.key]; chat.latestResultKey = Object.keys(chat.results).at(-1) || null; }
            else { chat.results = {}; chat.latestResultKey = null; }
            await write(root, chatFile(scope), chat);
            return { ok: true };
        });
    }
    async function submit(request, body) {
        const root = await rootFor(request), scope = scopeOf(body.scope), snapshot = snapshotOf(body.snapshot, scope);
        const start = await serial(root, async () => {
            const state = await read(root, 'settings.json');
            if (!state?.settings?.enabled) throw new Error('CrowdLens 사용을 먼저 켜 주세요.');
            if (body.revision !== state.revision) throw Object.assign(new Error('서버 설정이 변경되었습니다. 새로고침해 주세요.'), { status: 409 });
            state.settings = cleanConfig(state.settings);
            const sourceRecord = await read(root, profileFile(scope), { profiles: {} });
            if (sourceRecord.selections?.[snapshot.profileKey] && fingerprint(normalizeSelection(sourceRecord.selections[snapshot.profileKey])) !== snapshot.selectionHash) throw new Error('프로필 입력 선택이 변경되었습니다. 다시 불러와 주세요.');
            if (state.settings.selectionMode === 'manual' && !state.settings.selectedPlatforms.length) throw new Error('생성할 커뮤니티를 하나 이상 선택해 주세요.');
            const chat = await read(root, chatFile(scope), { results: {} });
            const previousId = chat.sceneJobs?.[snapshot.key] || chat.lastJob;
            if (previousId) {
                const prior = await read(root, jobFile(previousId));
                if (prior?.kind !== 'translation' && prior?.key === snapshot.key && running.has(`${root}:${prior.id}`)) return { existing: publicJob(prior) };
            }
            if ([...running.keys()].filter(k => k.startsWith(root + ':')).length >= 4) throw Object.assign(new Error('이 계정의 서버 작업이 많습니다. 완료 후 다시 시도해 주세요.'), { status: 429 });
            const secrets = await read(root, 'secrets.json', {}), apiKey = secrets[state.settings.provider];
            if (state.settings.selectionMode !== 'manual' && !apiKey) throw new Error('자동 선택을 사용하려면 JEV 제공자의 키를 서버에 저장해 주세요.');
            const job = { id: randomUUID(), scope, key: snapshot.key, status: 'queued', phase: '서버 작업 대기', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
            const controller = new AbortController(); running.set(`${root}:${job.id}`, controller);
            runningScopes.set(`${root}:${job.id}`, JSON.stringify(scope));
            const sceneJobs = Object.fromEntries([...Object.entries(chat.sceneJobs || {}).filter(([key]) => key !== snapshot.key), [snapshot.key, job.id]].slice(-80));
            try { await write(root, jobFile(job.id), job); await write(root, chatFile(scope), { ...chat, sceneJobs, lastJob: job.id }); }
            catch (error) { running.delete(`${root}:${job.id}`); runningScopes.delete(`${root}:${job.id}`); throw error; }
            return { job, controller, config: state.settings, apiKey };
        });
        if (start.existing) return { ok: true, job: start.existing };
        const { job, controller, config, apiKey } = start;
        const task = serial(`${root}:generation:${profileFile(scope)}`, async () => {
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            const phase = async text => { job.phase = text; job.status = 'running'; job.updatedAt = new Date().toISOString(); await serial(root, () => write(root, jobFile(job.id), job)); };
            try {
                controller.signal.throwIfAborted();
                const saved = await read(root, profileFile(scope), { profiles: {} });
                const settings = { ...config, profiles: saved.profiles };
                const generate = await generateFactory(request.user, config, controller.signal);
                await phase('프로필 확인 및 연결 모델 판독');
                const result = await runScene({ snapshot, settings, valid: () => !controller.signal.aborted,
                    save: () => saveProfile(root, scope, snapshot, settings.profiles[snapshot.profileKey]),
                    generate: async options => { await phase(options.systemPrompt.startsWith('Summarize') ? '사회적 프로필 판독' : '커뮤니티 반응 작성'); return generate(options); },
                    classify: createJevClassifier({ settings, apiKey, signal: controller.signal, phase, fetchImpl, log: logJev }),
                });
                controller.signal.throwIfAborted();
                await serial(root, async () => {
                    const chat = await read(root, chatFile(scope), { results: {} });
                    chat.results[snapshot.key] = { identity: JSON.stringify(snapshot.identity), result, createdAt: new Date().toISOString() };
                    chat.latestResultKey = snapshot.key;
                    Object.keys(chat.results).slice(0, Math.max(0, Object.keys(chat.results).length - 80)).forEach(k => delete chat.results[k]);
                    await write(root, chatFile(scope), chat);
                    job.status = 'completed'; job.phase = '완료'; job.updatedAt = new Date().toISOString();
                    await write(root, jobFile(job.id), job);
                });
            } catch (error) {
                job.status = controller.signal.aborted ? 'cancelled' : 'failed'; job.phase = '중단'; job.error = controller.signal.aborted ? '서버 작업이 취소되거나 제한 시간을 넘었습니다.' : String(error.message || '서버 작업에 실패했습니다.').slice(0, 500); job.updatedAt = new Date().toISOString();
                await serial(root, () => write(root, jobFile(job.id), job));
            } finally { clearTimeout(timer); running.delete(`${root}:${job.id}`); runningScopes.delete(`${root}:${job.id}`); }
        });
        task.catch(() => { running.delete(`${root}:${job.id}`); });
        return { ok: true, job: publicJob(job) };
    }
    async function translate(request, body) {
        const root = await rootFor(request), scope = scopeOf(body.scope);
        if (!/^[a-z0-9]{1,40}$/i.test(body.key) || !/^[a-z0-9_-]{1,40}$/i.test(body.platform)) throw new Error('번역할 피드를 확인해 주세요.');
        const sourceOf = feed => JSON.stringify(feed.posts.map(p => ({ title: p.title, body: p.body, removed: p.removed })));
        const start = await serial(root, async () => {
            const state = await read(root, 'settings.json');
            if (!state?.settings?.enabled) throw new Error('CrowdLens 사용을 먼저 켜 주세요.');
            if (body.revision !== state.revision) throw Object.assign(new Error('서버 설정이 변경되었습니다. 새로고침해 주세요.'), { status: 409 });
            const chat = await read(root, chatFile(scope), { results: {} });
            const feed = chat.results[body.key]?.result?.feeds?.find(f => f.id === body.platform);
            if (!feed || feed.language !== 'en') throw new Error('저장된 영어 원문 피드를 찾지 못했습니다.');
            const sourceHash = digest(sourceOf(feed));
            if (feed.translation?.sourceHash === sourceHash) return { cached: true };
            const cacheKey = `${body.key}:${body.platform}`, previousId = chat.translationJobs?.[cacheKey];
            if (previousId) {
                const prior = await read(root, jobFile(previousId));
                if (prior?.sourceHash === sourceHash && running.has(`${root}:${previousId}`)) return { existing: publicJob(prior) };
            }
            if ([...running.keys()].filter(k => k.startsWith(root + ':')).length >= 4) throw new Error('진행 중인 작업이 많습니다. 완료 후 번역해 주세요.');
            const job = { id: randomUUID(), scope, key: body.key, kind: 'translation', platform: body.platform, sourceHash, status: 'queued', phase: '번역 대기', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
            const controller = new AbortController(); running.set(`${root}:${job.id}`, controller); runningScopes.set(`${root}:${job.id}`, JSON.stringify(scope));
            const translationJobs = Object.fromEntries([...Object.entries(chat.translationJobs || {}).filter(([key]) => key !== cacheKey), [cacheKey, job.id]].slice(-80));
            try { await write(root, jobFile(job.id), job); await write(root, chatFile(scope), { ...chat, translationJobs, lastJob: job.id }); }
            catch (error) { running.delete(`${root}:${job.id}`); runningScopes.delete(`${root}:${job.id}`); throw error; }
            return { job, controller, feed, config: cleanConfig(state.settings) };
        });
        if (start.cached) return { ok: true, cached: true };
        if (start.existing) return { ok: true, job: start.existing };
        const { job, controller, feed, config } = start;
        const task = (async () => {
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const generate = await generateFactory(request.user, config, controller.signal);
                controller.signal.throwIfAborted(); job.status = 'running'; job.phase = `${feed.name} 한국어 번역 중`; await serial(root, () => write(root, jobFile(job.id), job));
                const raw = parseJSON(await generate({ systemPrompt: TRANSLATION_PROMPT, prompt: JSON.stringify({ platform: feed.name, style: feed.style, posts: feed.posts.map(p => ({ title: p.title, body: p.body, removed: p.removed })) }), responseLength: config.outputTokens, trimNames: false }));
                if (!Array.isArray(raw.posts) || raw.posts.length !== feed.posts.length) throw new Error('번역 댓글 수가 원문과 다릅니다.');
                const posts = raw.posts.map((p, i) => {
                    if (feed.posts[i].removed) return { title: '', body: '관리자가 삭제한 댓글입니다.' };
                    if (typeof p.body !== 'string' || !p.body.trim() || p.body.length > 4000 || (p.title?.length || 0) > 400) throw new Error('번역 결과 형식이 올바르지 않습니다.');
                    return { title: typeof p.title === 'string' ? p.title : '', body: p.body };
                });
                controller.signal.throwIfAborted();
                await serial(root, async () => {
                    const chat = await read(root, chatFile(scope), { results: {} }), current = chat.results[job.key]?.result?.feeds?.find(f => f.id === job.platform);
                    if (!current || digest(sourceOf(current)) !== job.sourceHash) throw new Error('영어 원문이 바뀌어 예전 번역을 저장하지 않았습니다.');
                    current.translation = { language: 'ko', sourceHash: job.sourceHash, posts };
                    await write(root, chatFile(scope), chat);
                    job.status = 'completed'; job.phase = '번역 완료'; job.updatedAt = new Date().toISOString(); await write(root, jobFile(job.id), job);
                });
            } catch (error) {
                job.status = controller.signal.aborted ? 'cancelled' : 'failed'; job.phase = '번역 중단'; job.error = controller.signal.aborted ? '번역이 취소되거나 제한 시간을 넘었습니다.' : String(error.message).slice(0, 500); job.updatedAt = new Date().toISOString();
                await serial(root, () => write(root, jobFile(job.id), job));
            } finally { clearTimeout(timer); running.delete(`${root}:${job.id}`); runningScopes.delete(`${root}:${job.id}`); }
        })();
        task.catch(() => {});
        return { ok: true, job: publicJob(job) };
    }
    return {
        bootstrap, updateSettings, saveKey, scopeData, clear, submit, translate, selectSources: profileService.select, submitProfile: profileService.submit,
        async status(request, id) { const root = await rootFor(request); return { ok: true, job: publicJob(await getJob(root, id)) }; },
        async cancel(request, id) { const root = await rootFor(request); await getJob(root, id); running.get(`${root}:${id}`)?.abort(); return { ok: true }; },
        async close() { for (const controller of running.values()) controller.abort(); },
    };
}
