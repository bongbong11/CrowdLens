import { decide } from './runtime/engine.js';
import { PROVIDERS, selectedPlatforms, decisionSummary } from './runtime/core.js';

// Metadata only: never log keys, request bodies, conversation text or profile contents.
export function createJevClassifier({ settings, apiKey, signal, phase, fetchImpl = fetch, log = (event, data) => console.info(`[CrowdLens][jev-bridge] ${event}`, data) }) {
    return async state => {
        await phase('JEV 장면 판독');
        const provider = PROVIDERS[settings.provider];
        const allowed = new Set(Object.values(PROVIDERS).flatMap(p => [p.endpoint, p.usage].filter(Boolean).map(u => u.replace(/^\/proxy\//, ''))));
        const transport = async (url, options) => {
            const target = String(url).replace(/^\/proxy\//, '');
            if (!allowed.has(target)) throw new Error('허용되지 않은 JEV 경로입니다.');
            const meta = { provider: settings.provider, request: url === provider.usage ? 'subscription-check' : 'scene' };
            log('request_started', meta);
            try {
                const response = await fetchImpl(target, { ...options, redirect: 'error' });
                log('response_received', { ...meta, status: response.status ?? (response.ok ? 200 : 0) });
                return response;
            } catch (error) {
                log('request_failed', { ...meta, aborted: signal.aborted });
                throw error;
            }
        };
        let scores;
        try { scores = await decide({ ...settings, apiKey }, state, signal, null, transport); }
        catch (error) { log('decision_failed', { provider: settings.provider }); throw error; }
        log('decision_complete', { provider: settings.provider, ...decisionSummary(selectedPlatforms(settings), scores) });
        return scores;
    };
}
