import { PROVIDERS, DEFAULT_PLATFORMS, importPlatforms } from './src/core.js';
import { capture } from './src/snapshot.js';
import { ServerClient } from './src/server-client.js';

let personaModule = null;
const ctx = () => { const context = SillyTavern.getContext(); return { ...context, user_avatar: personaModule?.user_avatar ?? context.user_avatar }; };
const defaults = () => ({ version: 2, enabled: false, automatic: false, branch: 'main', provider: 'typesafe', profileId: '', outputTokens: 8192, platforms: structuredClone(DEFAULT_PLATFORMS), profiles: {}, results: {} });
let currentSettings = defaults(), storageError = '', scopeRequest = 0, currentScope = '';
const settings = () => currentSettings;
function reportStorage(error) { storageError = error.message; document.querySelectorAll('.cl-storage-status').forEach(n => n.textContent = storageError); }
const server = new ServerClient(() => ctx().getRequestHeaders(), reportStorage);
const save = () => server.save(settings());
const apiKeys = { typesafe: '', nanogpt: '' };
let keyStatuses = { typesafe: false, nanogpt: false };
let active = null, epoch = 0;
const panels = new Map();
function el(tag, content, className) {
    const node = document.createElement(tag);
    if (content !== undefined) node.textContent = content;
    if (className) node.className = className;
    return node;
}
function button(label, action) {
    const node = el('button', label, 'menu_button');
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
}
function cancel() { epoch++; active = null; }
function scopeNow() {
    const c = ctx(), character = c.characters?.[c.characterId]?.avatar;
    return !c.groupId && character && c.chatId ? { character, chat: c.chatId, branch: settings().branch || 'main' } : null;
}
async function refreshScope(force = false) {
    const scope = scopeNow(), identity = JSON.stringify(scope);
    if (!server.ready || !scope) { currentScope = ''; settings().profiles = {}; settings().results = {}; renderAll(); return; }
    if (!force && identity === currentScope) return;
    const request = ++scopeRequest;
    if (identity !== currentScope) { settings().profiles = {}; settings().results = {}; }
    currentScope = identity;
    try {
        const data = await server.request('scope', { scope });
        if (request !== scopeRequest || identity !== JSON.stringify(scopeNow())) return;
        settings().profiles = data.profiles; settings().results = data.results; renderAll();
        if (data.job && ['queued', 'running'].includes(data.job.status) && !active) void watchJob(data.job, scope);
    } catch (error) { reportStorage(error); }
}
async function watchJob(job, scope) {
    const token = ++epoch, task = { id: job.id, scope }; active = task; renderAll();
    try {
        while (token === epoch && JSON.stringify(scope) === JSON.stringify(scopeNow())) {
            const data = await server.request(`jobs/${job.id}`, undefined, 'GET');
            if (token !== epoch) return;
            document.querySelectorAll('.crowdlens .cl-status').forEach(n => n.textContent = `${data.job.phase} · 서버에서 실행 중 (탭을 닫아도 계속됩니다)`);
            if (!['queued', 'running'].includes(data.job.status)) {
                if (active === task) active = null;
                await refreshScope(true);
                if (data.job.status !== 'completed') document.querySelectorAll('.crowdlens .cl-status').forEach(n => n.textContent = data.job.error || '서버 작업이 중단되었습니다.');
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    } catch (error) { reportStorage(error); }
    finally { if (active === task) { active = null; renderAll(); } }
}
function rpIndex() { return ctx().chat.findLastIndex(m => !m.is_user && !m.is_system); }
function canRun() { const c = ctx(); return !active && !c.streamingProcessor && !document.querySelector('#send_but[style*="display: none"]'); }
function stateAt(index) {
    const snapshot = capture(ctx(), settings(), index);
    const cached = settings().results[snapshot.key];
    return { snapshot, result: cached?.identity === JSON.stringify(snapshot.identity) ? cached.result : null };
}
function tabs(container, feeds) {
    const bar = el('div', undefined, 'cl-tabs');
    bar.setAttribute('role', 'tablist');
    const body = el('div', undefined, 'cl-feed');
    const buttons = [];
    function select(feed, selected) {
        buttons.forEach(b => { b.setAttribute('aria-selected', String(b === selected)); b.tabIndex = b === selected ? 0 : -1; });
        body.replaceChildren();
        body.className = `cl-feed cl-${feed.style}`;
        body.id = `${selected.id}-panel`;
        body.setAttribute('role', 'tabpanel');
        body.setAttribute('aria-labelledby', selected.id);
        body.append(el('div', feed.name, 'cl-platform'));
        for (const post of feed.posts) {
            const article = el('article', undefined, post.replyTo != null ? 'cl-post cl-reply' : 'cl-post');
            const head = el('div', undefined, 'cl-post-head');
            const groupNames = { acquaintances: '지인', colleagues: '동료·업계', fans: '팬덤', media: '미디어', public: '일반 이용자', critics: '비판적 이용자' };
            head.append(el('span', post.author.slice(0, 1), 'cl-avatar'), el('strong', feed.style === 'anon' ? 'Anonymous' : post.author), el('small', groupNames[post.group] || '이용자'));
            article.append(head);
            const regionNames = { us: '🇺🇸 미국권', europe: '🇪🇺 유럽권', eastasia: '🌏 동아시아권' };
            article.append(el('small', `${regionNames[post.region] || ''} · ${post.culture === 'korean' ? '💬 한국어 반응' : '🌐 한국어로 번역된 반응'}`, `cl-culture cl-culture-${post.culture === 'korean' ? 'ko' : 'translated'}`));
            if (post.replyTo != null && feed.posts[post.replyTo]) article.append(el('small', `↳ ${feed.posts[post.replyTo].author}에게 답글`, 'cl-reply-reference'));
            if (post.title) article.append(el('h4', post.title));
            article.append(el('p', post.body));
            const meta = feed.style === 'anon' ? `No.${feed.posts.indexOf(post) + 1} · 인용` : ['live', 'chat'].includes(feed.style) ? '장면 속 대화' : feed.style === 'forum' ? '↑  ·  ↓  ·  답글' : feed.style === 'photo' ? '♡  답글 달기' : '♡  ↻  답글';
            article.append(el('div', meta, 'cl-meta'));
            body.append(article);
        }
    }
    feeds.forEach((feed, i) => {
        const tab = button(feed.name, () => select(feed, tab));
        tab.id = `cl-tab-${crypto.randomUUID()}`;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', `${tab.id}-panel`);
        tab.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (i + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
            buttons[next].click(); buttons[next].focus();
        });
        buttons.push(tab); bar.append(tab);
    });
    container.append(bar, body);
    if (feeds.length) select(feeds[0], buttons[0]);
}
function render(index) {
    const host = document.querySelector(`#chat .mes[mesid="${index}"] .mes_block`);
    if (!host) return;
    let panel = host.querySelector(':scope > .crowdlens');
    const open = panel?.open || false;
    panel?.remove();
    const message = ctx().chat[index];
    if (!settings().enabled || !message || message.is_user || message.is_system || ctx().groupId) return;
    panel = el('details', undefined, 'crowdlens'); panel.open = open;
    panel.append(el('summary', 'CrowdLens · 커뮤니티 반응'));
    const content = el('div', undefined, 'cl-content');
    const status = el('p', '', 'cl-status');
    const run = button('이 장면 반응 생성', () => generate(index));
    if (active) run.disabled = true;
    content.append(run, status); panel.append(content); host.append(panel);
    panels.set(index, status);
    try {
        const { result } = stateAt(index);
        if (result) {
            run.textContent = '이 장면 다시 생성';
            status.textContent = result.reason || '해당 장면의 가상 반응';
            tabs(content, result.feeds);
        }
    } catch (error) { status.textContent = error.message; }
}
function renderAll() {
    panels.clear();
    document.querySelectorAll('#chat .mes[mesid]').forEach(node => render(Number(node.getAttribute('mesid'))));
}
async function generate(index) {
    if (!settings().enabled) return;
    if (!canRun()) { if (panels.get(index)) panels.get(index).textContent = '현재 생성이 끝난 뒤 다시 눌러 주세요.'; return; }
    if (!server.ready) { reportStorage(new Error('CrowdLens 서버 플러그인을 먼저 연결해 주세요.')); return; }
    if (!keyStatuses[settings().provider]) { if (panels.get(index)) panels.get(index).textContent = '마법봉 → CrowdLens 설정에서 선택한 제공자의 JEV 키를 서버에 저장해 주세요.'; return; }
    const token = ++epoch, submitting = { submitting: true }; active = submitting; renderAll();
    try {
        const snapshot = capture(ctx(), settings(), index);
        const data = await server.submit(snapshot);
        if (active === submitting) active = null;
        if (token === epoch) await watchJob(data.job, snapshot.scope);
    } catch (error) {
        if (active === submitting) active = null;
        renderAll(); if (panels.get(index)) panels.get(index).textContent = error.message;
    }
}
function field(root, label, value, change, type = 'text') {
    const wrap = el('label', undefined, 'cl-field');
    const input = el('input'); input.type = type;
    if (type === 'checkbox') input.checked = value; else input.value = value;
    input.addEventListener('change', () => { cancel(); change(type === 'checkbox' ? input.checked : input.value); save(); void refreshScope(); renderAll(); });
    wrap.append(el('span', label), input); root.append(wrap); return input;
}
async function openSettings() {
    const s = settings();
    const root = el('div', undefined, 'cl-settings');
    root.append(el('h3', 'CrowdLens'), el('p', '장면 한정 가상 커뮤니티 피드. 캐릭터 시트와 원본 채팅은 수정하지 않습니다.'));
    root.append(el('p', storageError || (server.ready ? '서버 저장소 연결됨 · 계정별 crowdlens/ 폴더 · 판독/생성은 서버에서 실행' : 'CrowdLens 서버 플러그인이 필요합니다.'), 'cl-storage-status'));
    root.append(button('서버 저장소 다시 연결', async () => { try { await connectStorage(); await refreshScope(true); storageError = ''; root.querySelector('.cl-storage-status').textContent = '서버 저장소 연결됨'; } catch (error) { reportStorage(error); } }));
    field(root, '사용', s.enabled, v => s.enabled = v, 'checkbox');
    field(root, '새 RP 응답에서 자동 생성', s.automatic, v => s.automatic = v, 'checkbox');
    field(root, '프로필 브랜치 (기본 main)', s.branch, v => s.branch = v.trim().slice(0, 80) || 'main');
    const outputLimit = field(root, '연결 모델 최대 출력 토큰 (8,000~32,768)', s.outputTokens, v => { s.outputTokens = Math.min(32768, Math.max(8000, Number(v) || 8192)); outputLimit.value = s.outputTokens; }, 'number');
    outputLimit.min = '8000'; outputLimit.max = '32768'; outputLimit.step = '1';
    const modelLabel = el('label', undefined, 'cl-field');
    const modelSelect = el('select');
    const currentModel = el('option', '현재 SillyTavern 연결 모델'); currentModel.value = ''; modelSelect.append(currentModel);
    try {
        for (const profile of ctx().ConnectionManagerRequestService?.getSupportedProfiles() || []) {
            const option = el('option', `${profile.name || profile.id} · ${profile.model || ''}`); option.value = String(profile.id); modelSelect.append(option);
        }
    } catch { /* Current main connection remains available. */ }
    modelSelect.value = s.profileId || '';
    modelSelect.addEventListener('change', () => { cancel(); s.profileId = modelSelect.value; save(); });
    modelLabel.append(el('span', '프로필·반응 작성용 연결 프로필'), modelSelect); root.append(modelLabel);
    const providerLabel = el('label', undefined, 'cl-field');
    const providerSelect = el('select');
    for (const [id, provider] of Object.entries(PROVIDERS)) { const option = el('option', provider.name); option.value = id; providerSelect.append(option); }
    providerSelect.value = s.provider;
    providerLabel.append(el('span', 'JEV 연결 제공자'), providerSelect); root.append(providerLabel);
    const keyLabel = el('label', undefined, 'cl-field'), keyInput = el('input'); keyInput.type = 'password'; keyInput.autocomplete = 'off';
    keyInput.addEventListener('input', () => apiKeys[s.provider] = keyInput.value.trim());
    keyLabel.append(el('span', '선택한 제공자의 API 키 (서버 전용 저장)'), keyInput); root.append(keyLabel);
    const providerHint = el('p', '', 'cl-status'); root.append(providerHint);
    const updateProvider = () => {
        keyInput.value = apiKeys[s.provider];
        providerHint.textContent = `${keyStatuses[s.provider] ? '서버에 키 저장됨' : '저장된 키 없음'} · 모델: ${PROVIDERS[s.provider].model}. 서버가 직접 연결하므로 CORS 프록시는 필요 없습니다.${s.provider === 'nanogpt' ? ' NanoGPT 키는 Billing을 Subscription only로 설정하세요.' : ''}`;
    };
    providerSelect.addEventListener('change', () => { cancel(); s.provider = providerSelect.value; save(); updateProvider(); });
    updateProvider();
    root.append(button('JEV 키 서버에 저장', async () => {
        try { const provider = s.provider; if (!apiKeys[provider]) throw new Error('저장할 키를 입력해 주세요.'); const data = await server.request('keys', { provider, key: apiKeys[provider] }); keyStatuses = data.keyStatuses; apiKeys[provider] = ''; if (provider === s.provider) keyInput.value = ''; updateProvider(); }
        catch (error) { providerHint.textContent = error.message; }
    }), button('선택한 JEV 키 삭제', async () => {
        try { const data = await server.request('keys', { provider: s.provider, key: '' }); keyStatuses = data.keyStatuses; apiKeys[s.provider] = ''; keyInput.value = ''; updateProvider(); }
        catch (error) { providerHint.textContent = error.message; }
    }));
    root.append(el('p', '프로필·반응은 SillyTavern 연결 모델이 작성합니다. 선택한 JEV 제공자는 짧은 프로필과 최근 6개 메시지를 받아 판정합니다.'));
    const notice = el('p', `${s.platforms.length}개 플랫폼 · ${s.promptSource || '기본 예시 프롬프트'}`, 'cl-status');
    const file = el('input'); file.type = 'file'; file.accept = '.json,application/json';
    file.addEventListener('change', async () => {
        try {
            const selected = file.files[0]; if (!selected) return;
            if (selected.size > 1024 * 1024) throw new Error('1MB 이하 JSON 파일을 선택해 주세요.');
            const imported = importPlatforms(JSON.parse(await selected.text()));
            cancel(); s.platforms = imported; s.promptSource = selected.name; s.results = {}; save(); renderAll();
            notice.textContent = `가져온 플랫폼: ${imported.map(p => p.name).join(', ')}`;
        } catch (e) { notice.textContent = e.message; }
    });
    root.append(el('label', '플랫폼 프롬프트 JSON 가져오기'), file, notice);
    const profiles = el('pre', '', 'cl-profile');
    const showProfile = () => {
        try {
            const snap = capture(ctx(), s, rpIndex());
            profiles.textContent = JSON.stringify(s.profiles[snap.profileKey]?.profile ?? '첫 반응 생성 시 연결 모델이 프로필을 만듭니다.', null, 2);
        } catch (e) { profiles.textContent = e.message; }
    };
    const branchInput = root.querySelectorAll('input')[2]; branchInput.addEventListener('change', showProfile);
    root.append(button('현재 브랜치 프로필 새로 판독', async () => {
        try {
            const snap = capture(ctx(), s, rpIndex());
            cancel(); await server.request('scope/clear', { scope: snap.scope, profileKey: snap.profileKey }); await refreshScope(true);
            await generate(rpIndex()); showProfile();
        } catch (e) { notice.textContent = e.message; }
    }), profiles);
    root.append(button('현재 채팅·브랜치 피드 지우기', async () => { try { await server.request('scope/clear', { scope: scopeNow() }); await refreshScope(true); notice.textContent = '현재 채팅·브랜치의 저장된 피드를 지웠습니다.'; } catch (error) { notice.textContent = error.message; } }));
    root.append(button('진행 중 서버 작업 취소', async () => { try { if (active?.id) await server.request(`jobs/${active.id}/cancel`, {}); else notice.textContent = '현재 화면에서 확인 중인 서버 작업이 없습니다.'; } catch (error) { notice.textContent = error.message; } }));
    showProfile();
    await ctx().callGenericPopup(root, ctx().POPUP_TYPE.TEXT, '', { wide: true, large: true });
}
async function connectStorage() {
    const context = ctx();
    const legacy = context.extensionSettings.crowdlens;
    let initial = legacy;
    if (!initial) {
        initial = defaults();
        try {
            const response = await fetch(new URL('./prompts/community-reactions.json', import.meta.url));
            if (!response.ok) throw new Error('bundled prompt load failed');
            initial.platforms = importPlatforms(await response.json());
            initial.promptSource = '커뮤반응모음.json';
        } catch { console.warn('[CrowdLens] Bundled prompts unavailable; import the source JSON in settings.'); }
    }
    const data = await server.initialize(initial);
    Object.assign(currentSettings, data.settings, { profiles: {}, results: {} }); keyStatuses = data.keyStatuses; storageError = '';
    if (legacy && data.legacyAccepted && context.extensionSettings.crowdlens === legacy) { delete context.extensionSettings.crowdlens; context.saveSettingsDebounced(); }
    else if (legacy && !data.legacyAccepted) storageError = '서버에는 기존 자료가 있어 현재 서버 자료를 사용합니다. 일치하지 않는 예전 settings.json 자료는 삭제하지 않고 보존했습니다.';
}
async function init() {
    personaModule = await import('/scripts/personas.js').catch(() => null);
    const context = ctx();
    try { await connectStorage(); } catch (error) { reportStorage(error); }
    const menu = document.querySelector('#extensionsMenu');
    if (menu && !document.querySelector('#crowdlens-menu')) {
        const item = el('div', 'CrowdLens 설정', 'list-group-item flex-container flexGap5');
        const icon = el('img'); icon.src = new URL('./icon.svg', import.meta.url).href; icon.alt = ''; icon.width = 22; icon.height = 22; item.prepend(icon);
        item.id = 'crowdlens-menu'; item.tabIndex = 0; item.setAttribute('role', 'button');
        item.addEventListener('click', openSettings);
        item.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSettings(); } });
        menu.append(item);
    }
    const events = context.eventTypes;
    for (const name of ['CHAT_CHANGED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'MESSAGE_SENT']) if (events[name]) context.eventSource.on(events[name], () => { cancel(); void refreshScope(true); renderAll(); });
    if (events.CHARACTER_MESSAGE_RENDERED) context.eventSource.on(events.CHARACTER_MESSAGE_RENDERED, index => render(Number(index)));
    if (events.GENERATION_ENDED) context.eventSource.on(events.GENERATION_ENDED, () => {
        renderAll();
        if (settings().enabled && settings().automatic) setTimeout(() => {
            const index = rpIndex();
            if (index < 0 || index !== ctx().chat.length - 1 || !canRun()) return;
            try { if (!stateAt(index).result) void generate(index); } catch { /* No supported chat open. */ }
        }, 100);
    });
    await refreshScope(true); renderAll();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
