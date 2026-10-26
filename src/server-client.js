export class ServerClient {
    constructor(headers, onError = () => {}) { this.headers = headers; this.onError = onError; this.revision = 0; this.ready = false; this.queue = Promise.resolve(); this.failure = null; }
    async request(route, body, method = 'POST') {
        let response;
        try { response = await fetch(`/api/plugins/crowdlens/${route}`, { method, headers: { ...this.headers(), 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body || {}), signal: AbortSignal.timeout(15000) }); }
        catch { throw new Error('CrowdLens 서버에 연결하지 못했습니다. 서버 실행 상태를 확인해 주세요.'); }
        if (response.status === 404) throw new Error('CrowdLens 서버 플러그인을 설치하고 enableServerPlugins: true 설정 후 SillyTavern을 재시작해 주세요.');
        let data; try { data = await response.json(); } catch { throw new Error('CrowdLens 서버 응답을 읽지 못했습니다.'); }
        if (!response.ok || data?.ok !== true) throw new Error(data?.error || `서버 오류 (${response.status})`);
        return data;
    }
    async initialize(legacy) {
        const data = await this.request('bootstrap', { legacy });
        if (data.protocol !== 2) throw new Error('CrowdLens 서버 플러그인을 최신 버전으로 업데이트해 주세요.');
        this.revision = data.revision; this.ready = true; this.failure = null; return data;
    }
    save(settings) {
        const { profiles, results, ...config } = settings;
        const snapshot = structuredClone(config);
        this.queue = this.queue.catch(() => {}).then(async () => {
            if (!this.ready) throw new Error('서버 저장소를 먼저 연결해 주세요.');
            const data = await this.request('settings', { revision: this.revision, settings: snapshot });
            this.revision = data.revision; this.failure = null;
        });
        this.queue.catch(error => { this.failure = error; this.onError(error); });
        return this.queue;
    }
    async flush() { await this.queue; if (this.failure) throw this.failure; }
    async submit(snapshot) { await this.flush(); return this.request('jobs', { snapshot, scope: snapshot.scope, revision: this.revision }); }
}
