export const PROVIDERS = {
    typesafe: { name: 'JEV 공홈 (TypeSafe)', endpoint: '/proxy/https://api.typesafe.ai/v1/systemone', model: 'jev-latest' },
    nanogpt: { name: 'NanoGPT (구독 전용)', endpoint: '/proxy/https://nano-gpt.com/api/subscription/v1/chat/completions', usage: '/proxy/https://nano-gpt.com/api/subscription/v1/usage', model: 'typesafe/jev-1.14' },
};
export const GROUPS = {
    acquaintances: 'friends or acquaintances who can actually know about this event',
    colleagues: 'colleagues or industry contacts with plausible access to this information',
    fans: 'an established fandom with access to this event',
    media: 'media with a newsworthy event and publicly available evidence',
    public: 'ordinary users who have encountered the publicly available information',
    critics: 'critical users with plausible access to this information',
};
export const LEGACY_DEFAULT_PLATFORMS = [
    { id: 'x', name: 'X', style: 'microblog', prompt: 'Short posts, quote reactions, and varied voices. Use hashtags only when appropriate.' },
    { id: 'instagram', name: 'Instagram', style: 'photo', prompt: 'Short comments on photos or public posts. Vary familiarity according to the relationship.' },
    { id: 'reddit', name: 'Reddit', style: 'forum', prompt: 'Topic-based community post titles and comments. Mix opinions, counterarguments, and conversational replies.' },
    { id: 'community', name: '커뮤니티', style: 'board', prompt: 'Anonymous board titles and comments. Include niche perspectives and disagreements rather than unanimous opinions.' },
];
// Original built-in descriptions; the user's uploaded lorebook stays private.
export const DEFAULT_PLATFORMS = [
    { id: 'twitch', name: 'Twitch Chat', style: 'live', prompt: 'Write a fast livestream chat reacting to the current visible moment. Mix short messages, interruptions, recognizable emotes and individual personalities; avoid long essays.' },
    { id: 'reddit', name: 'Reddit', style: 'forum', prompt: 'Write a topic-specific forum thread with a concise title and conversational replies. Include different viewpoints, tangents and individual levels of investment.' },
    { id: 'twitter', name: 'X / Twitter', style: 'microblog', prompt: 'Write brief public posts, quote-post remarks and reply chains. Mix sincere reactions with jokes, criticism and context-specific memes.' },
    { id: 'discord', name: 'Discord', style: 'chat', prompt: 'Write a casual channel conversation among users who plausibly share this information. Use varied message lengths, familiar banter and replies.' },
    { id: 'youtube', name: 'YouTube', style: 'video', prompt: 'Write comments beneath a relevant public video. Mix reactions to particular moments, short jokes, observations and argumentative reply chains.' },
    { id: 'ao3', name: 'AO3', style: 'archive', prompt: 'Write archive-style reader comments about a relevant fanwork or fandom discussion only when the scene supports it. Include distinct reader voices and interpretations.' },
    { id: 'instagram', name: 'Instagram', style: 'photo', prompt: 'Write comments beneath a relevant public photo or short post. Vary familiarity, attention, humor and tone according to each commenter and relationship.' },
    { id: 'tiktok', name: 'TikTok', style: 'shortvideo', prompt: 'Write quick comments beneath a relevant public short video. Mix specific visual observations, local meme habits, informal jokes and conversational replies.' },
    { id: '4chan', name: '4chan / Anon', style: 'anon', moderation: 'unmoderated', prompt: 'Write an anonymous imageboard thread with numbered replies, occasional greentext and chaotic individual voices. Include crude shitposting, harsh mockery and petty arguments where appropriate. This fictional space has no moderator deletion notices.' },
];

