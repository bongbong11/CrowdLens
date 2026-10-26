import { ensureProfile } from './profile.js';
import { REACTION_PROMPT } from './prompts.js';
import { PROVIDERS, GROUPS, parseJSON, sceneQuestions, readDecisions, planFeed, manualPlans, postsOf, selectedPlatforms, decisionSummary } from './core.js';
export { capture } from './snapshot.js';

export async function decide(settings, state, signal, headers, transport = fetch) {
    if (!settings.apiKey) throw new Error('마법봉 → CrowdLens에서 JEV API 키를 입력해 주세요.');
    const questions = sceneQuestions(selectedPlatforms(settings), settings.selectionMode === 'manual');
    const provider = PROVIDERS[settings.provider];
    if (!provider) throw new Error('JEV 제공자를 선택해 주세요.');
    signal = signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
    const shared = provider.endpoint.startsWith('/') ? headers?.() : {};
    const requestHeaders = { ...shared, 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${settings.apiKey}` };
    if (provider.usage) {
        const usageResponse = await transport(provider.usage, { method: 'GET', headers: requestHeaders, signal, redirect: 'error' });
        if (!usageResponse.ok) throw new Error(`NanoGPT 구독 확인 실패 (${usageResponse.status}).`);
        const usage = await usageResponse.json();
        if (usage?.routing?.paidSpendPolicyAllowsBalance !== false) throw new Error('NanoGPT 키의 Billing을 Subscription only로 설정해 주세요.');
        if (usage.routing.recommendedMode !== 'subscription') throw new Error('NanoGPT 구독을 현재 사용할 수 없습니다. 구독 상태와 한도를 확인해 주세요.');
    }
    const payload = provider.usage
        ? { model: provider.model, messages: [{ role: 'user', content: JSON.stringify(state) }], stream: false, response_format: { type: 'questions', questions } }
        : { model: provider.model, state, questions };
    const response = await transport(provider.endpoint, {
        method: 'POST', signal,
        headers: requestHeaders,
        body: JSON.stringify(payload), redirect: 'error',
    });
    if (!response.ok) throw new Error(`JEV 요청 실패 (${response.status}). 키·잔액·연결을 확인해 주세요.`);
    let data = await response.json();
    if (provider.usage) {
        const parsed = parseJSON(data?.choices?.[0]?.message?.content);
        data = { answers: parsed.answers ?? parsed };
    }
    return readDecisions(data, questions);
}

export function reactionInput(snapshot, profiles, plans, selectionMode, outputLanguage = 'en') {
    const instructions = [], byText = new Map();
    const ref = text => {
        if (!text) return null;
        if (!byText.has(text)) { const id = `instruction-${instructions.length + 1}`; byText.set(text, id); instructions.push({ id, text }); }
        return byText.get(text);
    };
    const platforms = plans.map(({ prompt, sharedPrompt, outputLanguage: language, voices, ...plan }) => ({ ...plan, voices: voices.map(({ region, culture, language, personality }) => ({ region, culture, voice: `${language}; ${personality}` })), promptRef: ref(prompt), sharedPromptRef: ref(sharedPrompt) }));
    return { profiles, scene: snapshot.history.at(-1), history: snapshot.history.slice(0, -1), selectionMode, outputLanguage, groups: GROUPS, instructions, platforms };
}
export async function runScene({ snapshot, settings, generate, classify, valid, save, random }) {
    const outputLanguage = settings.outputLanguage === 'ko' ? 'ko' : 'en';
    const count = { low: 3, medium: 6, high: 10 }[settings.commentVolume] || 6;
    const platforms = selectedPlatforms(settings).map(p => ({ ...p, moderation: settings.underground ? 'unmoderated' : 'normal', outputLanguage }));
    if (!platforms.length) throw new Error('생성할 커뮤니티를 하나 이상 선택해 주세요.');
    const outputTokens = Math.min(32768, Math.max(8000, Number(settings.outputTokens) || 8192));
    const guard = () => { if (!valid()) throw new Error('채팅 또는 장면이 바뀌어 생성을 취소했습니다.'); };
    guard();
    const record = await ensureProfile({ snapshot, settings, generate, valid, save });
    const manual = settings.selectionMode === 'manual';
    let plans;
    if (manual) plans = manualPlans(platforms, count, random);
    else {
        const scores = await classify({ profiles: record.profile, scene: snapshot.history.at(-1), history: snapshot.history.slice(0, -1) });
        guard(); plans = planFeed(platforms, scores, count, random);
        if (!plans.length) {
            const reason = {
                visibility: '현재 장면의 공개·목격·공유 경로가 확인되지 않았습니다.',
                platforms: '현재 장면에 맞는 커뮤니티가 선택되지 않았습니다.',
                groups: '선택된 커뮤니티에서 정보를 알 수 있는 반응 집단이 확인되지 않았습니다.',
            }[decisionSummary(platforms, scores).rejection];
            return { feeds: [], reason: `JEV 판독 완료: ${reason} 반응 작성 모델은 호출하지 않았습니다.` };
        }
    }
    if (!plans.length) return { feeds: [], reason: '이 장면에서 자연스럽게 반응할 공개 경로나 집단이 없습니다.' };
    const result = await generate({
        systemPrompt: REACTION_PROMPT,
        prompt: JSON.stringify(reactionInput(snapshot, record.profile, plans, manual ? 'manual' : 'auto', outputLanguage)),
        responseLength: outputTokens, trimNames: false,
    });
    guard();
    const parsed = parseJSON(result);
    if (manual && Array.isArray(parsed.feeds) && !parsed.feeds.length && typeof parsed.reason === 'string' && parsed.reason.trim()) return { feeds: [], reason: parsed.reason.trim().slice(0, 500) };
    return { feeds: postsOf(parsed, plans), reason: '' };
}
