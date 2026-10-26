import { fingerprint } from './runtime/core.js';

export function validateProfileKey(key, scope) {
    let value; try { value = JSON.parse(key); } catch { throw new Error('프로필 식별자를 확인해 주세요.'); }
    if (!Array.isArray(value) || value.length !== 4 || value[0] !== scope.character || value[1] !== scope.branch || typeof value[2] !== 'string' || !/^[a-z0-9]{1,20}$/i.test(value[3])) throw new Error('다른 인물·브랜치의 프로필 선택을 변경할 수 없습니다.');
    return value;
}
export function validateProfileSnapshot(raw, scope) {
    if (!raw?.source || !raw.source.character || !raw.source.persona || Buffer.byteLength(JSON.stringify(raw)) > 2_000_000) throw new Error('프로필 입력 형식이나 크기를 확인해 주세요.');
    const key = validateProfileKey(raw.profileKey, scope);
    for (const kind of ['character', 'persona']) for (const field of kind === 'character' ? ['name', 'description', 'personality'] : ['name', 'description']) if (typeof raw.source[kind][field] !== 'string') throw new Error('프로필 시트 필드 형식이 잘못되었습니다.');
    const library = raw.source.lore || [];
    if (!Array.isArray(library) || library.length > 400) throw new Error('선택한 로어북 입력을 확인해 주세요.');
    const ids = new Set();
    for (const entry of library) {
        if (typeof entry?.id !== 'string' || ids.has(entry.id) || typeof entry.book !== 'string' || typeof entry.uid !== 'string' || typeof entry.content !== 'string' || !entry.content.trim()) throw new Error('로어북 본문 또는 참조가 올바르지 않습니다.');
        ids.add(entry.id);
    }
    for (const kind of ['character', 'persona']) if (raw.source[kind].loreIds !== undefined && (!Array.isArray(raw.source[kind].loreIds) || raw.source[kind].loreIds.some(id => !ids.has(id)))) throw new Error('선택한 로어북 참조가 없습니다.');
    if (!raw.source.character.description.trim() && !raw.source.character.personality.trim() && !raw.source.character.loreIds?.length) throw new Error('판독할 캐릭터 입력이 비어 있습니다.');
    const personaHash = raw.profilePersonaHash || fingerprint(raw.source.persona);
    if (key[2] !== raw.source.persona.name || key[3] !== personaHash || raw.sourceHash !== fingerprint(raw.source)) throw new Error('프로필 입력 식별자가 일치하지 않습니다. 다시 불러와 주세요.');
    return { source: raw.source, sourceHash: raw.sourceHash, profileKey: raw.profileKey, profilePersonaHash: personaHash, selectionHash: typeof raw.selectionHash === 'string' ? raw.selectionHash : '' };
}
