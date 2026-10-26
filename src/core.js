export const PROVIDERS = {
    typesafe: { name: 'JEV 공홈 (TypeSafe)', endpoint: '/proxy/https://api.typesafe.ai/v1/systemone', model: 'jev-latest' },
    nanogpt: { name: 'NanoGPT (구독 전용)', endpoint: '/proxy/https://nano-gpt.com/api/subscription/v1/chat/completions', usage: '/proxy/https://nano-gpt.com/api/subscription/v1/usage', model: 'typesafe/jev-1.14' },
    openrouter: { name: 'OpenRouter', endpoint: 'https://openrouter.ai/api/alpha/decisions', model: 'typesafe/jev-1.13' },
};
export const GROUPS = {
    acquaintances: 'friends or acquaintances who can actually know about this event',
    colleagues: 'colleagues or industry contacts with plausible access to this information',
    fans: 'an established fandom with access to this event',
    media: 'media with a newsworthy event and publicly available evidence',
    public: 'ordinary users who have encountered the publicly available information',
    critics: 'critical users with plausible access to this information',
};
export const DEFAULT_PLATFORMS = [
    { id: 'x', name: 'X', style: 'microblog', prompt: 'Short posts, quote reactions, and varied voices. Use hashtags only when appropriate.' },
    { id: 'instagram', name: 'Instagram', style: 'photo', prompt: 'Short comments on photos or public posts. Vary familiarity according to the relationship.' },
    { id: 'reddit', name: 'Reddit', style: 'forum', prompt: 'Topic-based community post titles and comments. Mix opinions, counterarguments, and conversational replies.' },
    { id: 'community', name: '커뮤니티', style: 'board', prompt: 'Anonymous board titles and comments. Include niche perspectives and disagreements rather than unanimous opinions.' },
];
const text = (v, max = 600) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const isSms = p => /^(sms|text[-_ ]?messages?)$/i.test(String(p?.id || '')) || /\bsms\b|문자|text messaging/i.test(String(p?.name || ''));
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
    if (!Array.isArray(raw) && raw?.entries && typeof raw.entries === 'object') {
        const entries = Object.values(raw.entries).filter(e => !e.disable);
        const common = entries.filter(e => e.constant || /공통|archetypes/i.test(e.comment || '')).map(e => e.content).join('\n\n');
        rows = entries.filter(e => !e.constant && !/공통|archetypes/i.test(e.comment || '')).map((e, i) => {
            const name = e.comment || e.key?.[0];
            const match = [['twitch', 'live'], ['reddit', 'forum'], ['twitter', 'microblog'], ['discord', 'chat'], ['youtube', 'video'], ['ao3', 'archive'], ['instagram', 'photo'], ['tiktok', 'shortvideo'], ['4chan', 'anon']].find(([word]) => name?.toLowerCase().includes(word));
            return { id: match?.[0] || `import-${i}`, name: name?.replace(/ Format$/, ''), prompt: e.content, sharedPrompt: common, style: match?.[1] || 'board' };
        });
    }
    if (!Array.isArray(rows) && rows && typeof rows === 'object') rows = Object.entries(rows).map(([name, prompt], i) => ({ id: `import-${i}`, name, prompt }));
    if (Array.isArray(rows)) rows = rows.filter(p => !isSms(p));
    if (!Array.isArray(rows) || !rows.length || rows.length > 24) throw new Error('SMS를 제외한 플랫폼은 1~24개여야 합니다. platforms 배열 또는 로어북 entries를 확인해 주세요.');
    const ids = new Set();
    return rows.map((p, i) => {
        const id = /^[a-z0-9_-]{1,40}$/i.test(p.id) ? p.id : `platform-${i}`;
        if (ids.has(id)) throw new Error('플랫폼 ID가 중복됩니다.');
        ids.add(id);
        const row = { id, name: text(p.name, 80), prompt: text(p.prompt, 20000), sharedPrompt: text(p.sharedPrompt, 12000), style: ['microblog', 'photo', 'forum', 'board', 'live', 'chat', 'video', 'archive', 'shortvideo', 'anon'].includes(p.style) ? p.style : 'board' };
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
        visible: { type: 'noul', instructions: 'scene is the latest roleplay reply; history is background only. There is explicit evidence that other people can know about the current event, such as a public post, broadcast, report, witness, or participant sharing it. A past public event does not make the current private scene public. Celebrity status alone does not expose private events. Do not speculate.' },
    };
    for (const [i, platform] of platforms.entries()) {
        questions[`p${i}`] = { type: 'noul', instructions: `Reactions to the known information in scene would naturally occur on ${platform.name} now. Platform description: ${platform.prompt.slice(0, 300)}` };
        for (const [group, label] of Object.entries(GROUPS)) questions[`p${i}_${group}`] = { type: 'noul', instructions: `On ${platform.name}, ${label} could plausibly react to this event. Base the decision on recognition, public information, relationships in profiles, and the information exposure shown in scene. Do not invent a fandom or media interest for an ordinary person.` };
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
        const culture = ['korean', 'international'].includes(feed?.culture) ? feed.culture : plan.id === 'community' ? 'korean' : 'international';
        const remaining = { ...plan.slots };
        const posts = (Array.isArray(feed?.posts) ? feed.posts : []).slice(0, 32).map((post, index) => {
            if (!(remaining[post.group] > 0)) throw new Error('허용되지 않은 집단 또는 반응 수입니다.');
            remaining[post.group]--;
            const body = text(post.body, 1600);
            if (!body) throw new Error('빈 반응이 반환되었습니다.');
            if (!['us', 'europe', 'eastasia'].includes(post.region)) throw new Error('반응의 커뮤니티 권역이 올바르지 않습니다.');
            if (post.replyTo != null && (!Number.isInteger(post.replyTo) || post.replyTo < 0 || post.replyTo >= index)) throw new Error('답글이 이전 댓글을 올바르게 가리키지 않습니다.');
            return { author: text(post.author, 80) || '익명', group: post.group, region: post.region, replyTo: post.replyTo ?? null, culture: ['korean', 'international'].includes(post.culture) ? post.culture : culture, body, title: text(post.title, 160) };
        });
        if (Object.values(remaining).some(n => n !== 0)) throw new Error('요청한 집단별 반응 수와 결과가 다릅니다. 다시 생성해 주세요.');
        return { id: plan.id, name: plan.name, style: plan.style, culture, posts };
    });
}
