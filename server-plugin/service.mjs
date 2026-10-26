import { randomUUID } from 'node:crypto';
import { runScene, decide } from './runtime/engine.js';
import { DEFAULT_PLATFORMS, PROVIDERS, importPlatforms, fingerprint, upgradeCatalog } from './runtime/core.js';
import { rootFor, read, write, serial, scopeOf, profileFile, chatFile, jobFile, digest } from './storage.mjs';

export const defaultConfig = () => ({ version: 2, catalogVersion: 1, enabled: false, automatic: false, branch: 'main', branches: ['main'], selectionMode: 'auto', selectedPlatforms: DEFAULT_PLATFORMS.map(p => p.id), provider: 'typesafe', profileId: '', outputTokens: 8192, platforms: structuredClone(DEFAULT_PLATFORMS) });
const record = value => value && typeof value === 'object' && !Array.isArray(value);
function cleanConfig(raw) {
    const base = defaultConfig();
    const source = record(raw) ? raw : {};
    base.enabled = source.enabled === true; base.automatic = false;
    base.branch = String(source.branch || 'main').trim().slice(0, 80) || 'main';
    base.branches = [...new Set(['main', base.branch, ...(Array.isArray(source.branches) ? source.branches.filter(v => typeof v === 'string').map(v => v.trim().slice(0, 80)).filter(Boolean).slice(0, 62) : [])])];
    if (Object.hasOwn(PROVIDERS, source.provider)) base.provider = source.provider;
    base.profileId = typeof source.profileId === 'string' ? source.profileId.slice(0, 200) : '';
    base.outputTokens = Math.min(32768, Math.max(8000, Math.trunc(Number(source.outputTokens) || 8192)));
    if (source.platforms) base.platforms = importPlatforms(source.platforms);
    base.selectionMode = source.selectionMode === 'manual' ? 'manual' : 'auto';
    base.selectedPlatforms = Array.isArray(source.selectedPlatforms) ? base.platforms.filter(p => source.selectedPlatforms.includes(p.id)).map(p => p.id) : base.platforms.map(p => p.id);
    if (typeof source.promptSource === 'string') base.promptSource = source.promptSource.slice(0, 200);
    return base;
}
function snapshotOf(raw, scope) {
    if (!record(raw) || !record(raw.source?.character) || !record(raw.source?.persona) || !Array.isArray(raw.history) || !raw.history.length || raw.history.length > 6 || !Array.isArray(raw.identity)) throw Object.assign(new Error('잘못된 장면 입력입니다.'), { status: 400 });
    if (Buffer.byteLength(JSON.stringify(raw)) > 2_000_000) throw Object.assign(new Error('장면 입력이 너무 큽니다.'), { status: 413 });
    const source = { character: {}, persona: {} };
    for (const key of ['name', 'description', 'personality']) {
        source.character[key] = typeof raw.source.character[key] === 'string' ? raw.source.character[key] : '';
        if (key !== 'personality') source.persona[key] = typeof raw.source.persona[key] === 'string' ? raw.source.persona[key] : '';
    }
    if (!source.character.description.trim() && !source.character.personality.trim()) throw new Error('캐릭터 시트 원문이 비어 있습니다.');
    const history = raw.history.map(item => {
        if (typeof item?.text !== 'string') throw new Error('장면 메시지를 읽을 수 없습니다.');
        return { name: String(item.name || ''), text: item.text };
    });
    const profileKey = JSON.stringify([scope.character, scope.branch, source.persona.name, fingerprint(source.persona)]);
    // Preserve the exact source shape used by capture for cache identities.
    delete source.persona.personality;
    if (raw.key !== fingerprint(raw.identity) || raw.sourceHash !== fingerprint(raw.source) || raw.profileKey !== profileKey) throw new Error('장면 식별자가 일치하지 않습니다. 새로고침 후 다시 생성해 주세요.');
    return { source: raw.source, history, identity: raw.identity, key: raw.key, profileKey, sourceHash: raw.sourceHash };
}
const keyStatuses = secrets => Object.fromEntries(Object.keys(PROVIDERS).map(provider => [provider, Boolean(secrets[provider])]));
const publicJob = job => job ? { id: job.id, key: job.key, status: job.status, phase: job.phase, error: job.error || '', createdAt: job.createdAt, updatedAt: job.updatedAt } : null;

