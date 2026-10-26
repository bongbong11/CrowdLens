import test from 'node:test';
import assert from 'node:assert/strict';
import { createJevClassifier } from '../server-plugin/jev-bridge.mjs';
import { sceneQuestions } from '../src/core.js';

for (const provider of ['typesafe', 'nanogpt']) test(`${provider}: actual JEV transport and parsed decision have distinct safe logs`, async () => {
    const logs = [], requests = [], phases = [];
    const settings = { provider, platforms: [{ id: 'test', name: 'Forum', prompt: 'Forum discussion' }] };
    const classify = createJevClassifier({ settings, apiKey: 'SECRET_KEY', signal: new AbortController().signal,
        phase: async phase => phases.push(phase), log: (event, data) => logs.push({ event, data }),
        fetchImpl: async (url, options) => {
            requests.push(url);
            assert.equal(options.headers.Authorization, 'Bearer SECRET_KEY');
            if (url.endsWith('/usage')) return { ok: true, status: 200, json: async () => ({ routing: { paidSpendPolicyAllowsBalance: false, recommendedMode: 'subscription' } }) };
            const answers = Object.fromEntries(Object.keys(sceneQuestions(settings.platforms)).map(key => [key, { noul: .1 }]));
            assert.ok(options.body.includes('PRIVATE_STATE_SENTINEL'));
            return { ok: true, status: 200, json: async () => provider === 'typesafe' ? { answers } : { choices: [{ message: { content: JSON.stringify({ answers }) } }] } };
        } });
    assert.deepEqual(await classify({ scene: 'PRIVATE_STATE_SENTINEL' }), Object.fromEntries(Object.keys(sceneQuestions(settings.platforms)).map(key => [key, .1])));
    assert.equal(requests.length, provider === 'typesafe' ? 1 : 2);
    assert.equal(phases.length, 1);
    assert.deepEqual(logs.filter(l => l.data.request === 'scene').map(l => l.event), ['request_started', 'response_received']);
    assert.equal(logs.at(-1).event, 'decision_complete');
    assert.equal(logs.at(-1).data.rejection, 'visibility');
    assert.equal(/SECRET_KEY|PRIVATE_STATE_SENTINEL|Authorization/.test(JSON.stringify(logs)), false);
});

test('failed HTTP or malformed JEV response never becomes a successful empty decision', async () => {
    for (const response of [{ ok: false, status: 401 }, { ok: true, status: 200, json: async () => ({ answers: {} }) }]) {
        const events = [];
        const classify = createJevClassifier({ settings: { provider: 'typesafe', platforms: [] }, apiKey: 'test', signal: new AbortController().signal,
            phase: async () => {}, log: event => events.push(event), fetchImpl: async () => response });
        await assert.rejects(classify({}));
        assert.ok(events.includes('decision_failed'));
        assert.equal(events.includes('decision_complete'), false);
    }
});
