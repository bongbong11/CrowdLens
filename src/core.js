export const PROVIDERS = {
    typesafe: { name: 'JEV 공홈 (TypeSafe)', endpoint: '/proxy/https://api.typesafe.ai/v1/systemone', model: 'jev-latest' },
    nanogpt: { name: 'NanoGPT (구독 전용)', endpoint: '/proxy/https://nano-gpt.com/api/subscription/v1/chat/completions', usage: '/proxy/https://nano-gpt.com/api/subscription/v1/usage', model: 'typesafe/jev-1.14' },
    openrouter: { name: 'OpenRouter', endpoint: 'https://openrouter.ai/api/alpha/decisions', model: 'typesafe/jev-1.13' },
};
export const GROUPS = {
    acquaintances: '실제로 해당 일을 알 수 있는 친구·지인',
    colleagues: '해당 일을 알 수 있는 동료·업계 관계자',
    fans: '실제로 존재하며 이 일을 접할 수 있는 팬덤',
    media: '보도 가치와 공개 근거가 있는 미디어',
    public: '공개된 정보를 접한 일반 이용자',
    critics: '해당 정보를 접할 수 있는 비판적 이용자',
};
export const DEFAULT_PLATFORMS = [
    { id: 'x', name: 'X', style: 'microblog', prompt: '짧은 포스트, 인용 반응, 서로 다른 말투. 해시태그는 필요한 경우만.' },
    { id: 'instagram', name: 'Instagram', style: 'photo', prompt: '사진·공개 게시물에 달린 짧은 댓글. 친밀도에 따라 말투를 구분.' },
    { id: 'reddit', name: 'Reddit', style: 'forum', prompt: '주제별 커뮤니티의 제목과 댓글. 의견과 반론, 답글이 자연스럽게 섞임.' },
    { id: 'community', name: '커뮤니티', style: 'board', prompt: '익명 게시판의 제목과 댓글. 지엽적인 관점도 섞고 모두 같은 의견을 내지 않음.' },
];
const text = (v, max = 600) => typeof v === 'string' ? v.trim().slice(0, max) : '';
export function parseJSON(raw) {
    if (typeof raw !== 'string') throw new Error('모델이 JSON 문자열을 반환하지 않았습니다.');
    return JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
}
export function profileOf(raw) {
    const person = p => {
        const out = {};
        for (const key of ['name', 'occupation', 'recognition', 'reputation', 'acquaintanceView', 'publicInfo']) out[key] = text(p?.[key]);
        if (!out.name || !out.occupation) throw new Error('사회적 프로필 형식이 올바르지 않습니다.');
        return out;
    };
    return { character: person(raw?.character), persona: person(raw?.persona) };
}
// Explicit normalized format; also accepts common lorebook exports without executing their content.
export function importPlatforms(raw) {
    let rows = raw?.platforms ?? raw;
    if (raw?.entries) {
        const entries = Object.values(raw.entries).filter(e => !e.disable);
        const common = entries.filter(e => e.constant || /공통|archetypes/i.test(e.comment || '')).map(e => e.content).join('\n\n');
        rows = entries.filter(e => !e.constant && !/공통|archetypes/i.test(e.comment || '')).map((e, i) => {
            const name = e.comment || e.key?.[0];
            const match = [['twitch', 'live'], ['reddit', 'forum'], ['twitter', 'microblog'], ['discord', 'chat'], ['youtube', 'video'], ['ao3', 'archive'], ['instagram', 'photo'], ['tiktok', 'shortvideo'], ['sms', 'sms'], ['4chan', 'anon']].find(([word]) => name?.toLowerCase().includes(word));
            return { id: match?.[0] || `import-${i}`, name: name?.replace(/ Format$/, ''), prompt: e.content, sharedPrompt: common, style: match?.[1] || 'board' };
        });
    }
    if (!Array.isArray(rows) && rows && typeof rows === 'object') rows = Object.entries(rows).map(([name, prompt], i) => ({ id: `import-${i}`, name, prompt }));
    if (!Array.isArray(rows) || !rows.length || rows.length > 24) throw new Error('플랫폼은 1~24개여야 합니다. platforms 배열 또는 로어북 entries를 확인해 주세요.');
    const ids = new Set();
    return rows.map((p, i) => {
        const id = /^[a-z0-9_-]{1,40}$/i.test(p.id) ? p.id : `platform-${i}`;
        if (ids.has(id)) throw new Error('플랫폼 ID가 중복됩니다.');
        ids.add(id);
        const row = { id, name: text(p.name, 80), prompt: text(p.prompt, 20000), sharedPrompt: text(p.sharedPrompt, 12000), style: ['microblog', 'photo', 'forum', 'board', 'live', 'chat', 'video', 'archive', 'shortvideo', 'sms', 'anon'].includes(p.style) ? p.style : 'board' };
        if (!row.name || !row.prompt) throw new Error('각 플랫폼에 name과 prompt가 필요합니다.');
        return row;
    });
}
export function fingerprint(value) {
    // Cache identity only, never a security primitive.
    let h = 2166136261;
    for (const c of JSON.stringify(value)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return (h >>> 0).toString(36);
}
export function sceneQuestions(platforms) {
    const questions = {
        visible: { type: 'noul', instructions: 'scene은 최신 RP 응답이고 history는 참고용 과거다. 지금 scene의 사건이 타인에게 알려질 명시적인 근거(공개 게시, 방송, 보도, 목격, 당사자 공유)가 있다. 과거 history가 공개였어도 현재 scene이 비공개라면 false다. 단순히 공인이라는 이유로 비공개 사건이 알려지지는 않는다. 추측하지 말 것.' },
    };
    for (const [i, platform] of platforms.entries()) {
        questions[`p${i}`] = { type: 'noul', instructions: `scene의 알려진 정보에 대해 ${platform.name}에서 지금 반응이 생기는 것이 자연스럽다. 플랫폼 설명: ${platform.prompt.slice(0, 300)}` };
        for (const [group, label] of Object.entries(GROUPS)) questions[`p${i}_${group}`] = { type: 'noul', instructions: `${platform.name}에서 ${label} 집단이 이 사건에 반응할 수 있다. profiles의 인지도·공개정보·관계와 scene의 정보 유출 경로를 근거로 판단. 일반인에게 팬덤이나 언론 관심을 임의로 만들지 말 것.` };
    }
    return questions;
}
export function readDecisions(data, questions) {
    const out = {};
    for (const id of Object.keys(questions)) {
        const n = data?.answers?.[id]?.noul;
        if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1) throw new Error(`JEV 판정 누락 또는 잘못된 값: ${id}`);
        out[id] = n;
    }
    return out;
}
export function planFeed(platforms, scores, count = 8, random = Math.random) {
    if (!(scores.visible >= 0.65)) return [];
    return platforms.flatMap((platform, i) => {
        if (!(scores[`p${i}`] >= 0.55)) return [];
        const candidates = Object.keys(GROUPS).filter(g => scores[`p${i}_${g}`] >= 0.55);
        const weights = candidates.map(group => ({ group, weight: scores[`p${i}_${group}`] ** 2 * (0.4 + random()) }));
        if (!weights.length) return [];
        const slots = {};
        for (let n = 0; n < count; n++) {
            let pick = random() * weights.reduce((sum, item) => sum + item.weight, 0);
            const chosen = weights.find(item => (pick -= item.weight) < 0) ?? weights.at(-1);
            slots[chosen.group] = (slots[chosen.group] || 0) + 1;
        }
        return [{ ...platform, slots }];
    });
}
export function postsOf(raw, plans) {
    if (!Array.isArray(raw?.feeds)) throw new Error('반응 JSON에 feeds가 없습니다.');
    return plans.map(plan => {
        const feed = raw.feeds.find(f => f.platform === plan.id);
        const remaining = { ...plan.slots };
        const posts = (Array.isArray(feed?.posts) ? feed.posts : []).slice(0, 32).map(post => {
            if (!(remaining[post.group] > 0)) throw new Error('허용되지 않은 집단 또는 반응 수입니다.');
            remaining[post.group]--;
            const body = text(post.body, 1600);
            if (!body) throw new Error('빈 반응이 반환되었습니다.');
            return { author: text(post.author, 80) || '익명', group: post.group, body, title: text(post.title, 160) };
        });
        if (Object.values(remaining).some(n => n !== 0)) throw new Error('요청한 집단별 반응 수와 결과가 다릅니다. 다시 생성해 주세요.');
        return { id: plan.id, name: plan.name, style: plan.style, posts };
    });
}
