import { randomUUID } from 'node:crypto';
import { ensureProfile } from './runtime/profile.js';
import { fingerprint } from './runtime/core.js';
import { normalizeSelection } from './runtime/source-selection.js';
import { validateProfileKey, validateProfileSnapshot } from './source-contract.mjs';
import { rootFor, scopeOf, profileFile, chatFile, jobFile, read, write, serial } from './storage.mjs';

export async function saveProfile(root, scope, snapshot, record) {
    return serial(root, async () => {
        const current = await read(root, profileFile(scope), { profiles: {} });
        if (current.selections?.[snapshot.profileKey] && fingerprint(normalizeSelection(current.selections[snapshot.profileKey])) !== snapshot.selectionHash) throw new Error('입력 선택이 바뀌어 이전 판독 결과를 저장하지 않았습니다.');
        await write(root, profileFile(scope), { ...current, profiles: { ...current.profiles, [snapshot.profileKey]: record } });
    });
}
export function createProfileService({ running, runningScopes, generateFactory, timeoutMs, publicJob }) {
    async function select(request, body) {
        const root = await rootFor(request), scope = scopeOf(body.scope), selection = normalizeSelection(body.selection);
        validateProfileKey(body.profileKey, scope);
        return serial(root, async () => {
            const current = await read(root, profileFile(scope), { profiles: {} }), revision = current.selectionRevisions?.[body.profileKey] || 0;
            if (body.revision !== revision) throw Object.assign(new Error('다른 창에서 입력 선택이 변경되었습니다. 다시 불러와 주세요.'), { status: 409 });
            const next = revision + 1;
            await write(root, profileFile(scope), { ...current, selections: { ...current.selections, [body.profileKey]: selection }, selectionRevisions: { ...current.selectionRevisions, [body.profileKey]: next } });
            return { ok: true, selection, revision: next };
        });
    }
    async function submit(request, body) {
        const root = await rootFor(request), scope = scopeOf(body.scope), snapshot = validateProfileSnapshot(body.snapshot, scope);
        const start = await serial(root, async () => {
            const state = await read(root, 'settings.json');
            if (!state || body.revision !== state.revision) throw Object.assign(new Error('연결 설정이 바뀌었습니다. 새로고침해 주세요.'), { status: 409 });
            const profile = await read(root, profileFile(scope), { profiles: {} }), selected = profile.selections?.[snapshot.profileKey];
            if (!selected || fingerprint(normalizeSelection(selected)) !== snapshot.selectionHash) throw new Error('프로필 입력 선택을 먼저 저장해 주세요.');
            const key = fingerprint([snapshot.profileKey, snapshot.sourceHash, snapshot.selectionHash]);
            const chat = await read(root, chatFile(scope), { results: {} }), previousId = chat.profileJobs?.[key];
            if (previousId && running.has(`${root}:${previousId}`)) return { existing: publicJob(await read(root, jobFile(previousId))) };
            if ([...running.keys()].filter(k => k.startsWith(root + ':')).length >= 4) throw new Error('진행 중인 작업이 많습니다. 완료 후 판독해 주세요.');
            const job = { id: randomUUID(), key, scope, kind: 'profile', status: 'queued', phase: '프로필 판독 대기', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
            const controller = new AbortController(); running.set(`${root}:${job.id}`, controller); runningScopes.set(`${root}:${job.id}`, JSON.stringify(scope));
            try {
                await write(root, jobFile(job.id), job);
                const profileJobs = Object.fromEntries([...Object.entries(chat.profileJobs || {}).filter(([k]) => k !== key), [key, job.id]].slice(-80));
                await write(root, chatFile(scope), { ...chat, profileJobs, lastJob: job.id });
            } catch (error) { running.delete(`${root}:${job.id}`); runningScopes.delete(`${root}:${job.id}`); throw error; }
            return { job, controller, config: state.settings };
        });
        if (start.existing) return { ok: true, job: start.existing };
        const { job, controller, config } = start;
        const task = serial(`${root}:generation:${profileFile(scope)}`, async () => {
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                controller.signal.throwIfAborted();
                const generate = await generateFactory(request.user, config, controller.signal);
                const current = await read(root, profileFile(scope), { profiles: {} }), settings = { ...config, profiles: current.profiles };
                job.status = 'running'; job.phase = '영문 사회적 프로필만 판독 중'; await serial(root, () => write(root, jobFile(job.id), job));
                console.info('[CrowdLens][profile-service] prepared', { loreEntries: snapshot.source.lore?.length || 0, profileOnly: true });
                await ensureProfile({ snapshot, settings, force: true, valid: () => !controller.signal.aborted, generate: options => {
                    console.info('[CrowdLens][profile-service] request_included', { loreEntries: snapshot.source.lore?.length || 0, profileOnly: true });
                    return generate(options);
                }, save: () => saveProfile(root, scope, snapshot, settings.profiles[snapshot.profileKey]) });
                job.status = 'completed'; job.phase = '프로필 판독 완료'; job.updatedAt = new Date().toISOString(); await serial(root, () => write(root, jobFile(job.id), job));
            } catch (error) {
                job.status = controller.signal.aborted ? 'cancelled' : 'failed'; job.phase = '프로필 판독 중단'; job.error = String(error.message).slice(0, 500); job.updatedAt = new Date().toISOString(); await serial(root, () => write(root, jobFile(job.id), job));
            } finally { clearTimeout(timer); running.delete(`${root}:${job.id}`); runningScopes.delete(`${root}:${job.id}`); }
        });
        task.catch(() => {}); return { ok: true, job: publicJob(job) };
    }
    return { select, submit };
}
