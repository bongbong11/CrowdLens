import { fingerprint } from './core.js';
import { readSheets } from './sheets.js';
import { PRESENTATION_REVISION } from './prompts.js';

// Browser-side work is read-only capture; inference and persistence are server jobs.
export function capture(context, settings, index) {
    if (context.groupId) throw new Error('현재 버전은 1:1 캐릭터 채팅을 지원합니다.');
    const card = context.characters[context.characterId];
    if (!card?.avatar || !context.chatId) throw new Error('캐릭터 채팅을 먼저 열어 주세요.');
    const message = context.chat[index];
    if (!message || message.is_user || message.is_system) throw new Error('RP 응답 메시지를 선택해 주세요.');
    const source = readSheets(context);
    if (!source.character.description.trim() && !source.character.personality.trim()) throw new Error('캐릭터 시트 원문이 비어 있습니다. 카드 설정을 확인해 주세요.');
    const branch = settings.branch || 'main';
    const profileKey = JSON.stringify([card.avatar, branch, source.persona.name, fingerprint(source.persona)]);
    const history = context.chat.slice(Math.max(0, index - 5), index + 1).filter(m => !m.is_system).map(m => ({ name: m.name, text: m.mes }));
    const identity = [PRESENTATION_REVISION, card.avatar, context.chatId, branch, profileKey, fingerprint(source), fingerprint(settings.platforms), index, message.swipe_id ?? 0, history, settings.selectionMode || 'auto', settings.selectionMode === 'manual' ? [...(settings.selectedPlatforms || [])].sort() : [], settings.underground === true, settings.outputLanguage || 'en', settings.commentVolume || 'medium'];
    return { profileKey, source, history, identity, key: fingerprint(identity), sourceHash: fingerprint(source), scope: { character: card.avatar, chat: context.chatId, branch } };
}
