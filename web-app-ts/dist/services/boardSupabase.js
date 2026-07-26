"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseTimelog = parseTimelog;
exports.getCurrentClanBattleYearMonth = getCurrentClanBattleYearMonth;
exports.listCurrentMonthBoardPosts = listCurrentMonthBoardPosts;
exports.getCurrentMonthBoardPostByLegacyId = getCurrentMonthBoardPostByLegacyId;
exports.getAnyBoardPostByLegacyId = getAnyBoardPostByLegacyId;
exports.upsertBoardPost = upsertBoardPost;
exports.deleteBoardPostByLegacyId = deleteBoardPostByLegacyId;
exports.boardRowToArticle = boardRowToArticle;
exports.boardRowToListItem = boardRowToListItem;
exports.normalizeBattleTimeSeconds = normalizeBattleTimeSeconds;
exports.normalizeBattleDateIso = normalizeBattleDateIso;
function getSupabaseConfig() {
    const url = process.env.SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SECRET_KEY;
    if (!url || !secretKey) {
        return null;
    }
    return { url, secretKey };
}
function getSupabaseTableEndpoint(config, table) {
    return `${config.url.replace(/\/$/, '')}/rest/v1/${table}`;
}
async function supabaseRequest(path, init) {
    const config = getSupabaseConfig();
    if (!config) {
        throw new Error('Supabase is not configured');
    }
    const response = await fetch(`${getSupabaseTableEndpoint(config, path)}`, {
        ...init,
        headers: {
            apikey: config.secretKey,
            Authorization: `Bearer ${config.secretKey}`,
            ...(init.headers || {})
        }
    });
    if (!response.ok) {
        const responseText = await response.text();
        throw new Error(`Supabase request failed: ${response.status} ${responseText}`);
    }
    return await response.json();
}
function normalizeYearMonth(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    return /^\d{6}$/.test(text) ? text : '';
}
function parseDamageValue(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.trunc(value);
    }
    if (typeof value === 'string') {
        const normalized = value.replace(/[,_\s]/g, '');
        const match = normalized.match(/(\d+)/);
        if (match) {
            return Number(match[1]);
        }
    }
    return 0;
}
function normalizeDifficultyValue(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        const normalized = Math.trunc(value);
        return normalized >= 1 && normalized <= 5 ? normalized : 3;
    }
    if (typeof value === 'string') {
        const text = value.trim().toLowerCase();
        if (/^[1-5]$/.test(text)) {
            return Number(text);
        }
        const difficultyMap = {
            'full-auto': 1,
            'semi-auto': 2,
            easy: 3,
            normal: 4,
            hard: 5
        };
        if (text in difficultyMap) {
            return difficultyMap[text];
        }
    }
    return 3;
}
function normalizeVisibilityValue(value) {
    const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return text === 'all' || text === 'clan' || text === 'self' ? text : 'self';
}
function normalizeStringValue(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function parseBattleTimeToSeconds(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    const match = text.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
        return 0;
    }
    return (Number(match[1]) * 60) + Number(match[2]);
}
function parseBattleDateToIso(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) {
        return new Date().toISOString();
    }
    const normalized = text.replace(/\//g, '-');
    const isoCandidate = normalized.includes('T') ? normalized : normalized.replace(' ', 'T');
    const parsed = new Date(isoCandidate.length === 16 ? `${isoCandidate}:00` : isoCandidate);
    if (Number.isNaN(parsed.getTime())) {
        return new Date().toISOString();
    }
    return parsed.toISOString();
}
function parseTimelog(text) {
    const lines = text.split(/\r?\n/);
    const result = {
        bossname: '',
        mode: '',
        damage: '',
        battleTime: '',
        battleDate: '',
        party: [],
        ubTimes: []
    };
    let section = '';
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }
        if (line.startsWith('クランモード')) {
            result.mode = line;
            const modeBody = line.replace(/^クランモード\s*/, '').trim();
            const bossMatch = modeBody.match(/^(?:\d+段階目\s+)?(.+)$/);
            result.bossname = bossMatch ? bossMatch[1].trim() : modeBody;
        }
        else if (line.match(/\d+ダメージ/)) {
            result.damage = line;
        }
        else if (line.startsWith('バトル時間')) {
            result.battleTime = line.replace('バトル時間', '').trim();
        }
        else if (line.startsWith('バトル日時')) {
            result.battleDate = line.replace('バトル日時', '').trim();
        }
        else if (line.startsWith('◆パーティ編成')) {
            section = 'party';
        }
        else if (line.startsWith('◆ユニオンバースト発動時間')) {
            section = 'ub';
        }
        else if (line.startsWith('----')) {
            section = '';
        }
        else if (section === 'party') {
            result.party.push(line);
        }
        else if (section === 'ub') {
            result.ubTimes.push(line);
        }
    }
    return result;
}
async function getCurrentClanBattleYearMonth() {
    const rows = await supabaseRequest('setting_clanbattle?select=yearmonth&id=eq.0&limit=1', {
        method: 'GET'
    });
    const yearmonth = rows[0]?.yearmonth;
    const normalized = normalizeYearMonth(yearmonth);
    if (!normalized) {
        throw new Error('Current clan battle yearmonth is not configured');
    }
    return normalized;
}
async function listCurrentMonthBoardPosts() {
    const yearmonth = await getCurrentClanBattleYearMonth();
    return await supabaseRequest(`board_posts?select=*&yearmonth=eq.${encodeURIComponent(yearmonth)}&order=created_at.desc`, {
        method: 'GET'
    });
}
async function getCurrentMonthBoardPostByLegacyId(legacyId) {
    const yearmonth = await getCurrentClanBattleYearMonth();
    const rows = await supabaseRequest(`board_posts?select=*&legacy_id=eq.${encodeURIComponent(legacyId)}&yearmonth=eq.${encodeURIComponent(yearmonth)}&limit=1`, {
        method: 'GET'
    });
    return rows[0] || null;
}
async function getAnyBoardPostByLegacyId(legacyId) {
    const rows = await supabaseRequest(`board_posts?select=*&legacy_id=eq.${encodeURIComponent(legacyId)}&limit=1`, {
        method: 'GET'
    });
    return rows[0] || null;
}
async function upsertBoardPost(input) {
    const config = getSupabaseConfig();
    if (!config) {
        throw new Error('Supabase is not configured');
    }
    const response = await fetch(`${getSupabaseTableEndpoint(config, 'board_posts')}?on_conflict=legacy_id`, {
        method: 'POST',
        headers: {
            apikey: config.secretKey,
            Authorization: `Bearer ${config.secretKey}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=representation'
        },
        body: JSON.stringify({
            legacy_id: input.legacyId,
            yearmonth: input.yearmonth,
            author_id: input.authorId,
            author_name: input.authorName,
            post_title: normalizeStringValue(input.article.postTitle),
            bossname: normalizeStringValue(input.article.bossname),
            mode: normalizeStringValue(input.article.mode),
            damage: parseDamageValue(input.article.damage),
            battle_time_seconds: input.battleTimeSeconds,
            battle_date: input.battleDateIso,
            difficulty: normalizeDifficultyValue(input.article.difficulty),
            visibility: normalizeVisibilityValue(input.article.visibility),
            post_comment: normalizeStringValue(input.article.postComment) || normalizeStringValue(input.article.postcomment),
            party: Array.isArray(input.article.party) ? input.article.party : [],
            ub_rows: Array.isArray(input.article.ubRows) ? input.article.ubRows : Array.isArray(input.article.ubTimeline) ? input.article.ubTimeline : [],
            raw_article: input.article
        })
    });
    if (!response.ok) {
        const responseText = await response.text();
        throw new Error(`Supabase upsert board post failed: ${response.status} ${responseText}`);
    }
    const rows = await response.json();
    const row = rows[0];
    if (!row) {
        throw new Error('Supabase board post upsert returned no rows');
    }
    return row;
}
async function deleteBoardPostByLegacyId(legacyId) {
    const yearmonth = await getCurrentClanBattleYearMonth();
    const config = getSupabaseConfig();
    if (!config) {
        throw new Error('Supabase is not configured');
    }
    const response = await fetch(`${getSupabaseTableEndpoint(config, 'board_posts')}?legacy_id=eq.${encodeURIComponent(legacyId)}&yearmonth=eq.${encodeURIComponent(yearmonth)}`, {
        method: 'DELETE',
        headers: {
            apikey: config.secretKey,
            Authorization: `Bearer ${config.secretKey}`,
            Prefer: 'return=minimal'
        }
    });
    if (!response.ok) {
        const responseText = await response.text();
        throw new Error(`Supabase delete board post failed: ${response.status} ${responseText}`);
    }
}
function boardRowToArticle(row) {
    const rawArticle = row.raw_article && typeof row.raw_article === 'object'
        ? row.raw_article
        : {};
    const battleTime = typeof rawArticle.battleTime === 'string' && rawArticle.battleTime.trim().length > 0
        ? rawArticle.battleTime
        : `${Math.floor(row.battle_time_seconds / 60)}:${String(row.battle_time_seconds % 60).padStart(2, '0')}`;
    return {
        ...rawArticle,
        uniqueId: row.legacy_id || row.id,
        legacyId: row.legacy_id || row.id,
        yearmonth: row.yearmonth,
        bossname: row.bossname,
        mode: row.mode,
        damage: row.damage,
        battleTime,
        battleDate: typeof rawArticle.battleDate === 'string' && rawArticle.battleDate.trim().length > 0
            ? rawArticle.battleDate
            : row.battle_date,
        authorid: typeof rawArticle.authorid === 'string' ? rawArticle.authorid : row.author_id,
        authorname: typeof rawArticle.authorname === 'string' ? rawArticle.authorname : row.author_name,
        authorName: typeof rawArticle.authorName === 'string' ? rawArticle.authorName : row.author_name,
        postTitle: typeof rawArticle.postTitle === 'string' ? rawArticle.postTitle : row.post_title,
        postComment: typeof rawArticle.postComment === 'string' ? rawArticle.postComment : typeof rawArticle.postcomment === 'string' ? rawArticle.postcomment : row.post_comment,
        visibility: typeof rawArticle.visibility === 'string' ? rawArticle.visibility : row.visibility,
        difficulty: typeof rawArticle.difficulty === 'number' ? rawArticle.difficulty : row.difficulty,
        party: Array.isArray(rawArticle.party) ? rawArticle.party : row.party,
        ubRows: Array.isArray(rawArticle.ubRows) ? rawArticle.ubRows : row.ub_rows,
        ubTimeline: Array.isArray(rawArticle.ubTimeline) ? rawArticle.ubTimeline : row.ub_rows,
        battle_time_seconds: row.battle_time_seconds,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}
function boardRowToListItem(row) {
    const article = boardRowToArticle(row);
    return {
        id: row.legacy_id || row.id,
        mode: String(article.mode || row.mode || ''),
        damage: Number(article.damage || row.damage || 0),
        battleTime: String(article.battleTime || ''),
        battleDate: String(article.battleDate || row.battle_date || ''),
        authorName: String(article.authorname || article.authorName || row.author_name || ''),
        title: String(article.postTitle || row.post_title || article.mode || '無題')
    };
}
function normalizeBattleTimeSeconds(value) {
    return parseBattleTimeToSeconds(value);
}
function normalizeBattleDateIso(value) {
    return parseBattleDateToIso(value);
}
//# sourceMappingURL=boardSupabase.js.map