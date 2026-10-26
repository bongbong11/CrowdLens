import { PROFILE_PROMPT } from './prompts.js';
import { parseJSON, profileOf } from './core.js';

export async function ensureProfile({ snapshot, settings, generate, valid, save, force = false }) {
    const guard = () => { if (!valid()) throw new Error('프로필 판독이 취소되거나 입력이 바뀌었습니다.'); };
    guard();
    let record = settings.profiles[snapshot.profileKey];
    if (!force && record?.sourceHash === snapshot.sourceHash && record.language === 'en') return record;
    const outputTokens = Math.min(32768, Math.max(8000, Number(settings.outputTokens) || 8192));
    const response = await generate({ systemPrompt: PROFILE_PROMPT, prompt: JSON.stringify(snapshot.source), responseLength: outputTokens, trimNames: false });
    guard();
    record = { sourceHash: snapshot.sourceHash, language: 'en', profile: profileOf(parseJSON(response)) };
    settings.profiles[snapshot.profileKey] = record;
    await save(); guard(); return record;
}
