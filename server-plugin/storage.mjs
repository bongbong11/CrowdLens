import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const digest = value => createHash('sha256').update(String(value)).digest('hex');
const locks = new Map();
export function serial(root, work) {
    const previous = locks.get(root) || Promise.resolve();
    const next = previous.catch(() => {}).then(work);
    locks.set(root, next);
    next.finally(() => { if (locks.get(root) === next) locks.delete(root); }).catch(() => {});
    return next;
}
export async function rootFor(request) {
    const base = request.user?.directories?.root;
    if (!base || typeof base !== 'string') throw Object.assign(new Error('SillyTavern 계정 데이터 폴더를 확인할 수 없습니다.'), { status: 401 });
    const root = path.join(path.resolve(base), 'crowdlens');
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    if ((await fs.lstat(root)).isSymbolicLink()) throw new Error('저장소 폴더에 심볼릭 링크를 사용할 수 없습니다.');
    return root;
}
async function safeFile(root, relative) {
    const file = path.resolve(root, relative);
    if (!file.startsWith(path.resolve(root) + path.sep)) throw new Error('잘못된 저장 경로입니다.');
    const parts = path.relative(root, file).split(path.sep);
    let parent = root;
    for (const part of parts.slice(0, -1)) {
        parent = path.join(parent, part);
        await fs.mkdir(parent, { recursive: true, mode: 0o700 });
        if ((await fs.lstat(parent)).isSymbolicLink()) throw new Error('저장소에 심볼릭 링크를 사용할 수 없습니다.');
    }
    try { if ((await fs.lstat(file)).isSymbolicLink()) throw new Error('저장 파일에 심볼릭 링크를 사용할 수 없습니다.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return file;
}
export async function read(root, relative, fallback = null) {
    const file = await safeFile(root, relative);
    try { return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return structuredClone(fallback); throw new Error('CrowdLens 저장 파일을 읽지 못했습니다. 원본을 보존했습니다.'); }
}
export async function replaceFile(temp, file, rename = fs.rename, delay = ms => new Promise(resolve => setTimeout(resolve, ms))) {
    for (let attempt = 0; ; attempt++) {
        try { await rename(temp, file); return; }
        catch (error) {
            if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
            // Windows readers/virus scanners can briefly hold the destination open.
            await delay(10 * 2 ** attempt);
        }
    }
}
export async function write(root, relative, data) {
    const file = await safeFile(root, relative);
    const temp = `${file}.${randomUUID()}.tmp`;
    let handle;
    try {
        handle = await fs.open(temp, 'wx', 0o600);
        await handle.writeFile(JSON.stringify(data)); await handle.sync(); await handle.close(); handle = null;
        await replaceFile(temp, file);
    } finally { await handle?.close(); await fs.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
export function scopeOf(raw) {
    if (!raw || !['character', 'chat', 'branch'].every(k => typeof raw[k] === 'string' && raw[k].trim() && raw[k].length <= 500)) throw Object.assign(new Error('캐릭터·채팅·브랜치 정보를 확인해 주세요.'), { status: 400 });
    return { character: raw.character, chat: raw.chat, branch: raw.branch };
}
export const profileFile = scope => `characters/${digest(scope.character)}/branches/${digest(scope.branch)}.json`;
export const chatFile = scope => `chats/${digest(JSON.stringify([scope.character, scope.chat]))}/branches/${digest(scope.branch)}.json`;
export const jobFile = id => {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Object.assign(new Error('잘못된 작업 번호입니다.'), { status: 400 });
    return `jobs/${id}.json`;
};