export function upgradeCatalog(raw = {}, offered = {}) {
    const saved = raw && typeof raw === 'object' ? raw : {};
    const supplied = Array.isArray(offered?.platforms) ? importPlatforms(offered.platforms) : null;
    const fullBundle = supplied && offered.promptSource && DEFAULT_PLATFORMS.every(p => supplied.some(q => q.id === p.id));
    const old = Array.isArray(saved.platforms) ? saved.platforms : [];
    const legacyFour = old.length === 4 && LEGACY_DEFAULT_PLATFORMS.every(p => old.some(q => q.id === p.id));
    const adoptBundle = fullBundle && !saved.promptSource && old.every(p => [...DEFAULT_PLATFORMS, ...LEGACY_DEFAULT_PLATFORMS].some(q => q.id === p.id));
    if (saved.promptSource || (!legacyFour && !adoptBundle)) return { ...saved, catalogVersion: 1 };
    const platforms = structuredClone(fullBundle ? supplied : DEFAULT_PLATFORMS);
    for (const platform of old) {
        const builtin = (legacyFour ? LEGACY_DEFAULT_PLATFORMS : DEFAULT_PLATFORMS).find(p => p.id === platform.id);
        const customized = !builtin || ['name', 'style', 'prompt'].some(key => platform[key] !== builtin[key]) || Boolean(platform.sharedPrompt) || (platform.moderation === 'unmoderated' && builtin.moderation !== 'unmoderated');
        if (!customized) continue;
        const id = platform.id === 'x' ? 'twitter' : platform.id;
        const replacement = { ...platform, id }, index = platforms.findIndex(p => p.id === id);
        if (index < 0) platforms.push(replacement); else platforms[index] = replacement;
    }
    const selectedPlatforms = saved.selectionMode === 'manual' && Array.isArray(saved.selectedPlatforms)
        ? saved.selectedPlatforms.map(id => id === 'x' ? 'twitter' : id).filter(id => platforms.some(p => p.id === id))
        : platforms.map(p => p.id);
    return { ...saved, catalogVersion: 1, platforms, selectedPlatforms, ...(fullBundle ? { promptSource: offered.promptSource } : {}) };
}
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
            return { id: match?.[0] || `import-${fingerprint(name || i)}`, name: name?.replace(/ Format$/, ''), prompt: e.content, sharedPrompt: common, style: match?.[1] || 'board' };
        });
    }
    if (!Array.isArray(rows) && rows && typeof rows === 'object') rows = Object.entries(rows).map(([name, prompt]) => ({ id: `import-${fingerprint(name)}`, name, prompt }));
    if (Array.isArray(rows)) rows = rows.filter(p => !isSms(p));
    if (!Array.isArray(rows) || !rows.length || rows.length > 24) throw new Error('SMS를 제외한 플랫폼은 1~24개여야 합니다. platforms 배열 또는 로어북 entries를 확인해 주세요.');
    const ids = new Set();
    return rows.map((p, i) => {
        const id = /^[a-z0-9_-]{1,40}$/i.test(p.id) ? p.id : `platform-${fingerprint(p.name || i)}`;
        if (ids.has(id)) throw new Error('플랫폼 ID가 중복됩니다.');
        ids.add(id);
        const row = { id, name: text(p.name, 80), prompt: text(p.prompt, 20000), sharedPrompt: text(p.sharedPrompt, 12000), style: ['microblog', 'photo', 'forum', 'board', 'live', 'chat', 'video', 'archive', 'shortvideo', 'anon'].includes(p.style) ? p.style : 'board' };
        row.moderation = p.moderation === 'unmoderated' || (p.moderation !== 'normal' && row.style === 'anon') ? 'unmoderated' : 'normal';
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
export function selectedPlatforms(settings) {
    return settings.selectionMode === 'manual' ? settings.platforms.filter(p => settings.selectedPlatforms?.includes(p.id)) : settings.platforms;
}
export function sceneQuestions(platforms, manual = false) {
    const questions = {
        visible: { type: 'noul', instructions: 'scene is the latest roleplay reply; history is background only. There is explicit evidence that other people can know about the current event, such as a public post, broadcast, report, witness, or participant sharing it. A past public event does not make the current private scene public. Celebrity status alone does not expose private events. Do not speculate.' },
    };
    for (const [i, platform] of platforms.entries()) {
        if (!manual) questions[`p${i}`] = { type: 'noul', instructions: `Reactions to the known information in scene would naturally occur on ${platform.name} now. Platform description: ${platform.prompt.slice(0, 300)}` };
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
export const VOICE_DICE = {
    temperament: ['warm enthusiast', 'shy lurker', 'earnest literalist', 'smug know-it-all', 'petty nitpicker', 'deadpan cynic', 'provocative troll', 'lewd crass shitposter', 'mean-spirited gossip', 'contemptuous edgelord'],
    mood: ['delighted', 'curious', 'bored', 'skeptical', 'irritated', 'envious', 'gleefully spiteful', 'obsessively invested'],
    delivery: ['one-line fragment', 'rambling rant', 'pedantic correction', 'ironic aside', 'oversharing anecdote', 'rapid-fire heckling'],
    roughness: ['plain casual speech', 'dry snark', 'blunt personal insults', 'heavy uncensored profanity', 'filthy vulgar innuendo'],
    mannerism: ['no emoji', 'dry punctuation', 'expressive emoji', 'local meme tokens', 'occasional kaomoji', 'chat emotes'],
};
function voiceCast(platform, count, random) {
    // Communities are platforms, not nationalities. Sample authors inside every feed.
    const voices = [
        { region: 'us', culture: 'international', language: 'US English', manner: 'conversational exaggeration; casual fragments; occasional lol or 💀, not Korean board slang' },
        { region: 'europe', culture: 'international', language: 'European English', manner: 'understated sarcasm or a dry aside; varied individual voices, not a national caricature' },
        { region: 'eastasia', culture: 'korean', language: 'Korean', manner: 'native Korean internet rhythm; context-appropriate ㅋㅋ, ㅠㅠ, short endings, or Korean wordplay' },
        { region: 'eastasia', culture: 'international', language: 'Japanese', manner: 'natural Korean translation of a Japanese post; occasional w, 草, or restrained kaomoji when appropriate' },
        { region: 'eastasia', culture: 'international', language: 'Chinese', manner: 'natural Korean translation of a Chinese post; contextual local wordplay or emoji, never a stock catchphrase in every line' },
    ];
    const avatars = ['✦', '🐈', '🪐', '🎧', '❋', '🐸', '🎮', '◈'];
    const weights = platform.id === 'community' ? [0.08, 0.07, 0.65, 0.12, 0.08] : [0.28, 0.22, 0.2, 0.16, 0.14];
    const varied = weights.map(weight => weight * (0.6 + random()));
    const pickWeighted = (values, chances) => {
        let draw = random() * chances.reduce((a, b) => a + b, 0);
        const index = chances.findIndex(weight => (draw -= weight) < 0);
        return values[index < 0 ? values.length - 1 : index];
    };
    const harsh = platform.moderation === 'unmoderated' || ['anon', 'board', 'forum'].includes(platform.style);
    const cast = Array.from({ length: count }, (_, i) => {
        let pick = random() * varied.reduce((a, b) => a + b, 0);
        const index = varied.findIndex(weight => (pick -= weight) < 0);
        const personality = [
            pickWeighted(VOICE_DICE.temperament, harsh ? [1, 1, 1, 2, 3, 3, 4, 4, 3, 4] : [3, 2, 2, 2, 2, 2, 2, 1, 1, 1]),
            ...['mood', 'delivery'].map(axis => VOICE_DICE[axis][Math.floor(random() * VOICE_DICE[axis].length)]),
            pickWeighted(VOICE_DICE.roughness, harsh ? [1, 2, 3, 4, 3] : [4, 3, 2, 2, 1]),
            VOICE_DICE.mannerism[Math.floor(random() * VOICE_DICE.mannerism.length)],
        ].join('; ');
        return { ...voices[index < 0 ? varied.length - 1 : index], personality, avatar: avatars[i % avatars.length] };
    });
    // Avoid a uniform cast without fixed regional quotas or fixed slots.
    if (count >= 4 && new Set(cast.map(v => v.culture)).size === 1) {
        const candidates = voices.filter(v => v.culture !== cast[0].culture);
        Object.assign(cast[Math.floor(random() * count)], candidates[Math.floor(random() * candidates.length)]);
    }
    return cast;
}
export function planFeed(platforms, scores, count = 8, random = Math.random, manual = false) {
    if (!(scores.visible >= 0.65)) return [];
    return platforms.flatMap((platform, i) => {
        if (!manual && !(scores[`p${i}`] >= 0.55)) return [];
        const candidates = Object.keys(GROUPS).filter(g => scores[`p${i}_${g}`] >= 0.55);
        const weights = candidates.map(group => ({ group, weight: scores[`p${i}_${group}`] ** 2 * (0.4 + random()) }));
        if (!weights.length) return [];
        const slots = {};
        for (let n = 0; n < count; n++) {
            let pick = random() * weights.reduce((sum, item) => sum + item.weight, 0);
            const chosen = weights.find(item => (pick -= item.weight) < 0) ?? weights.at(-1);
            slots[chosen.group] = (slots[chosen.group] || 0) + 1;
        }
        return [{ ...platform, moderation: platform.moderation || (platform.style === 'anon' ? 'unmoderated' : 'normal'), slots, voices: voiceCast(platform, count, random) }];
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
            const removed = post.removed === true && plan.moderation !== 'unmoderated';
            const body = removed ? '관리자가 삭제한 댓글입니다.' : text(post.body, 1600);
            if (!body) throw new Error('빈 반응이 반환되었습니다.');
            if (!['us', 'europe', 'eastasia'].includes(post.region)) throw new Error('반응의 커뮤니티 권역이 올바르지 않습니다.');
            if (post.replyTo != null && (!Number.isInteger(post.replyTo) || post.replyTo < 0 || post.replyTo >= index)) throw new Error('답글이 이전 댓글을 올바르게 가리키지 않습니다.');
            return { author: text(post.author, 80) || '익명', avatar: plan.voices?.[index]?.avatar || '◈', group: post.group, region: post.region, removed, replyTo: post.replyTo ?? null, culture: ['korean', 'international'].includes(post.culture) ? post.culture : culture, body, title: text(post.title, 160) };
        });
        if (Object.values(remaining).some(n => n !== 0)) throw new Error('요청한 집단별 반응 수와 결과가 다릅니다. 다시 생성해 주세요.');
        return { id: plan.id, name: plan.name, style: plan.style, culture, posts };
    });
}
