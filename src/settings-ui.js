import { PROVIDERS, importPlatforms } from './core.js';
import { capture } from './snapshot.js';

const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
};
const action = (text, callback, primary = false) => {
    const button = node('button', text, `menu_button cl-button${primary ? ' cl-primary' : ''}`);
    button.type = 'button'; button.addEventListener('click', callback); return button;
};
const row = (...children) => { const element = node('div', undefined, 'cl-actions'); element.append(...children); return element; };
const option = (value, text) => { const element = node('option', text); element.value = value; return element; };
function field(root, title, input, hint) {
    input.setAttribute('aria-label', title);
    const label = node('label', undefined, 'cl-field');
    const copy = node('span', undefined, 'cl-field-copy'); copy.append(node('span', title));
    if (hint) copy.append(node('small', hint, 'cl-hint'));
    label.append(copy, input); root.append(label); return input;
}
function section(root, title, description, folded = false) {
    const wrap = node(folded ? 'details' : 'section', undefined, 'cl-section');
    wrap.append(node(folded ? 'summary' : 'h4', title));
    const body = node('div', undefined, 'cl-section-body');
    if (description) body.append(node('p', description, 'cl-hint'));
    wrap.append(body); root.append(wrap); return body;
}

export async function showSettings({ context, state: s, server, status, keyStatuses, onKeys, onChange, onReconnect, onReprofile, onClear, onCancel }) {
    const root = node('div', undefined, 'cl-settings');
    const header = node('header', undefined, 'cl-settings-head');
    const icon = node('img'); icon.src = new URL('../icon.svg', import.meta.url).href; icon.alt = ''; icon.width = 40; icon.height = 40;
    const title = node('div'); title.append(node('h3', 'CrowdLens'), node('p', '장면 밖의 목소리, 원하는 순간에.'));
    header.append(icon, title); root.append(header);
    const navigation = row(); navigation.classList.add('cl-settings-nav'); navigation.setAttribute('aria-label', '설정 바로가기'); root.append(navigation);
    const scroll = node('div', undefined, 'cl-settings-scroll'); scroll.tabIndex = 0; scroll.setAttribute('aria-label', 'CrowdLens 설정 내용'); root.append(scroll);
    const storage = node('p', status || (server.ready ? '● 서버 저장소 연결됨' : '서버 플러그인을 연결해 주세요.'), 'cl-storage-status'); scroll.append(storage);
    const feedback = node('p', '', 'cl-save-status'); feedback.setAttribute('role', 'status');
    const changed = async () => {
        feedback.textContent = '저장 중…';
        try { await onChange(); feedback.textContent = '변경사항을 저장했어요.'; }
        catch (error) { feedback.textContent = error.message; }
    };
    const basic = section(scroll, '사용 설정', '최신 RP 응답 아래에서 버튼을 눌러야 생성합니다.');
    const enabled = node('input'); enabled.type = 'checkbox'; enabled.checked = s.enabled;
    field(basic, 'CrowdLens 사용', enabled); enabled.addEventListener('change', () => { s.enabled = enabled.checked; void changed(); });

    const communities = section(scroll, '커뮤니티 선택', '자동으로 어울리는 곳을 고르거나, 직접 체크한 곳에만 반응을 만드세요.');
    const modes = row(); modes.classList.add('cl-segmented'); modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', '커뮤니티 선택 방식');
    const choices = node('div', undefined, 'cl-community-grid');
    const selectionHint = node('p', '', 'cl-hint');
    const modeButtons = [];
    function updateChoices() {
        const manual = s.selectionMode === 'manual';
        modeButtons.forEach(([id, button]) => button.setAttribute('aria-pressed', String(s.selectionMode === id)));
        choices.hidden = !manual;
        selectionHint.textContent = manual ? `${s.selectedPlatforms.length}개 선택 · 장면의 공개 정보와 반응 가능한 집단은 확인합니다. 알려질 경로가 없으면 생성하지 않아요.` : '생성 버튼을 누를 때 장면에 어울리는 커뮤니티와 반응 집단을 판독합니다.';
        choices.replaceChildren();
        for (const platform of s.platforms) {
            const label = node('label', undefined, 'cl-community-choice');
            const check = node('input'); check.type = 'checkbox'; check.checked = s.selectedPlatforms.includes(platform.id);
            check.addEventListener('change', () => { s.selectedPlatforms = check.checked ? [...s.selectedPlatforms, platform.id] : s.selectedPlatforms.filter(id => id !== platform.id); updateChoices(); void changed(); });
            label.append(check, node('span', platform.name)); choices.append(label);
        }
    }
    for (const [id, label] of [['auto', '자동 선택'], ['manual', '직접 체크']]) {
        const button = action(label, () => { s.selectionMode = id; updateChoices(); void changed(); }); modeButtons.push([id, button]); modes.append(button);
    }
    const sourceNotice = node('p', '', 'cl-hint');
    const updateSource = () => sourceNotice.textContent = `${s.platforms.length}개 커뮤니티 · ${s.promptSource || '기본 안내 프롬프트 (원문 로어북은 아직 가져오지 않았어요)'}`;
    communities.append(modes, choices, selectionHint, sourceNotice, row(action('로어북 가져오기', () => file.click()))); updateChoices(); updateSource();

    const branchBody = section(scroll, '프로필 브랜치', '다른 설정의 사회적 프로필을 쓰고 싶을 때 추가하세요.');
    const branch = node('select'); branch.setAttribute('aria-label', '브랜치');
    const populateBranches = () => { branch.replaceChildren(...s.branches.map(id => option(id, id === 'main' ? '기본 브랜치' : id))); branch.value = s.branch; };
    populateBranches();
    const branchForm = node('div', undefined, 'cl-branch-form'); branchForm.hidden = true;
    const name = node('input'); name.type = 'text'; name.maxLength = 80; name.placeholder = '새 브랜치 이름'; name.setAttribute('aria-label', '새 브랜치 이름');
    const branchNotice = node('p', '', 'cl-hint'); branchNotice.setAttribute('role', 'status');
    const hideBranchForm = () => { branchForm.hidden = true; name.value = ''; branchNotice.textContent = ''; };
    const createBranch = async () => {
        const value = name.value.trim();
        if (!value) { branchNotice.textContent = '브랜치 이름을 입력해 주세요.'; name.focus(); return; }
        if (s.branches.includes(value)) { branchNotice.textContent = '이미 있는 이름이에요. 목록에서 선택해 주세요.'; return; }
        if (s.branches.length >= 64) { branchNotice.textContent = '브랜치는 최대 64개까지 만들 수 있어요.'; return; }
        s.branches.push(value); s.branch = value; populateBranches(); hideBranchForm(); await changed(); showProfile();
    };
    const addBranch = action('＋ 추가', () => { branchForm.hidden = false; name.focus(); });
    branchBody.append(row(branch, addBranch), branchForm, branchNotice);
    branchForm.append(name, row(action('만들기', createBranch, true), action('취소', hideBranchForm)));
    name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); void createBranch(); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hideBranchForm(); } });
    branch.addEventListener('change', async () => { s.branch = branch.value; await changed(); showProfile(); });

    const connection = section(scroll, '모델 연결', 'SillyTavern에 저장한 연결 프로필로 사회적 프로필과 반응을 작성합니다.', true);
    if (!keyStatuses[s.provider]) connection.parentElement.open = true;
    const model = node('select'); model.append(option('', '현재 SillyTavern 연결 모델'));
    try { for (const p of context.ConnectionManagerRequestService?.getSupportedProfiles() || []) model.append(option(String(p.id), `${p.name || p.id} · ${p.model || ''}`)); } catch { /* Current saved connection stays available. */ }
    if (s.profileId && ![...model.options].some(o => o.value === s.profileId)) model.append(option(s.profileId, '기존에 선택한 연결 프로필'));
    model.value = s.profileId; field(connection, '작성용 연결 프로필', model);
    model.addEventListener('change', () => { s.profileId = model.value; void changed(); });
    const limit = node('input'); limit.type = 'number'; limit.min = '8000'; limit.max = '32768'; limit.step = '1'; limit.value = s.outputTokens;
    field(connection, '최대 출력 토큰', limit, '8,000~32,768 · 기본 8,192');
    limit.addEventListener('change', () => { s.outputTokens = Math.min(32768, Math.max(8000, Math.trunc(Number(limit.value) || 8192))); limit.value = s.outputTokens; void changed(); });
    const provider = node('select'); for (const [id, p] of Object.entries(PROVIDERS)) provider.append(option(id, p.name)); provider.value = s.provider; field(connection, 'JEV 연결 제공자', provider);
    const key = node('input'); key.type = 'password'; key.autocomplete = 'off'; key.placeholder = '새 키를 입력할 때만 작성'; field(connection, 'JEV API 키', key);
    const providerHint = node('p', '', 'cl-hint');
    const drafts = { typesafe: '', nanogpt: '' };
    const updateProvider = () => { key.value = drafts[s.provider]; providerHint.textContent = `${keyStatuses[s.provider] ? '서버에 키 저장됨' : '저장된 키 없음'} · ${PROVIDERS[s.provider].model}${s.provider === 'nanogpt' ? ' · Billing: Subscription only 사용' : ''}`; };
    key.addEventListener('input', () => drafts[s.provider] = key.value.trim());
    provider.addEventListener('change', () => { s.provider = provider.value; updateProvider(); void changed(); });
    const saveKey = async remove => {
        try {
            if (!remove && !drafts[s.provider]) throw new Error('저장할 키를 입력해 주세요.');
            const id = s.provider, data = await server.request('keys', { provider: id, key: remove ? '' : drafts[id] });
            keyStatuses = data.keyStatuses; onKeys(keyStatuses); drafts[id] = ''; updateProvider();
        } catch (error) { providerHint.textContent = error.message; }
    };
    connection.append(row(action('키 저장', () => saveKey(false), true), action('키 삭제', () => saveKey(true))), providerHint); updateProvider();

    const editor = section(scroll, '커뮤니티 프롬프트 편집', '커뮤니티를 골라 지침을 확인하고 수정하세요. 영어 지침을 권장하며, 반응은 한국어로 출력됩니다.', true);
    const platformSelect = node('select'); field(editor, '편집할 커뮤니티', platformSelect);
    const underground = node('input'); underground.type = 'checkbox'; field(editor, '음지 커뮤니티', underground, '관리자 삭제 표시 없음 · 거친 성격의 출현 비중 증가');
    const prompt = node('textarea'); prompt.rows = 10; prompt.maxLength = 20000; prompt.spellcheck = false; field(editor, '플랫폼 프롬프트', prompt);
    const commonDetails = section(editor, '함께 적용되는 공통 지침', '이 커뮤니티에 적용할 공통 성격·말투 지침입니다. 다른 커뮤니티는 각각 보관합니다.', true);
    const shared = node('textarea'); shared.rows = 7; shared.maxLength = 12000; shared.spellcheck = false; field(commonDetails, '공통 프롬프트', shared);
    const editStatus = node('p', '', 'cl-hint'); editStatus.setAttribute('role', 'status');
    const draftsById = new Map(); let editingId = '';
    const keepDraft = () => { if (editingId) draftsById.set(editingId, { prompt: prompt.value, sharedPrompt: shared.value, moderation: underground.checked ? 'unmoderated' : 'normal' }); };
    const loadDraft = () => {
        const platform = s.platforms.find(p => p.id === platformSelect.value);
        editingId = platform?.id || ''; const draft = draftsById.get(editingId) || platform;
        prompt.value = draft?.prompt || ''; shared.value = draft?.sharedPrompt || ''; underground.checked = draft?.moderation === 'unmoderated'; editStatus.textContent = '편집 후 저장 버튼을 눌러 주세요.';
    };
    const populateEditor = () => { platformSelect.replaceChildren(...s.platforms.map(p => option(p.id, p.name))); loadDraft(); };
    platformSelect.addEventListener('change', () => { keepDraft(); loadDraft(); }); populateEditor();
    editor.append(row(action('이 커뮤니티 저장', async () => {
        if (!prompt.value.trim()) { editStatus.textContent = '플랫폼 프롬프트를 입력해 주세요.'; return; }
        const platform = s.platforms.find(p => p.id === editingId);
        platform.prompt = prompt.value.trim(); platform.sharedPrompt = shared.value.trim(); platform.moderation = underground.checked ? 'unmoderated' : 'normal'; keepDraft();
        await changed(); editStatus.textContent = server.failure ? server.failure.message : `${platform.name} 프롬프트를 저장했어요. 다음 생성부터 적용됩니다.`;
    }, true), action('편집 되돌리기', () => { draftsById.delete(editingId); loadDraft(); })), editStatus);
    const importBody = section(editor, 'JSON 파일 가져오기', '여러 파일을 함께 선택할 수 있어요. 기존 목록에 합치며, 같은 플랫폼 ID는 새 파일 내용으로 갱신합니다. SMS는 제외됩니다.', true);
    const file = node('input'); file.type = 'file'; file.multiple = true; file.accept = '.json,application/json'; field(importBody, '프롬프트 파일', file);
    const importedNotice = node('p', `${s.platforms.length}개 커뮤니티 · ${s.promptSource || '기본 예시 프롬프트'}`, 'cl-hint'); importBody.append(importedNotice);
    file.addEventListener('change', async () => {
        try {
            const files = [...file.files]; if (!files.length) return;
            if (files.reduce((sum, selected) => sum + selected.size, 0) > 1024 * 1024) throw new Error('합계 1MB 이하 JSON 파일을 선택해 주세요.');
            const combined = new Map(s.platforms.map(p => [p.id, p]));
            for (const selected of files) for (const platform of importPlatforms(JSON.parse(await selected.text()))) combined.set(platform.id, platform);
            const imported = importPlatforms([...combined.values()]);
            s.platforms = imported; s.catalogVersion = 1; s.promptSource = files.map(f => f.name).join(', '); s.selectedPlatforms = imported.map(p => p.id); draftsById.clear(); populateEditor(); updateChoices(); updateSource();
            await changed(); importedNotice.textContent = `${files.length}개 파일을 합쳐 ${imported.length}개 커뮤니티를 저장했어요. ${server.failure ? server.failure.message : ''}`;
        } catch (error) { importedNotice.textContent = error.message; }
    });

    const profileBody = section(scroll, '사회적 프로필 확인', '현재 캐릭터·페르소나·브랜치의 짧은 사회적 프로필입니다.', true);
    const profile = node('pre', '', 'cl-profile');
    function showProfile() {
        try {
            const snapshot = capture(context, s, context.chat.findLastIndex(m => !m.is_user && !m.is_system));
            const saved = s.profiles[snapshot.profileKey]?.profile;
            profile.textContent = saved ? Object.entries(saved).map(([who, p]) => `${who === 'character' ? '캐릭터' : '유저'} · ${p.name}\n직업: ${p.occupation}\n인지도: ${p.recognition}\n대외평판: ${p.reputation}\n지인 관점: ${p.acquaintanceView}\n공개정보: ${p.publicInfo}`).join('\n\n') : '첫 반응을 만들 때 프로필도 함께 판독합니다.';
        } catch (error) { profile.textContent = error.message; }
    }
    profileBody.append(profile, row(action('프로필 다시 판독하고 생성', async () => { try { await onReprofile(); showProfile(); } catch (error) { feedback.textContent = error.message; } }))); showProfile();
    const tools = section(scroll, '저장소·작업 관리', '모든 판독·생성과 저장은 SillyTavern 서버에서 실행됩니다.', true);
    tools.append(row(action('서버 다시 연결', async () => { try { await onReconnect(); storage.textContent = '● 서버 저장소 연결됨'; feedback.textContent = '서버 설정을 불러왔어요. 설정창을 다시 열면 전체 내용이 갱신됩니다.'; } catch (error) { storage.textContent = error.message; } }), action('현재 브랜치 피드 지우기', async () => { try { await onClear(); feedback.textContent = '현재 채팅·브랜치의 피드를 지웠어요.'; } catch (error) { feedback.textContent = error.message; } }), action('진행 중 생성 취소', async () => { try { feedback.textContent = await onCancel(); } catch (error) { feedback.textContent = error.message; } })));
    for (const [label, body] of [['커뮤니티', communities], ['프롬프트', editor], ['모델 연결', connection]]) navigation.append(action(label, () => {
        const target = body.parentElement;
        if (target.tagName === 'DETAILS') target.open = true;
        scroll.scrollTo({ top: scroll.scrollTop + target.getBoundingClientRect().top - scroll.getBoundingClientRect().top, behavior: 'smooth' });
    }));
    const footer = node('footer', undefined, 'cl-settings-footer'); footer.append(node('small', '내용을 위아래로 스크롤할 수 있어요 · 프롬프트는 저장 버튼으로 적용'), feedback); root.append(footer);
    await context.callGenericPopup(root, context.POPUP_TYPE.TEXT, '', { wide: true, large: true });
}
