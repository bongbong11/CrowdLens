import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { importPlatforms } from './runtime/core.js';

export async function loadOriginalCatalog() {
    let bytes;
    for (const relative of ['./prompts/community-reactions.json', '../prompts/community-reactions.json']) {
        try { bytes = await readFile(new URL(relative, import.meta.url)); break; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (!bytes) throw new Error('원본 로어북 파일이 없습니다. CrowdLens 0.3.2 서버 플러그인을 다시 설치해 주세요.');
    return { platforms: importPlatforms(JSON.parse(bytes.toString('utf8'))), revision: createHash('sha256').update(bytes).digest('hex') };
}
