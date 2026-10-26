import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';

export async function selectConnection(user, profileId, sources, textTypes = []) {
    const saved = JSON.parse(await fs.readFile(path.join(user.directories.root, 'settings.json'), 'utf8'));
    const aliases = { oai: 'openai', google: 'makersuite' };
    const manager = saved.extension_settings?.connectionManager;
    const id = profileId || manager?.selectedProfile;
    const profile = id ? manager?.profiles?.find(p => p.id === id) : null;
    if (id && !profile) throw new Error('저장된 연결 프로필을 찾지 못했습니다. SillyTavern에서 저장한 뒤 다시 선택해 주세요.');
    const textApi = { kcpp: 'koboldcpp', 'openrouter-text': 'openrouter' }[profile?.api] || profile?.api || saved.textgenerationwebui_settings?.type;
    const isText = profile ? profile.mode === 'tc' || (textTypes.includes(textApi) && !sources.includes(aliases[profile.api] || profile.api)) : saved.main_api === 'textgenerationwebui';
    if (isText) {
        if (!textTypes.includes(textApi)) throw new Error('이 Text Completion 프로필은 지원되지 않습니다.');
        const current = saved.textgenerationwebui_settings || {};
        const apiServer = profile?.['api-url'] || current.server_urls?.[textApi] || saved.api_server_textgenerationwebui;
        if (!apiServer) throw new Error('Text Completion 프로필의 서버 URL을 확인해 주세요.');
        let instruct = null;
        if (profile?.instruct && profile['instruct-state'] !== 'false') {
            if (path.basename(profile.instruct) !== profile.instruct) throw new Error('잘못된 지시 템플릿 이름입니다.');
            const directory = user.directories.instruct || path.join(user.directories.root, 'instruct');
            try { instruct = JSON.parse(await fs.readFile(path.join(directory, `${profile.instruct}.json`), 'utf8')); }
            catch { throw new Error('연결 프로필의 지시 템플릿을 서버에서 찾지 못했습니다.'); }
        }
        return { kind: 'text', model: profile?.model || current.model, api_type: textApi, api_server: apiServer, secret_id: profile?.['secret-id'], instruct };
    }
    if (!profile && saved.main_api !== 'openai') throw new Error('Chat Completion 또는 Text Completion 연결 프로필을 선택해 주세요.');
    const current = saved.oai_settings || {};
    const source = profile ? aliases[profile.api] || profile.api : current.chat_completion_source;
    if (!sources.includes(source)) throw new Error('이 연결 프로필은 서버 Chat Completion 방식으로 사용할 수 없습니다.');
    const modelFields = { openai: 'openai_model', claude: 'claude_model', openrouter: 'openrouter_model', makersuite: 'google_model', vertexai: 'vertexai_model', custom: 'custom_model', nanogpt: 'nanogpt_model', deepseek: 'deepseek_model', groq: 'groq_model', mistralai: 'mistralai_model' };
    const model = profile?.model || current[modelFields[source]] || current[`${source}_model`];
    if (!model) throw new Error('연결 모델을 선택하고 SillyTavern 설정을 저장해 주세요.');
    const proxy = profile?.proxy ? saved.proxies?.find(p => p.name === profile.proxy) : null;
    return {
        model, chat_completion_source: source,
        secret_id: profile?.['secret-id'],
        custom_url: profile?.['api-url'] || current.custom_url,
        vertexai_region: profile?.['api-url'] || current.vertexai_region,
        zai_endpoint: profile?.['api-url'] || current.zai_endpoint,
        siliconflow_endpoint: profile?.['api-url'] || current.siliconflow_endpoint,
        minimax_endpoint: profile?.['api-url'] || current.minimax_endpoint,
        pollinations_endpoint: profile?.['api-url'] || current.pollinations_endpoint,
        reverse_proxy: profile ? proxy?.url : current.reverse_proxy,
        proxy_password: profile ? proxy?.password : current.proxy_password,
        custom_prompt_post_processing: profile?.['prompt-post-processing'] || current.custom_prompt_post_processing,
    };
}

