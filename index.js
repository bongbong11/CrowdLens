import { capture } from './src/snapshot.js';
import { sourceIdentity } from './src/source-selection.js';
import { prepareSource } from './src/source-reader.js';
import { ServerClient } from './src/server-client.js';
import { showSettings } from './src/settings-ui.js';
import { installLauncher } from './src/launcher.js';
import { fingerprint } from './src/core.js';

let personaModule = null;
const ctx = () => { const c = SillyTavern.getContext(); return { ...c, user_avatar: personaModule?.user_avatar ?? c.user_avatar }; };
const defaults = () => ({ version: 2, enabled: false, automatic: false, branch: 'main', branches: ['main'], selectionMode: 'auto', selectedPlatforms: [], underground: false, outputLanguage: 'en', commentVolume: 'medium', provider: 'typesafe', profileId: '', outputTokens: 8192, platforms: [], profiles: {}, results: {}, sourceSelections: {}, sourceSelectionRevisions: {}, sourceInputs: {}, latestResultKey: null });
const currentSettings = defaults(), views = new Set();
let storageError = '', currentScope = '', scopeRequest = 0, keyStatuses = { typesafe: false, nanogpt: false }, active = null, epoch = 0, popupOpen = false;
const settings = () => currentSettings;
const reportStorage = error => { storageError = error.message; document.querySelectorAll('.cl-storage-status').forEach(n => n.textContent = storageError); phase(error.message); };
const server = new ServerClient(() => ctx().getRequestHeaders(), reportStorage);
const save = () => server.save(settings());
const renderAll = () => views.forEach(view => { if (view.root.isConnected) view.render(); });
const phase = text => views.forEach(view => { if (view.root.isConnected) view.phase(text); });
const registerView = view => { views.add(view); return () => views.delete(view); };
function cancelWatch() { epoch++; active = null; }
function scopeNow() { try { return sourceIdentity(ctx(), settings().branch).scope; } catch { return null; } }
async function refreshScope(force = false) {
    const scope = scopeNow(), identity = JSON.stringify(scope);
    if (!server.ready || !scope) { currentScope = ''; Object.assign(settings(), { profiles: {}, results: {}, sourceSelections: {}, sourceSelectionRevisions: {}, sourceInputs: {}, latestResultKey: null }); renderAll(); return; }
    if (!force && identity === currentScope) return;
    const request = ++scopeRequest; currentScope = identity;
    try {
        const data = await server.request('scope', { scope });
        if (request !== scopeRequest || identity !== JSON.stringify(scopeNow())) return;
        let prepared = null, sourceId;
        try { sourceId = sourceIdentity(ctx(), settings().branch); if (data.sourceSelections?.[sourceId.profileKey]) prepared = await prepareSource(ctx(), data.sourceSelections[sourceId.profileKey]); }
        catch (error) { reportStorage(error); }
        if (request !== scopeRequest || identity !== JSON.stringify(scopeNow())) return;
        Object.assign(settings(), { profiles: data.profiles, results: data.results, sourceSelections: data.sourceSelections || {}, sourceSelectionRevisions: data.sourceSelectionRevisions || {}, latestResultKey: data.latestResultKey, sourceInputs: prepared ? { [sourceId.profileKey]: prepared } : {} });
        renderAll();
        if (data.job && ['queued', 'running'].includes(data.job.status) && !active) void watchJob(data.job, scope).catch(reportStorage);
    } catch (error) { reportStorage(error); }
}
async function watchJob(job, scope, onPhase) {
    const token = ++epoch, task = { id: job.id, scope }; active = task; renderAll();
    try {
        while (token === epoch && JSON.stringify(scope) === JSON.stringify(scopeNow())) {
            const data = await server.request(`jobs/${job.id}`, undefined, 'GET');
            if (token !== epoch) return null;
            phase(data.job.phase); onPhase?.(data.job.phase);
            if (!['queued', 'running'].includes(data.job.status)) {
                if (active === task) active = null;
                await refreshScope(true);
                if (data.job.status !== 'completed') { phase(data.job.error || '서버 작업이 중단되었습니다.'); throw new Error(data.job.error || '서버 작업이 중단되었습니다.'); }
                phase('');
                return data.job;
            }
            await new Promise(resolve => setTimeout(resolve, 700));
        }
        return null;
    } finally { if (active === task) { active = null; renderAll(); } }
}
async function preparedIdentity(context = ctx(), branch = settings().branch) {
    const id = sourceIdentity(context, branch), selected = settings().sourceSelections[id.profileKey];
    if (!selected) throw new Error('프로필 탭에서 시트·로어북 입력 선택을 먼저 저장해 주세요.');
    const prepared = await prepareSource(context, selected);
    const live = sourceIdentity(ctx(), settings().branch);
    if (JSON.stringify(id.scope) !== JSON.stringify(live.scope) || id.profileKey !== live.profileKey || fingerprint(id.base) !== fingerprint(live.base)) throw new Error('채팅·시트·페르소나가 바뀌었습니다. 다시 눌러 주세요.');
    settings().sourceInputs[id.profileKey] = prepared; return id;
}
async function submitWork(work, onPhase) {
    if (active) throw new Error('진행 중인 작업이 끝난 뒤 눌러 주세요.');
    const token = ++epoch, submitting = { submitting: true }; active = submitting; renderAll();
    try {
        await server.flush();
        if (token !== epoch) return null;
        const data = await work(server.revision);
        if (active === submitting) active = null;
        if (token !== epoch) return null;
        if (data.cached) { await refreshScope(true); return { status: 'completed' }; }
        return await watchJob(data.job, data.scope || scopeNow(), onPhase);
    } finally { if (active === submitting) { active = null; renderAll(); } }
}
async function generate() {
    try {
        if (!settings().enabled) throw new Error('설정에서 CrowdLens 사용을 켜 주세요.');
        const current = ctx(), index = current.chat.findLastIndex(m => !m.is_user && !m.is_system);
        if (index < 0) throw new Error('생성할 RP 응답이 없습니다.');
        if (current.streamingProcessor) throw new Error('현재 RP 응답이 완성된 뒤 생성해 주세요.');
        if (settings().selectionMode === 'manual' && !settings().selectedPlatforms.length) throw new Error('생성할 커뮤니티를 체크해 주세요.');
        if (settings().selectionMode !== 'manual' && !keyStatuses[settings().provider]) throw new Error('자동 선택에는 JEV 키가 필요합니다.');
        const chat = [], characters = []; chat.length = index + 1;
        for (let i = Math.max(0, index - 5); i <= index; i++) chat[i] = structuredClone(current.chat[i]);
        characters[current.characterId] = structuredClone(current.characters[current.characterId]);
        const power = current.powerUserSettings || {}, personas = power.persona_descriptions || {};
        const persona = personas[current.user_avatar] || Object.values(personas).find(p => p?.name === current.name1);
        const frozen = { ...current, chat, characters, powerUserSettings: { persona_description: power.persona_description, persona_description_lorebook: power.persona_description_lorebook, persona_descriptions: persona ? { [current.user_avatar || '_active']: structuredClone(persona) } : {} }, persona: current.persona ? { description: current.persona.description } : undefined };
        const branch = settings().branch;
        await submitWork(async revision => {
            await preparedIdentity(frozen, branch);
            const snapshot = capture(frozen, { ...settings(), branch }, index);
            const profile = settings().profiles[snapshot.profileKey];
            if (profile?.language !== 'en' || profile.sourceHash !== snapshot.sourceHash) throw new Error('프로필 탭에서 선택한 입력을 먼저 판독해 주세요.');
            const data = await server.request('jobs', { snapshot, scope: snapshot.scope, revision });
            return { ...data, scope: snapshot.scope };
        });
    } catch (error) { phase(error.message); }
}
async function readProfile(snapshot, onPhase) {
    const result = await submitWork(async revision => ({ ...await server.request('profile/jobs', { snapshot, scope: snapshot.scope, revision }), scope: snapshot.scope }), onPhase);
    if (!result) throw new Error('화면 범위가 바뀌었습니다. 원래 프로필 탭에서 완료 상태를 확인해 주세요.');
}
async function translate(key, platform) { const scope = scopeNow(); return submitWork(async revision => ({ ...await server.request('translations', { scope, key, platform, revision }), scope })); }
async function open() {
    if (popupOpen) return; popupOpen = true;
    try { await showSettings({ context: ctx(), getContext: ctx, state: settings(), server, status: storageError, keyStatuses, onKeys: value => keyStatuses = value,
        onChange: async () => { if (currentScope !== JSON.stringify(scopeNow())) cancelWatch(); await save(); await refreshScope(); renderAll(); },
        onReconnect: async () => { await connectStorage(); await refreshScope(true); },
        onClear: async () => { await server.request('scope/clear', { scope: scopeNow() }); await refreshScope(true); },
        onCancel: async () => { if (!active?.id) return '진행 중인 작업이 없습니다.'; await server.request(`jobs/${active.id}/cancel`, {}); return '취소를 요청했습니다.'; },
        onPrepared: renderAll, onReadProfile: readProfile, onGenerate: generate, onTranslate: translate,
        onDeleteFeed: async key => { await server.request('scope/clear', { scope: scopeNow(), key }); await refreshScope(true); },
        isBusy: () => Boolean(active), registerView,
    }); } finally { popupOpen = false; }
}
async function connectStorage() {
    const c = ctx(), legacy = c.extensionSettings.crowdlens;
    const data = await server.initialize(legacy || defaults());
    Object.assign(currentSettings, data.settings, { profiles: {}, results: {}, sourceSelections: {}, sourceSelectionRevisions: {}, sourceInputs: {}, latestResultKey: null }); keyStatuses = data.keyStatuses; storageError = '';
    if (legacy && data.legacyAccepted && c.extensionSettings.crowdlens === legacy) { delete c.extensionSettings.crowdlens; c.saveSettingsDebounced(); }
}
async function init() {
    personaModule = await import('/scripts/personas.js').catch(() => null);
    try { await connectStorage(); } catch (error) { reportStorage(error); }
    installLauncher(() => { void open().catch(reportStorage); });
    const c = ctx(), events = c.eventTypes;
    if (events.CHAT_CHANGED) c.eventSource.on(events.CHAT_CHANGED, () => { cancelWatch(); void refreshScope(true); });
    await refreshScope(true);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else void init();
