import { fingerprint } from './core.js';
import { readSheets } from './sheets.js';
import { normalizeSelection, loreKey } from './source-selection.js';

let hostModule;
export async function worldModule() {
    hostModule ||= import('/scripts/world-info.js').catch(() => { hostModule = null; throw new Error('로어북 연결을 읽지 못했습니다.'); });
    return hostModule;
}
export function linkedBooks(context, worldInfo, kind) {
    const character = context.characters?.[context.characterId], card = character?.data || character;
    const links = [];
    const add = (book, location) => { if (typeof book === 'string' && book.trim()) links.push({ book, location }); };
    if (kind === 'character') {
        add(card?.extensions?.world, '카드 주 로어북');
        const key = String(character?.avatar || '').replace(/\.[^/.]+$/, '');
        const extra = worldInfo?.charLore?.find(link => link.name === key)?.extraBooks;
        for (const book of Array.isArray(extra) ? extra : []) add(book, '카드 추가 로어북');
    } else {
        const personas = context.powerUserSettings?.persona_descriptions || {};
        const entry = personas[context.user_avatar] || Object.values(personas).find(item => item?.name === context.name1);
        add(context.powerUserSettings?.persona_description_lorebook, '페르소나 전역 로어북');
        add(entry?.lorebook, '현재 페르소나 로어북');
    }
    return [...new Map(links.map(item => [item.book, item])).values()];
}
function entries(book, data) {
    if (!data?.entries || typeof data.entries !== 'object') throw new Error(`로어북을 읽지 못했습니다: ${book}`);
    return Object.entries(data.entries).filter(([, e]) => e && !e.disable && typeof e.content === 'string' && e.content.trim())
        .map(([uid, e]) => ({ book, uid: String(uid), title: e.comment || (e.key || []).join(', ') || String(uid), content: e.content }));
}
export async function sourceCandidates(context, world = null) {
    world ||= await worldModule();
    const links = Object.fromEntries(['character', 'persona'].map(kind => [kind, linkedBooks(context, world.world_info, kind)]));
    const names = [...new Set([...links.character, ...links.persona].map(item => item.book))];
    if (names.length && typeof world.loadWorldInfo !== 'function') throw new Error('로어북 읽기 기능이 없습니다.');
    const loaded = new Map(await Promise.all(names.map(async book => [book, entries(book, await world.loadWorldInfo(book))])));
    return Object.fromEntries(['character', 'persona'].map(kind => [kind, links[kind].map(link => ({ ...link, entries: loaded.get(link.book) }))]));
}
export async function prepareSource(context, input, world = null) {
    const selection = normalizeSelection(input), base = readSheets(context);
    const wanted = [...selection.character.lore, ...selection.persona.lore];
    if (wanted.length) world ||= await worldModule();
    const allowed = Object.fromEntries(['character', 'persona'].map(kind => [kind, new Set(linkedBooks(context, world?.world_info, kind).map(item => item.book))]));
    for (const kind of ['character', 'persona']) for (const ref of selection[kind].lore) if (!allowed[kind].has(ref.book)) throw new Error(`현재 ${kind === 'character' ? '캐릭터' : '페르소나'}에 연결되지 않은 로어북입니다: ${ref.book}`);
    const books = new Map(await Promise.all([...new Set(wanted.map(ref => ref.book))].map(async book => [book, entries(book, await world.loadWorldInfo(book))])));
    const byContent = new Map(), library = [];
    const source = { character: { ...base.character }, persona: { ...base.persona } };
    for (const kind of ['character', 'persona']) {
        if (!selection[kind].sheet) { source[kind].description = ''; if (kind === 'character') source[kind].personality = ''; }
        const refs = [];
        for (const ref of selection[kind].lore) {
            const item = books.get(ref.book)?.find(e => loreKey(e) === loreKey(ref));
            if (!item) throw new Error(`선택한 엔트리가 없거나 비활성화되었습니다: ${ref.book} / ${ref.uid}`);
            if (!byContent.has(item.content)) { const id = `lore-${library.length + 1}`; library.push({ id, book: item.book, uid: item.uid, title: item.title, content: item.content }); byContent.set(item.content, id); }
            refs.push(byContent.get(item.content));
        }
        if (refs.length) source[kind].loreIds = [...new Set(refs)];
    }
    if (library.length) source.lore = library;
    if (!source.character.description.trim() && !source.character.personality.trim() && !source.character.loreIds?.length) throw new Error('캐릭터 시트 또는 로어북 엔트리를 하나 이상 선택해 주세요.');
    return { source, selectionHash: fingerprint(selection) };
}