export function createService({ generateFactory, fetchImpl = fetch, timeoutMs = 300000 } = {}) {
    const running = new Map();
    async function bootstrap(request, legacy) {
        const root = await rootFor(request);
        return serial(root, async () => {
            let state = await read(root, 'settings.json');
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
                state = { schema: 1, revision: 1, settings: cleanConfig(upgradeCatalog(legacy, legacy)), migratedLegacy: record(legacy), skippedLegacy, legacyHash: record(legacy) ? digest(JSON.stringify(legacy)) : '' };
                await write(root, 'settings.json', state);
            }
            const catalog = upgradeCatalog(state.settings, legacy);
            if (JSON.stringify(catalog) !== JSON.stringify(state.settings)) {
                if (!await read(root, 'migration/catalog-v1-backup.json')) await write(root, 'migration/catalog-v1-backup.json', state.settings);
                state = { ...state, revision: state.revision + 1, settings: cleanConfig(catalog) };
                await write(root, 'settings.json', state);
            }
            const secrets = await read(root, 'secrets.json', {});
            return { ok: true, protocol: 3, revision: state.revision, settings: cleanConfig(state.settings), keyStatuses: keyStatuses(secrets), migratedLegacy: state.migratedLegacy === true, legacyAccepted: record(legacy) && !state.skippedLegacy && state.legacyHash === digest(JSON.stringify(legacy)), location: 'data/<account>/crowdlens/' };
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
        return { ok: true, profiles: profiles.profiles, results: chat.results, job: publicJob(job) };
    }
    async function clear(request, body) {
        const root = await rootFor(request), scope = scopeOf(body.scope);
        return serial(root, async () => {
            const chat = await read(root, chatFile(scope), { results: {} });
            if (chat.lastJob && running.has(`${root}:${chat.lastJob}`)) throw Object.assign(new Error('진행 중인 서버 작업을 취소한 뒤 지워 주세요.'), { status: 409 });
            if (body.profileKey) {
                const key = JSON.parse(body.profileKey);
                if (key[0] !== scope.character || key[1] !== scope.branch) throw new Error('다른 캐릭터의 프로필을 지울 수 없습니다.');
                const saved = await read(root, profileFile(scope), { profiles: {} });
                delete saved.profiles[body.profileKey]; await write(root, profileFile(scope), saved);
            }
            await write(root, chatFile(scope), { ...chat, results: {} });
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
            if (state.settings.selectionMode === 'manual' && !state.settings.selectedPlatforms.length) throw new Error('생성할 커뮤니티를 하나 이상 선택해 주세요.');
            const chat = await read(root, chatFile(scope), { results: {} });
            if (chat.lastJob) {
                const prior = await read(root, jobFile(chat.lastJob));
                if (prior?.key === snapshot.key && running.has(`${root}:${prior.id}`)) return { existing: publicJob(prior) };
            }
            if ([...running.keys()].filter(k => k.startsWith(root + ':')).length >= 4) throw Object.assign(new Error('이 계정의 서버 작업이 많습니다. 완료 후 다시 시도해 주세요.'), { status: 429 });
            const secrets = await read(root, 'secrets.json', {}), apiKey = secrets[state.settings.provider];
            if (!apiKey) throw new Error('선택한 JEV 제공자의 키를 서버에 저장해 주세요.');
            const job = { id: randomUUID(), scope, key: snapshot.key, status: 'queued', phase: '서버 작업 대기', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
            const controller = new AbortController(); running.set(`${root}:${job.id}`, controller);
            try { await write(root, jobFile(job.id), job); await write(root, chatFile(scope), { ...chat, lastJob: job.id }); }
            catch (error) { running.delete(`${root}:${job.id}`); throw error; }
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
                    save: () => serial(root, () => write(root, profileFile(scope), { scope: { character: scope.character, branch: scope.branch }, profiles: settings.profiles })),
                    generate: async options => { await phase(options.systemPrompt.startsWith('Summarize') ? '사회적 프로필 판독' : '커뮤니티 반응 작성'); return generate(options); },
                    classify: async state => {
                        await phase('JEV 장면 판독');
                        return decide({ ...settings, apiKey }, state, controller.signal, null, (url, options) => {
                            const target = String(url).replace(/^\/proxy\//, '');
                            const allowed = new Set(Object.values(PROVIDERS).flatMap(p => [p.endpoint, p.usage].filter(Boolean).map(u => u.replace(/^\/proxy\//, ''))));
                            if (!allowed.has(target)) throw new Error('허용되지 않은 JEV 경로입니다.');
                            return fetchImpl(target, { ...options, redirect: 'error' });
                        });
                    },
                });
                controller.signal.throwIfAborted();
                await serial(root, async () => {
                    const chat = await read(root, chatFile(scope), { results: {} });
                    chat.results[snapshot.key] = { identity: JSON.stringify(snapshot.identity), result };
                    Object.keys(chat.results).slice(0, Math.max(0, Object.keys(chat.results).length - 80)).forEach(k => delete chat.results[k]);
                    await write(root, chatFile(scope), chat);
                    job.status = 'completed'; job.phase = '완료'; job.updatedAt = new Date().toISOString();
                    await write(root, jobFile(job.id), job);
                });
            } catch (error) {
                job.status = controller.signal.aborted ? 'cancelled' : 'failed'; job.phase = '중단'; job.error = controller.signal.aborted ? '서버 작업이 취소되거나 제한 시간을 넘었습니다.' : String(error.message || '서버 작업에 실패했습니다.').slice(0, 500); job.updatedAt = new Date().toISOString();
                await serial(root, () => write(root, jobFile(job.id), job));
            } finally { clearTimeout(timer); running.delete(`${root}:${job.id}`); }
        });
        task.catch(() => { running.delete(`${root}:${job.id}`); });
        return { ok: true, job: publicJob(job) };
    }
    return {
        bootstrap, updateSettings, saveKey, scopeData, clear, submit,
        async status(request, id) { const root = await rootFor(request); return { ok: true, job: publicJob(await getJob(root, id)) }; },
        async cancel(request, id) { const root = await rootFor(request); await getJob(root, id); running.get(`${root}:${id}`)?.abort(); return { ok: true }; },
        async close() { for (const controller of running.values()) controller.abort(); },
    };
}