// Invoke the already-authenticated ST backend router with a detached socket.
// No browser session cookie, model key, or auth header is stored in job files.
export async function invokeChatRouter(router, user, payload, signal) {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
        const socket = new EventEmitter();
        const request = new EventEmitter();
        Object.assign(request, { user, socket, body: structuredClone(payload), method: 'POST', url: '/generate', originalUrl: '/generate', query: {}, params: {}, headers: { 'content-type': 'application/json' } });
        request.get = name => request.headers[name.toLowerCase()];
        const response = new EventEmitter();
        const headers = new Map(); let settled = false, chunks = [];
        const finish = (error, data) => {
            if (settled) return; settled = true; signal?.removeEventListener('abort', abort);
            response.writableEnded = true;
            if (error) reject(error); else resolve(data);
        };
        const abort = () => { socket.emit('close'); finish(new Error('서버 모델 요청이 취소되거나 제한 시간을 넘었습니다.')); };
        signal?.addEventListener('abort', abort, { once: true });
        Object.assign(response, {
            statusCode: 200, headersSent: false, writableEnded: false,
            status(code) { this.statusCode = code; return this; },
            set(name, value) { if (typeof name === 'object') Object.entries(name).forEach(([k, v]) => headers.set(k.toLowerCase(), v)); else headers.set(name.toLowerCase(), value); return this; },
            setHeader(name, value) { headers.set(name.toLowerCase(), value); return this; },
            getHeader(name) { return headers.get(name.toLowerCase()); },
            removeHeader(name) { headers.delete(name.toLowerCase()); },
            writeHead(code, values) { this.statusCode = code; if (values) this.set(values); this.headersSent = true; return this; },
            write(chunk) { chunks.push(Buffer.from(chunk)); return true; },
            flushHeaders() { this.headersSent = true; },
            sendStatus(code) { this.status(code); return this.send({ error: true }); },
            json(data) { return this.send(data); },
            send(data) {
                if (Buffer.isBuffer(data)) data = data.toString('utf8');
                if (typeof data === 'string') { try { data = JSON.parse(data); } catch { /* Handled as invalid response below. */ } }
                if (this.statusCode >= 400 || data?.error) finish(new Error(`SillyTavern 모델 요청 실패 (${this.statusCode}). 연결 프로필·키·잔액을 확인해 주세요.`));
                else finish(null, data);
                return this;
            },
            end(chunk) { if (chunk) chunks.push(Buffer.from(chunk)); return this.send(chunks.length ? Buffer.concat(chunks).toString('utf8') : { error: true }); },
        });
        request.res = response; response.req = request;
        try { router.handle(request, response, error => finish(error || new Error('SillyTavern 생성 경로를 찾지 못했습니다.'))); }
        catch (error) { finish(error); }
    });
}
export function textFrom(data) {
    const finish = data?.choices?.[0]?.finish_reason ?? data?.finish_reason;
    if (['length', 'max_tokens'].includes(finish)) throw new Error('모델 출력이 잘렸습니다. 최대 출력 토큰을 늘려 주세요.');
    const text = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? data?.results?.[0]?.text ?? data?.response ?? data?.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error('SillyTavern 서버가 유효한 모델 텍스트를 반환하지 않았습니다.');
    return text;
}
export function makeGenerator(router, user, connection, signal, textRouter = null) {
    return async options => {
        if (connection.kind === 'text') {
            if (!textRouter) throw new Error('SillyTavern Text Completion 서버 경로를 찾지 못했습니다.');
            const { kind, instruct, ...params } = connection;
            const template = instruct || {};
            const prompt = `${template.system_sequence || 'System: '}${options.systemPrompt}${template.system_suffix ?? '\n'}${template.input_sequence || 'User: '}${options.prompt}${template.input_suffix ?? '\n'}${template.last_output_sequence || template.output_sequence || 'Assistant: '}`;
            return textFrom(await invokeChatRouter(textRouter, user, { ...params, prompt, stream: false, max_tokens: options.responseLength, max_new_tokens: options.responseLength, temperature: 0.8, top_p: 1 }, signal));
        }
        return textFrom(await invokeChatRouter(router, user, {
            ...connection, stream: false, max_tokens: options.responseLength, temperature: 0.8, top_p: 1,
            messages: [{ role: 'system', content: options.systemPrompt }, { role: 'user', content: options.prompt }],
        }, signal));
    };
}
