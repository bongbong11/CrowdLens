import { capture } from './src/snapshot.js';
import { ServerClient } from './src/server-client.js';
import { showSettings } from './src/settings-ui.js';

let personaModule = null;
const ctx = () => { const context = SillyTavern.getContext(); return { ...context, user_avatar: personaModule?.user_avatar ?? context.user_avatar }; };
const defaults = () => ({ version: 2, enabled: false, automatic: false, branch: 'main', branches: ['main'], selectionMode: 'auto', selectedPlatforms: [], underground: false, outputLanguage: 'en', commentVolume: 'medium', provider: 'typesafe', profileId: '', outputTokens: 8192, platforms: [], profiles: {}, results: {} });
let currentSettings = defaults(), storageError = '', scopeRequest = 0, currentScope = '';
const settings = () => currentSettings;
function reportStorage(error) { storageError = error.message; document.querySelectorAll('.cl-storage-status').forEach(n => n.textContent = storageError); }
const server = new ServerClient(() => ctx().getRequestHeaders(), reportStorage);
const save = () => server.save(settings());
let keyStatuses = { typesafe: false, nanogpt: false };
let active = null, epoch = 0, tabSequence = 0;
const panels = new Map();
function el(tag, content, className) {
    const node = document.createElement(tag);
    if (content !== undefined) node.textContent = content;
    if (className) node.className = className;
    return node;
}
function button(label, action) {
    const node = el('button', label, 'menu_button cl-button');
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
function tabs(container, feeds, index) {
    const bar = el('div', undefined, 'cl-tabs');
    bar.setAttribute('role', 'tablist');
    const body = el('div', undefined, 'cl-feed');
    const buttons = [];
    function select(feed, selected) {
        buttons.forEach(b => { b.setAttribute('aria-selected', String(b === selected)); b.tabIndex = b === selected ? 0 : -1; });
        body.replaceChildren();
        container.closest('.crowdlens').dataset.selectedTab = feed.id;
        body.className = `cl-feed cl-${feed.style}`;
        body.id = `${selected.id}-panel`;
        body.setAttribute('role', 'tabpanel');
        body.setAttribute('aria-labelledby', selected.id);
        body.append(el('div', feed.name, 'cl-platform'));
        const panel = container.closest('.crowdlens');
        const translated = new Set(JSON.parse(panel.dataset.translatedFeeds || '[]'));
        const hasTranslation = feed.translation?.posts?.length === feed.posts.length;
        const showTranslation = hasTranslation && translated.has(feed.id);
        if (feed.language === 'en') {
            const languageTools = el('div', undefined, 'cl-actions cl-language-tools');
            const original = button('English 원문', () => { translated.delete(feed.id); panel.dataset.translatedFeeds = JSON.stringify([...translated]); select(feed, selected); });
            original.setAttribute('aria-pressed', String(!showTranslation));
            const korean = button(hasTranslation ? '한국어 번역' : '한국어로 번역', () => {
                translated.add(feed.id); panel.dataset.translatedFeeds = JSON.stringify([...translated]);
                if (hasTranslation) select(feed, selected); else void translate(index, feed.id);
            });
            korean.setAttribute('aria-pressed', String(showTranslation)); korean.disabled = Boolean(active) && !hasTranslation;
            languageTools.append(original, korean); body.append(languageTools);
        }
        for (const [postIndex, post] of feed.posts.entries()) {
            const visible = showTranslation ? feed.translation.posts[postIndex] : post;
            const article = el('article', undefined, post.replyTo != null ? 'cl-post cl-reply' : 'cl-post');
            const head = el('div', undefined, 'cl-post-head');
            const groupNames = { acquaintances: '지인', colleagues: '동료·업계', fans: '팬덤', media: '미디어', public: '일반 이용자', critics: '비판적 이용자' };
            head.append(el('span', post.avatar || post.author.slice(0, 1), 'cl-avatar'), el('strong', feed.style === 'anon' ? 'Anonymous' : post.author), el('small', groupNames[post.group] || '이용자'));
            article.append(head);
            const culture = el('small', showTranslation ? '번역됨' : feed.language === 'en' ? 'English' : post.culture === 'korean' ? '한국어 원문' : '번역됨', `cl-culture cl-culture-${post.culture === 'korean' ? 'ko' : 'translated'}`);
            culture.title = '가상 게시글의 표현 방식'; article.append(culture);
            if (post.replyTo != null && feed.posts[post.replyTo]) article.append(el('small', `↳ ${feed.posts[post.replyTo].author}에게 답글`, 'cl-reply-reference'));
            if (visible.title) article.append(el('h4', visible.title));
            article.append(el('p', visible.body, post.removed ? 'cl-removed' : '')); 
            const meta = feed.style === 'anon' ? `No.${feed.posts.indexOf(post) + 1} · 인용` : ['live', 'chat'].includes(feed.style) ? '장면 속 대화' : feed.style === 'forum' ? '↑  ·  ↓  ·  답글' : feed.style === 'photo' ? '♡  답글 달기' : '♡  ↻  답글';
            article.append(el('div', meta, 'cl-meta'));
            body.append(article);
        }
    }
    feeds.forEach((feed, i) => {
        const tab = button(feed.name, () => select(feed, tab));
        tab.id = `cl-tab-${++tabSequence}`;
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
    if (feeds.length) { const i = Math.max(0, feeds.findIndex(f => f.id === container.closest('.crowdlens').dataset.selectedTab)); select(feeds[i], buttons[i]); }
}
function render(index) {
    const host = document.querySelector(`#chat .mes[mesid="${index}"] .mes_block`);
    if (!host) return;
    let panel = host.querySelector(':scope > .crowdlens');
    const open = panel ? panel.open : true;
    const selectedTab = panel?.dataset.selectedTab;
    const translatedFeeds = panel?.dataset.translatedFeeds;
    panel?.remove();
    const message = ctx().chat[index];
    if (index !== rpIndex() || !settings().enabled || !message || message.is_user || message.is_system || ctx().groupId) return;
    panel = el('details', undefined, 'crowdlens'); panel.open = open;
    panel.append(el('summary', 'CrowdLens · 커뮤니티 반응'));
    if (selectedTab) panel.dataset.selectedTab = selectedTab;
    if (translatedFeeds) panel.dataset.translatedFeeds = translatedFeeds;
    const content = el('div', undefined, 'cl-content');
    const status = el('p', active ? '서버에서 작업을 확인하고 있어요.' : '원하는 순간에 이 장면의 반응을 만들어 보세요.', 'cl-status');
    status.setAttribute('role', 'status');
    const run = button('이 장면 반응 만들기', () => generate(index));
    run.classList.add('cl-primary');
    if (active) run.disabled = true;
    content.append(run, status); panel.append(content); host.append(panel);
    panels.set(index, status);
    try {
        const { result } = stateAt(index);
        if (result) {
            run.textContent = '다시 만들기';
            status.textContent = result.reason || '해당 장면의 가상 반응';
            tabs(content, result.feeds, index);
        }
    } catch (error) { status.textContent = error.message; }
}
function renderAll() {
    panels.clear();
    document.querySelectorAll('#chat .mes[mesid]').forEach(node => render(Number(node.getAttribute('mesid'))));
}
async function generate(index) {
    if (!settings().enabled) return;
    if (index !== rpIndex()) return;
    if (settings().selectionMode === 'manual' && !settings().selectedPlatforms?.length) { if (panels.get(index)) panels.get(index).textContent = '설정에서 생성할 커뮤니티를 하나 이상 체크해 주세요.'; return; }
    if (!canRun()) { if (panels.get(index)) panels.get(index).textContent = '현재 생성이 끝난 뒤 다시 눌러 주세요.'; return; }
    if (!server.ready) { reportStorage(new Error('CrowdLens 서버 플러그인을 먼저 연결해 주세요.')); return; }
    if (settings().selectionMode !== 'manual' && !keyStatuses[settings().provider]) { if (panels.get(index)) panels.get(index).textContent = '마법봉 → CrowdLens 설정에서 선택한 제공자의 JEV 키를 서버에 저장해 주세요.'; return; }
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
async function translate(index, platform) {
    if (!canRun() || index !== rpIndex()) return;
    const token = ++epoch, submitting = { submitting: true }; active = submitting; renderAll();
    try {
        const { snapshot } = stateAt(index);
        await server.flush();
        const data = await server.request('translations', { scope: snapshot.scope, key: snapshot.key, platform, revision: server.revision });
        if (active === submitting) active = null;
        if (token !== epoch) return;
        if (data.cached) await refreshScope(true); else await watchJob(data.job, snapshot.scope);
    } catch (error) { if (active === submitting) active = null; renderAll(); if (panels.get(index)) panels.get(index).textContent = error.message; }
}
async function openSettings() {
    await showSettings({
        context: ctx(), state: settings(), server, status: storageError, keyStatuses,
        onKeys: value => keyStatuses = value,
        onChange: async () => { if (currentScope !== JSON.stringify(scopeNow())) cancel(); const saving = save(); renderAll(); await saving; await refreshScope(); },
        onReconnect: async () => { await connectStorage(); await refreshScope(true); },
        onReprofile: async () => {
            const snap = capture(ctx(), settings(), rpIndex());
            cancel(); await server.request('scope/clear', { scope: snap.scope, profileKey: snap.profileKey }); await refreshScope(true); await generate(rpIndex());
        },
        onClear: async () => { await server.request('scope/clear', { scope: scopeNow() }); await refreshScope(true); },
        onCancel: async () => { if (!active?.id) return '진행 중인 생성이 없습니다.'; await server.request(`jobs/${active.id}/cancel`, {}); return '생성 취소를 요청했어요.'; },
    });
}
async function connectStorage() {
    const context = ctx();
    const legacy = context.extensionSettings.crowdlens;
    const data = await server.initialize(legacy || defaults());
    Object.assign(currentSettings, data.settings, { profiles: {}, results: {}, automatic: false }); keyStatuses = data.keyStatuses; storageError = '';
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
    if (events.CHARACTER_MESSAGE_RENDERED) context.eventSource.on(events.CHARACTER_MESSAGE_RENDERED, renderAll);
    if (events.GENERATION_ENDED) context.eventSource.on(events.GENERATION_ENDED, () => {
        renderAll();
    });
    await refreshScope(true); renderAll();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
