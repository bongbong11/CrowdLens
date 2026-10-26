import { fingerprint } from './core.js';
import { sourceIdentity, normalizeSelection } from './source-selection.js';
import { PRESENTATION_REVISION } from './prompts.js';

// Profile capture does not depend on any RP message.
export function captureProfile(context, settings) {
    const identity = sourceIdentity(context, settings.branch || 'main');
    const rawSelection = settings.sourceSelections?.[identity.profileKey];
    const selection = rawSelection ? normalizeSelection(rawSelection) : null;
    const prepared = settings.sourceInputs?.[identity.profileKey];
    if (selection && (!prepared || prepared.selectionHash !== fingerprint(selection))) throw new Error('선택한 프로필 입력을 다시 불러와 주세요.');
    const source = prepared?.source || identity.base;
    if (!source.character.description.trim() && !source.character.personality.trim() && !source.character.loreIds?.length) throw new Error('캐릭터 시트 또는 로어북을 선택해 주세요.');
    return { source, sourceHash: fingerprint(source), profileKey: identity.profileKey, profilePersonaHash: identity.personaHash, selectionHash: selection ? fingerprint(selection) : '', scope: identity.scope };
}
export function capture(context, settings, index) {
    const profile = captureProfile(context, settings);
    const card = context.characters[context.characterId], branch = settings.branch || 'main';
    const message = context.chat[index];
    if (!message || message.is_user || message.is_system) throw new Error('생성할 RP 응답이 없습니다.');
    const { source, profileKey } = profile;
    const history = context.chat.slice(Math.max(0, index - 5), index + 1).filter(m => !m.is_system).map(m => ({ name: m.name, text: m.mes }));
    const identity = [PRESENTATION_REVISION, card.avatar, context.chatId, branch, profileKey, fingerprint(source), fingerprint(settings.platforms), index, message.swipe_id ?? 0, history, settings.selectionMode || 'auto', settings.selectionMode === 'manual' ? [...(settings.selectedPlatforms || [])].sort() : [], settings.underground === true, settings.outputLanguage || 'en', settings.commentVolume || 'medium'];
    return { ...profile, history, identity, key: fingerprint(identity) };
}
