import { PROFILE_PROMPT, REACTION_PROMPT } from './prompts.js';
import { PROVIDERS, parseJSON, profileOf, sceneQuestions, readDecisions, planFeed, postsOf } from './core.js';
export { capture } from './snapshot.js';

export async function decide(settings, state, signal, headers, transport = fetch) {
    if (!settings.apiKey) throw new Error('마법봉 → CrowdLens에서 JEV API 키를 입력해 주세요.');
    const questions = sceneQuestions(settings.platforms);
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

export async function runScene({ snapshot, settings, generate, classify, valid, save, random }) {
    const outputTokens = Math.min(32768, Math.max(8000, Number(settings.outputTokens) || 8192));
    const guard = () => { if (!valid()) throw new Error('채팅 또는 장면이 바뀌어 생성을 취소했습니다.'); };
    guard();
    let record = settings.profiles[snapshot.profileKey];
    if (!record || record.sourceHash !== snapshot.sourceHash) {
        const result = await generate({ systemPrompt: PROFILE_PROMPT, prompt: JSON.stringify(snapshot.source), responseLength: outputTokens, trimNames: false });
        guard();
        record = { sourceHash: snapshot.sourceHash, profile: profileOf(parseJSON(result)) };
        settings.profiles[snapshot.profileKey] = record;
        await save();
    }
    const scores = await classify({ profiles: record.profile, scene: snapshot.history.at(-1), history: snapshot.history.slice(0, -1) });
    guard();
    const plans = planFeed(settings.platforms, scores, 8, random);
    if (!plans.length) return { feeds: [], reason: '이 장면에서 자연스럽게 반응할 공개 경로나 집단이 없습니다.' };
    const result = await generate({
        systemPrompt: REACTION_PROMPT,
        prompt: JSON.stringify({ profiles: record.profile, scene: snapshot.history.at(-1), history: snapshot.history.slice(0, -1), platforms: plans }),
        responseLength: outputTokens, trimNames: false,
    });
    guard();
    return { feeds: postsOf(parseJSON(result), plans), reason: '' };
}
