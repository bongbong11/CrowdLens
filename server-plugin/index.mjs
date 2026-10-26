import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createService } from './service.mjs';
import { selectConnection, makeGenerator } from './model-bridge.mjs';

export const info = { id: 'crowdlens', name: 'CrowdLens Server', description: 'Independent per-user storage and background scene/reaction generation.' };
let service;
export async function init(router) {
    let backend, textBackend, sources, textTypes, adapterError;
    try {
        backend = (await import(pathToFileURL(path.resolve('src/endpoints/backends/chat-completions.js')).href)).router;
        const constants = await import(pathToFileURL(path.resolve('src/constants.js')).href);
        sources = Object.values(constants.CHAT_COMPLETION_SOURCES); textTypes = Object.values(constants.TEXTGEN_TYPES);
        textBackend = (await import(pathToFileURL(path.resolve('src/endpoints/backends/text-completions.js')).href)).router;
    } catch { adapterError = 'SillyTavern 서버 모델 경로를 불러오지 못했습니다. SillyTavern 루트에서 실행하고 최신 버전을 사용해 주세요.'; }
    service = createService({ generateFactory: async (user, config, signal) => {
        if (adapterError) throw new Error(adapterError);
        const connection = await selectConnection(user, config.profileId, sources, textTypes);
        return makeGenerator(backend, user, connection, signal, textBackend);
    } });
    registerRoutes(router, service, !adapterError);
}
export function registerRoutes(router, service, adapterReady = true) {
    const route = handler => async (request, response) => {
        try { response.json(await handler(request)); }
        catch (error) { response.status(error.status || 500).json({ ok: false, error: String(error.message || 'CrowdLens 서버 오류').slice(0, 500) }); }
    };
    router.get('/health', route(async () => ({ ok: true, protocol: 4, version: '0.3.2', storage: true, backgroundJobs: true, modelAdapter: adapterReady })));
    router.post('/bootstrap', route(req => service.bootstrap(req, req.body?.legacy)));
    router.post('/settings', route(req => service.updateSettings(req, req.body)));
    router.post('/keys', route(req => service.saveKey(req, req.body)));
    router.post('/scope', route(req => service.scopeData(req, req.body?.scope)));
    router.post('/scope/clear', route(req => service.clear(req, req.body)));
    router.post('/jobs', route(req => service.submit(req, req.body)));
    router.post('/translations', route(req => service.translate(req, req.body)));
    router.get('/jobs/:id', route(req => service.status(req, req.params.id)));
    router.post('/jobs/:id/cancel', route(req => service.cancel(req, req.params.id)));
}
export async function exit() { await service?.close(); }
