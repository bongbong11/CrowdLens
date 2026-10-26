import { fingerprint } from './core.js';
import { readSheets } from './sheets.js';

export function sourceIdentity(context, branch = 'main') {
    const avatar = context.characters?.[context.characterId]?.avatar;
    if (context.groupId || !avatar || !context.chatId) throw new Error('1:1 캐릭터 채팅을 먼저 열어 주세요.');
    const base = readSheets(context), personaHash = fingerprint(base.persona);
    return { base, personaHash, profileKey: JSON.stringify([avatar, branch, base.persona.name, personaHash]), scope: { character: avatar, chat: context.chatId, branch } };
}
export function normalizeSelection(value) {
    const result = {};
    for (const kind of ['character', 'persona']) {
        const input = value?.[kind];
        if (!input || typeof input.sheet !== 'boolean' || !Array.isArray(input.lore) || input.lore.length > 200) throw new Error('시트·로어북 선택 형식을 확인해 주세요.');
        const unique = new Map();
        for (const ref of input.lore) {
            if (typeof ref?.book !== 'string' || !ref.book.trim() || ref.book.length > 200 || !['string', 'number'].includes(typeof ref.uid) || String(ref.uid).length > 100) throw new Error('로어북 엔트리 선택을 확인해 주세요.');
            const item = { book: ref.book, uid: String(ref.uid) }; unique.set(JSON.stringify([item.book, item.uid]), item);
        }
        result[kind] = { sheet: input.sheet, lore: [...unique.values()].sort((a, b) => { const left = JSON.stringify(a), right = JSON.stringify(b); return left < right ? -1 : left > right ? 1 : 0; }) };
    }
    return result;
}
export const defaultSelection = () => ({ character: { sheet: true, lore: [] }, persona: { sheet: true, lore: [] } });
export const loreKey = ref => JSON.stringify([ref.book, String(ref.uid)]);
