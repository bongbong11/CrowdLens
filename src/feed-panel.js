const el = (tag, text, className) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; };
const button = (text, fn) => { const n = el('button', text, 'menu_button cl-button'); n.type = 'button'; n.addEventListener('click', fn); return n; };
let sequence = 0;

export function createFeedPanel(root, { state: s, isBusy, onGenerate, onTranslate, onDelete }) {
    let selectedKey = '', platformId = '', language = 'en', phase = '', seenLatest = '';
    function render() {
        root.replaceChildren();
        const actions = el('div', undefined, 'cl-actions'), run = button('현재 장면 반응 만들기', onGenerate); run.classList.add('cl-primary'); run.disabled = isBusy();
        actions.append(run); root.append(actions);
        const status = el('p', phase || '저장한 반응은 메시지 수정·삭제·스와이프와 별도로 보관합니다.', 'cl-status'); status.setAttribute('role', 'status'); root.append(status);
        const keys = Object.keys(s.results || {});
        if (!keys.length) { root.append(el('p', '저장된 커뮤니티 반응이 없습니다. 원하는 장면에서 생성 버튼을 눌러 주세요.', 'cl-empty')); return; }
        const latest = `${s.latestResultKey || ''}:${s.results[s.latestResultKey]?.createdAt || ''}`;
        if (latest !== seenLatest) { seenLatest = latest; selectedKey = s.latestResultKey || ''; language = 'en'; }
        if (!keys.includes(selectedKey)) selectedKey = s.latestResultKey && keys.includes(s.latestResultKey) ? s.latestResultKey : keys.at(-1);
        const history = el('select'); history.setAttribute('aria-label', '저장된 반응');
        [...keys].reverse().forEach((key, i) => { const record = s.results[key], option = el('option', `${record.createdAt ? new Date(record.createdAt).toLocaleString() : `저장 반응 ${keys.length - i}`} · ${record.result.feeds.map(f => f.name).join(', ') || '반응 없음'}`); option.value = key; history.append(option); });
        history.value = selectedKey; history.addEventListener('change', () => { selectedKey = history.value; platformId = ''; language = 'en'; render(); });
        const remove = button('선택 반응 삭제', async () => { try { await onDelete(selectedKey); } catch (error) { setStatus(error.message); } }); remove.disabled = isBusy();
        const tools = el('div', undefined, 'cl-actions cl-feed-history'); tools.append(history, remove); root.append(tools);
        const result = s.results[selectedKey]?.result;
        if (result.reason) root.append(el('p', result.reason, 'cl-status'));
        const feeds = result.feeds || [];
        if (!feeds.length) return;
        const feed = feeds.find(f => f.id === platformId) || feeds[0]; platformId = feed.id;
        const tabs = el('div', undefined, 'cl-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '커뮤니티');
        const body = el('div', undefined, `cl-feed cl-${feed.style}`); body.id = `cl-feed-body-${++sequence}`; body.setAttribute('role', 'tabpanel');
        for (const item of feeds) { const tab = button(item.name, () => { platformId = item.id; language = 'en'; render(); }); tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(item.id === feed.id)); tab.setAttribute('aria-controls', body.id); tabs.append(tab); }
        root.append(tabs, body); body.append(el('div', feed.name, 'cl-platform'));
        const cached = feed.translation?.posts?.length === feed.posts.length, translated = cached && language === 'ko';
        if (feed.language === 'en') {
            const tools = el('div', undefined, 'cl-actions cl-language-tools');
            const original = button('English 원문', () => { language = 'en'; render(); }); original.setAttribute('aria-pressed', String(!translated));
            const korean = button(cached ? '한국어 번역' : '한국어로 번역', async () => { language = 'ko'; if (cached) render(); else { try { await onTranslate(selectedKey, feed.id); } catch (error) { setStatus(error.message); } } });
            korean.setAttribute('aria-pressed', String(translated)); korean.disabled = isBusy() && !cached; tools.append(original, korean); body.append(tools);
        }
        feed.posts.forEach((post, i) => {
            const visible = translated ? feed.translation.posts[i] : post, article = el('article', undefined, post.replyTo == null ? 'cl-post' : 'cl-post cl-reply');
            const head = el('div', undefined, 'cl-post-head'); head.append(el('span', post.avatar || '◈', 'cl-avatar'), el('strong', feed.style === 'anon' ? 'Anonymous' : post.author)); article.append(head);
            if (post.replyTo != null && feed.posts[post.replyTo]) article.append(el('small', `↳ ${feed.posts[post.replyTo].author}`, 'cl-reply-reference'));
            if (visible.title) article.append(el('h4', visible.title)); article.append(el('p', visible.body, post.removed ? 'cl-removed' : '')); body.append(article);
        });
    }
    function setStatus(text) { phase = text; const status = root.querySelector('.cl-status'); if (status) status.textContent = text; }
    return { render, setStatus, selectLatest() { selectedKey = s.latestResultKey || ''; language = 'en'; render(); } };
}
