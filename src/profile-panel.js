import { fingerprint } from './core.js';
import { captureProfile } from './snapshot.js';
import { sourceIdentity, defaultSelection, normalizeSelection, loreKey } from './source-selection.js';
import { sourceCandidates, prepareSource } from './source-reader.js';

const el = (tag, text, className) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; };
const button = (text, fn) => { const n = el('button', text, 'menu_button cl-button'); n.type = 'button'; n.addEventListener('click', fn); return n; };

export function createProfilePanel(root, { getContext, state: s, server, onPrepared, onRead }) {
    root.append(el('h4', '프로필 입력 선택'), el('p', '캐릭터와 페르소나의 시트·로어북 엔트리를 선택해 저장하세요. 판독 버튼은 사회적 프로필만 작성합니다.', 'cl-hint'));
    const inputs = el('div'), status = el('p', '', 'cl-status'), profile = el('pre', '', 'cl-profile'); status.setAttribute('role', 'status');
    const actions = el('div', undefined, 'cl-actions'); root.append(inputs, actions, status, profile);
    let identity = null, revision = 0, busy = false;
    inputs.addEventListener('change', () => { status.textContent = '입력 선택이 변경되었습니다. 선택 저장을 눌러 적용하세요.'; });
    const same = id => { try { const now = sourceIdentity(getContext(), s.branch); return now.profileKey === id.profileKey && now.scope.chat === id.scope.chat; } catch { return false; } };
    function render() {
        if (!identity || !same(identity)) { profile.textContent = '현재 인물의 입력 목록을 불러와 주세요.'; return; }
        const record = s.profiles[identity.profileKey];
        let current; try { current = captureProfile(getContext(), s); } catch { /* Selection needs loading. */ }
        if (!record || record.language !== 'en') { profile.textContent = '저장된 영문 사회적 프로필이 없습니다.'; return; }
        const live = sourceIdentity(getContext(), s.branch), choice = s.sourceSelections[identity.profileKey];
        const prepared = s.sourceInputs[identity.profileKey]?.source;
        const changedBase = prepared && ['character', 'persona'].some(kind => choice?.[kind]?.sheet && ['name', 'description', ...(kind === 'character' ? ['personality'] : [])].some(field => prepared[kind][field] !== live.base[kind][field]));
        const stale = changedBase || (current && current.sourceHash !== record.sourceHash);
        profile.textContent = (stale ? '입력이 바뀌었습니다. 다시 판독하면 새 선택을 반영합니다.\n\n' : '') + Object.entries(record.profile).map(([kind, p]) => `${kind === 'character' ? '캐릭터' : '페르소나'} · ${p.name}\nOccupation: ${p.occupation}\nRecognition: ${p.recognition}\nReputation: ${p.reputation}\nAcquaintance view: ${p.acquaintanceView}\nPublic info: ${p.publicInfo}`).join('\n\n');
    }
    function selected() {
        const result = {};
        for (const kind of ['character', 'persona']) result[kind] = {
            sheet: inputs.querySelector(`[data-source-sheet="${kind}"]`)?.checked === true,
            lore: [...inputs.querySelectorAll(`[data-source-kind="${kind}"] input[data-lore-ref]:checked`)].map(n => JSON.parse(n.value)),
        };
        return normalizeSelection(result);
    }
    async function refresh() {
        const token = ++revision; inputs.replaceChildren();
        try {
            const c = getContext(), id = sourceIdentity(c, s.branch); identity = id;
            const choice = s.sourceSelections[id.profileKey] || defaultSelection();
            const groups = {};
            for (const kind of ['character', 'persona']) {
                const box = el('section', undefined, 'cl-source-person'); box.dataset.sourceKind = kind;
                box.append(el('h4', `${kind === 'character' ? '캐릭터' : '페르소나'} · ${id.base[kind].name}`));
                const label = el('label', undefined, 'cl-source-choice'), check = el('input'); check.type = 'checkbox'; check.checked = choice[kind].sheet; check.dataset.sourceSheet = kind;
                label.append(check, el('span', kind === 'character' ? '현재 캐릭터 카드 시트 포함' : '현재 페르소나 시트 포함')); box.append(label);
                const preview = el('details'), text = [id.base[kind].description, id.base[kind].personality].filter(Boolean).join('\n\n');
                preview.append(el('summary', `시트 확인 · ${text.length.toLocaleString()}자`), el('pre', text || '(비어 있음)', 'cl-source-preview')); box.append(preview);
                const books = el('div'); box.append(books); groups[kind] = books; inputs.append(box);
            }
            status.textContent = '연결 로어북 목록을 읽는 중…'; render();
            const candidates = await sourceCandidates(c);
            if (token !== revision || !same(id)) return;
            let count = 0, missing = 0;
            for (const kind of ['character', 'persona']) {
                const checked = new Set(choice[kind].lore.map(loreKey)), available = new Set();
                for (const book of candidates[kind]) {
                    const details = el('details', undefined, 'cl-source-book'); details.append(el('summary', `${book.book} · ${book.location} · ${book.entries.length}개`));
                    for (const entry of book.entries) {
                        available.add(loreKey(entry)); count++;
                        const label = el('label', undefined, 'cl-source-choice'), check = el('input'); check.type = 'checkbox'; check.dataset.loreRef = 'true'; check.value = JSON.stringify({ book: entry.book, uid: entry.uid }); check.checked = checked.has(loreKey(entry));
                        check.setAttribute('aria-label', `${kind === 'character' ? '캐릭터' : '페르소나'} · ${book.book} · ${entry.title}`);
                        label.append(check, el('span', entry.title)); details.append(label);
                    }
                    groups[kind].append(details);
                }
                if (!candidates[kind].length) groups[kind].append(el('p', '연결된 로어북 없음', 'cl-hint'));
                missing += [...checked].filter(key => !available.has(key)).length;
            }
            status.textContent = missing ? `이전 선택 ${missing}개가 없거나 비활성 상태입니다. 확인 후 선택을 저장하세요.` : `${count}개 엔트리 확인. 필요한 것만 체크하고 선택을 저장하세요.`;
        } catch (error) { if (token === revision) status.textContent = error.message; }
    }
    async function perform(readOnly) {
        if (busy) return;
        busy = true; actions.querySelectorAll('button').forEach(b => b.disabled = true);
        try {
            const id = identity;
            if (!id || !same(id)) throw new Error('인물이 바뀌었습니다. 입력 목록을 다시 불러와 주세요.');
            const selection = selected();
            if (readOnly && (!s.sourceSelections[id.profileKey] || fingerprint(selection) !== fingerprint(normalizeSelection(s.sourceSelections[id.profileKey])))) throw new Error('변경한 입력 선택을 먼저 저장해 주세요.');
            const prepared = await prepareSource(getContext(), selection);
            if (!same(id)) throw new Error('인물이 바뀌어 이전 입력을 적용하지 않았습니다.');
            if (!readOnly) {
                const data = await server.request('profile/selection', { scope: id.scope, profileKey: id.profileKey, selection, revision: s.sourceSelectionRevisions[id.profileKey] || 0 });
                if (!same(id)) return;
                s.sourceSelections[id.profileKey] = data.selection; s.sourceSelectionRevisions[id.profileKey] = data.revision;
            }
            s.sourceInputs[id.profileKey] = prepared; onPrepared();
            if (readOnly) {
                status.textContent = '프로필만 판독하는 중…';
                await onRead(captureProfile(getContext(), s), phase => { if (same(id)) status.textContent = phase; });
                if (!same(id)) return;
                status.textContent = '영문 사회적 프로필을 저장했습니다. 커뮤니티 반응은 생성하지 않았습니다.';
            } else status.textContent = '입력 선택을 저장했습니다. 프로필만 판독을 눌러 주세요.';
            render();
        } catch (error) { status.textContent = error.message; }
        finally { busy = false; actions.querySelectorAll('button').forEach(b => b.disabled = false); }
    }
    actions.append(button('입력 목록 새로고침', refresh), button('선택 저장', () => perform(false)), button('프로필만 판독', () => perform(true)));
    return { refresh, render };
}
