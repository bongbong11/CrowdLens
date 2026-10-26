import { PROVIDERS, DEFAULT_PLATFORMS, importPlatforms, fingerprint } from './src/core.js';
import { capture, decide, runScene } from './src/engine.js';
import { requestModel } from './src/model.js';

let personaModule = null;
const ctx = () => { const context = SillyTavern.getContext(); return { ...context, user_avatar: personaModule?.user_avatar ?? context.user_avatar }; };
const defaults = () => ({ version: 1, enabled: false, automatic: false, branch: 'main', provider: 'typesafe', profileId: '', outputTokens: 8192, platforms: structuredClone(DEFAULT_PLATFORMS), profiles: {}, results: {} });
const settings = () => ctx().extensionSettings.crowdlens;
const save = () => ctx().saveSettingsDebounced();
const apiKeys = { typesafe: '', nanogpt: '', openrouter: '' };
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
function cancel() { epoch++; active?.controller.abort(); }
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
            const article = el('article', undefined, 'cl-post');
            const head = el('div', undefined, 'cl-post-head');
            const groupNames = { acquaintances: '지인', colleagues: '동료·업계', fans: '팬덤', media: '미디어', public: '일반 이용자', critics: '비판적 이용자' };
            head.append(el('span', post.author.slice(0, 1), 'cl-avatar'), el('strong', feed.style === 'anon' ? 'Anonymous' : post.author), el('small', groupNames[post.group] || '이용자'));
            article.append(head);
            if (post.title) article.append(el('h4', post.title));
            article.append(el('p', post.body));
            const meta = feed.style === 'anon' ? `No.${feed.posts.indexOf(post) + 1} · 인용` : ['live', 'chat', 'sms'].includes(feed.style) ? '장면 속 대화' : feed.style === 'forum' ? '↑  ·  ↓  ·  답글' : feed.style === 'photo' ? '♡  답글 달기' : '♡  ↻  답글';
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
    if (!apiKeys[settings().provider]) { if (panels.get(index)) panels.get(index).textContent = '마법봉 → CrowdLens 설정에서 선택한 제공자의 JEV 키를 입력해 주세요.'; return; }
    const controller = new AbortController();
    const token = ++epoch;
    active = { controller };
    renderAll();
    const status = panels.get(index);
    if (status) status.textContent = '프로필 확인 → JEV 장면 판독 → 커뮤니티 반응 작성 중…';
    const timeout = setTimeout(() => controller.abort(), 300000);
    try {
        const s = settings();
        const snapshot = capture(ctx(), s, index);
        const signature = fingerprint([s.branch, s.platforms, s.provider, s.profileId, s.outputTokens]);
        const valid = () => {
            try { return !controller.signal.aborted && token === epoch && s.enabled && signature === fingerprint([s.branch, s.platforms, s.provider, s.profileId, s.outputTokens]) && stateAt(index).snapshot.key === snapshot.key; }
            catch { return false; }
        };
        const result = await runScene({ snapshot, settings: s, valid, save,
            generate: options => requestModel(ctx(), s, options, controller.signal),
            classify: state => decide({ ...s, apiKey: apiKeys[s.provider] }, state, controller.signal, ctx().getRequestHeaders),
        });
        if (!valid()) return;
        s.results[snapshot.key] = { identity: JSON.stringify(snapshot.identity), result };
        const keys = Object.keys(s.results);
        keys.slice(0, Math.max(0, keys.length - 80)).forEach(k => delete s.results[k]);
        save();
    } catch (error) {
        if (token === epoch && status) status.textContent = controller.signal.aborted ? '시간 초과 또는 취소되었습니다. 다시 시도해 주세요.' : error.message;
        console.warn('[CrowdLens]', error.name);
        active = null;
        document.querySelectorAll('.crowdlens button').forEach(b => b.disabled = false);
        return;
    } finally { clearTimeout(timeout); active = null; }
    renderAll();
}
function field(root, label, value, change, type = 'text') {
    const wrap = el('label', undefined, 'cl-field');
    const input = el('input'); input.type = type;
    if (type === 'checkbox') input.checked = value; else input.value = value;
    input.addEventListener('change', () => { cancel(); change(type === 'checkbox' ? input.checked : input.value); save(); renderAll(); });
    wrap.append(el('span', label), input); root.append(wrap); return input;
}
async function openSettings() {
    const s = settings();
    const root = el('div', undefined, 'cl-settings');
    root.append(el('h3', 'CrowdLens'), el('p', '장면 한정 가상 커뮤니티 피드. 캐릭터 시트와 원본 채팅은 수정하지 않습니다.'));
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
    const keyInput = field(root, '선택한 제공자의 API 키 (현재 탭에서만 보관)', apiKeys[s.provider], v => apiKeys[s.provider] = v.trim(), 'password');
    const providerHint = el('p', '', 'cl-status'); root.append(providerHint);
    const updateProvider = () => {
        keyInput.value = apiKeys[s.provider];
        providerHint.textContent = s.provider === 'typesafe'
            ? '공홈 연결: SillyTavern config.yaml에서 enableCorsProxy: true가 필요합니다. 기본 인증(basicAuth)과 함께 사용할 수 없습니다. 모델: jev-latest'
            : s.provider === 'nanogpt' ? '씬판독기와 같은 구독 전용 경로를 사용합니다. 키의 Billing을 Subscription only로 설정하세요. enableCorsProxy: true가 필요하며 basicAuth와 함께 사용할 수 없습니다. 모델: typesafe/jev-1.14'
            : `모델: ${PROVIDERS[s.provider].model}. 제공자별 API 키는 서로 분리해 보관합니다.`;
    };
    providerSelect.addEventListener('change', () => { cancel(); s.provider = providerSelect.value; save(); updateProvider(); });
    updateProvider();
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
            cancel(); delete s.profiles[snap.profileKey]; s.results = {}; save();
            await generate(rpIndex()); showProfile();
        } catch (e) { notice.textContent = e.message; }
    }), profiles);
    root.append(button('피드 저장 결과 지우기', () => { cancel(); s.results = {}; save(); renderAll(); notice.textContent = '저장된 피드를 지웠습니다.'; }));
    showProfile();
    await ctx().callGenericPopup(root, ctx().POPUP_TYPE.TEXT, '', { wide: true, large: true });
}
async function init() {
    personaModule = await import('/scripts/personas.js').catch(() => null);
    const context = ctx();
    if (!context.extensionSettings.crowdlens) {
        const initial = defaults();
        try {
            const response = await fetch(new URL('./prompts/community-reactions.json', import.meta.url));
            if (!response.ok) throw new Error('bundled prompt load failed');
            initial.platforms = importPlatforms(await response.json());
            initial.promptSource = '커뮤반응모음.json';
        } catch { console.warn('[CrowdLens] Bundled prompts unavailable; import the source JSON in settings.'); }
        context.extensionSettings.crowdlens = initial; save();
    }
    if (settings().version !== 1) { console.warn('[CrowdLens] Unsupported settings version'); return; }
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
    for (const name of ['CHAT_CHANGED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'MESSAGE_SENT']) if (events[name]) context.eventSource.on(events[name], () => { cancel(); renderAll(); });
    if (events.CHARACTER_MESSAGE_RENDERED) context.eventSource.on(events.CHARACTER_MESSAGE_RENDERED, index => render(Number(index)));
    if (events.GENERATION_ENDED) context.eventSource.on(events.GENERATION_ENDED, () => {
        renderAll();
        if (settings().enabled && settings().automatic) setTimeout(() => {
            const index = rpIndex();
            if (index < 0 || index !== ctx().chat.length - 1 || !canRun()) return;
            try { if (!stateAt(index).result) void generate(index); } catch { /* No supported chat open. */ }
        }, 100);
    });
    renderAll();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
