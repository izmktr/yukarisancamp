"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshBoardCharaImageCache = refreshBoardCharaImageCache;
const express_1 = require("express");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const boardSupabase_1 = require("../services/boardSupabase");
const router = (0, express_1.Router)();
const CHARA_INDEX_PATH = path_1.default.join(__dirname, '../../chara/charaindex.json');
function isTimelinePartyMember(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const member = value;
    return typeof member.name === 'string'
        && Number.isInteger(member.star)
        && Number.isInteger(member.level)
        && Number.isInteger(member.rank);
}
function isTimelineUbEvent(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const event = value;
    return typeof event.time === 'string' && typeof event.character === 'string';
}
function isTimelineInfo(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const article = value;
    return typeof article.uniqueId === 'string'
        && /^\d{6}$/.test(article.yearmonth)
        && typeof article.bossname === 'string'
        && typeof article.mode === 'string'
        && Number.isInteger(article.damage)
        && /^\d{2}:\d{2}$/.test(article.battleTime)
        && /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/.test(article.battleDate)
        && (typeof article.authorid === 'undefined' || typeof article.authorid === 'string')
        && (typeof article.authorname === 'undefined' || typeof article.authorname === 'string')
        && (typeof article.authorName === 'undefined' || typeof article.authorName === 'string')
        && Array.isArray(article.party) && article.party.every(isTimelinePartyMember)
        && Array.isArray(article.ubTimeline) && article.ubTimeline.every(isTimelineUbEvent);
}
function resolveArticleAuthorId(article) {
    if (!article || typeof article !== 'object') {
        return '';
    }
    const candidateValues = [article.author_id, article.authorid, article.authorId, article.googleUserId];
    const resolved = candidateValues.find((value) => typeof value === 'string' && value.trim().length > 0);
    return typeof resolved === 'string' ? resolved.trim() : '';
}
function resolveArticleAuthorName(article) {
    if (!article || typeof article !== 'object') {
        return '';
    }
    const candidateValues = [article.author_name, article.authorname, article.authorName, article.displayName, article.userName];
    const resolved = candidateValues.find((value) => typeof value === 'string' && value.trim().length > 0);
    return typeof resolved === 'string' ? resolved.trim() : '';
}
function canEditArticle(article, userSession) {
    const currentGoogleUserId = typeof userSession?.googleUserId === 'string' ? userSession.googleUserId : '';
    const authorId = resolveArticleAuthorId(article);
    return currentGoogleUserId.length > 0 && authorId.length > 0 && currentGoogleUserId === authorId;
}
function ensureArticleEditableByUser(article, req, res) {
    const userSession = req.session.user;
    if (!userSession) {
        res.status(403).send('Googleでログイン後に編集可能になります');
        return false;
    }
    if (!canEditArticle(article, userSession)) {
        res.status(403).send('投稿者のみ編集可能です');
        return false;
    }
    return true;
}
function loadCharaIndex() {
    try {
        const raw = fs_1.default.readFileSync(CHARA_INDEX_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.filter((entry) => {
            return entry
                && typeof entry === 'object'
                && typeof entry.fileName === 'string'
                && typeof entry.name === 'string';
        });
    }
    catch (error) {
        console.error('Failed to load chara index:', error);
        return [];
    }
}
let charaIndex = [];
let charaImageByName = new Map();
let charaImageByNormalizedName = new Map();
function rebuildCharaImageCache() {
    const loaded = loadCharaIndex();
    charaIndex = loaded;
    charaImageByName = new Map(loaded.map((entry) => [entry.name, entry.fileName]));
    charaImageByNormalizedName = new Map(loaded.map((entry) => [normalizeCharacterLookupKey(entry.name), entry.fileName]));
    return loaded.length;
}
function refreshBoardCharaImageCache() {
    return rebuildCharaImageCache();
}
rebuildCharaImageCache();
function normalizeCharacterLookupKey(name) {
    return (name || '')
        .toLowerCase()
        .replace(/[\s　・･]/g, '')
        .trim();
}
function normalizeCharacterName(name) {
    return name.trim();
}
function splitCharacterName(name) {
    const trimmed = normalizeCharacterName(name);
    const match = trimmed.match(/^(.*?)(?:（(.+)）)?$/);
    if (!match) {
        return { base: trimmed, suffix: null };
    }
    return {
        base: match[1].trim(),
        suffix: match[2] ? match[2].trim() : null
    };
}
function resolveCharacterImagePath(name) {
    const normalizedName = normalizeCharacterName(name);
    const exact = charaImageByName.get(normalizedName)
        || charaImageByName.get(name);
    if (exact) {
        return `/chara-images/${exact}`;
    }
    const normalizedKey = normalizeCharacterLookupKey(normalizedName);
    const normalizedMatch = charaImageByNormalizedName.get(normalizedKey);
    if (normalizedMatch) {
        return `/chara-images/${normalizedMatch}`;
    }
    const target = splitCharacterName(normalizedName);
    const fallback = charaIndex.find((entry) => {
        const candidate = splitCharacterName(entry.name);
        if (candidate.suffix !== target.suffix) {
            return false;
        }
        return candidate.base.includes(target.base) || target.base.includes(candidate.base);
    });
    return fallback ? `/chara-images/${fallback.fileName}` : null;
}
function parseLegacyPartyMember(value) {
    const match = value.match(/^(.*?)\s+★(\d+)\s+Lv(\d+)\s+RANK(\d+)$/i);
    if (!match) {
        return {
            name: value,
            star: null,
            level: null,
            rank: null,
            imagePath: resolveCharacterImagePath(value)
        };
    }
    const name = match[1].trim();
    return {
        name: normalizeCharacterName(name),
        star: Number(match[2]),
        level: Number(match[3]),
        rank: Number(match[4]),
        imagePath: resolveCharacterImagePath(name)
    };
}
function resolveBoardDetailPartyMembers(party) {
    if (!Array.isArray(party)) {
        return [];
    }
    return party.flatMap((member) => {
        if (isTimelinePartyMember(member)) {
            return [{
                    name: normalizeCharacterName(member.name),
                    star: member.star,
                    level: member.level,
                    rank: member.rank,
                    imagePath: resolveCharacterImagePath(member.name)
                }];
        }
        if (typeof member === 'string' && member.trim().length > 0) {
            return [parseLegacyPartyMember(member.trim())];
        }
        return [];
    });
}
function resolveBoardDetailUbRows(article) {
    const rows = [];
    if (Array.isArray(article?.ubTimeline)) {
        for (const ub of article.ubTimeline) {
            if (!ub || typeof ub !== 'object') {
                continue;
            }
            const event = ub;
            const time = typeof event.time === 'string' ? event.time : '';
            const ubText = typeof event.character === 'string' ? event.character.trim() : '';
            if (!time && !ubText) {
                continue;
            }
            const ubImagePath = ubText ? resolveCharacterImagePath(ubText) : null;
            const activeIcons = Array.isArray(event.activeIcons)
                ? event.activeIcons.filter((value) => Number.isInteger(value) && value >= 0 && value <= 4)
                : [];
            const autoActive = typeof event.autoActive === 'boolean' ? event.autoActive : false;
            const comment = typeof event.comment === 'string' ? event.comment : '';
            const isAddedRow = typeof event.isAddedRow === 'boolean' ? event.isAddedRow : false;
            const timing = typeof event.timing === 'boolean' ? event.timing : false;
            rows.push({
                time,
                ubText,
                ubImagePath,
                activeIcons,
                autoActive,
                comment,
                isAddedRow,
                timing
            });
        }
        return rows;
    }
    if (Array.isArray(article?.ubTimes)) {
        for (const line of article.ubTimes) {
            if (typeof line !== 'string') {
                continue;
            }
            const trimmed = line.trim();
            if (!trimmed) {
                continue;
            }
            const match = trimmed.match(/^([0-9]{1,2}:[0-9]{2})\s+(.+)$/);
            const time = match ? match[1] : '';
            const ubText = match ? match[2].trim() : trimmed;
            const ubImagePath = ubText ? resolveCharacterImagePath(ubText) : null;
            rows.push({
                time,
                ubText,
                ubImagePath,
                activeIcons: [],
                autoActive: false,
                comment: '',
                isAddedRow: false,
                timing: false
            });
        }
    }
    return rows;
}
function parseTimelog(text) {
    const lines = text.split(/\r?\n/);
    const result = {
        bossname: '', mode: '', damage: '', battleTime: '', battleDate: '', party: [], ubTimes: []
    };
    let section = '';
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line)
            continue;
        if (line.startsWith('クランモード')) {
            result.mode = line;
            const modeBody = line.replace(/^クランモード\s*/, '').trim();
            const bossMatch = modeBody.match(/^(?:\d+段階目\s+)?(.+)$/);
            result.bossname = bossMatch ? bossMatch[1].trim() : modeBody;
        }
        else if (line.match(/\d+ダメージ/))
            result.damage = line;
        else if (line.startsWith('バトル時間'))
            result.battleTime = line.replace('バトル時間', '').trim();
        else if (line.startsWith('バトル日時'))
            result.battleDate = line.replace('バトル日時', '').trim();
        else if (line.startsWith('◆パーティ編成'))
            section = 'party';
        else if (line.startsWith('◆ユニオンバースト発動時間'))
            section = 'ub';
        else if (line.startsWith('----'))
            section = '';
        else if (section === 'party')
            result.party.push(line);
        else if (section === 'ub')
            result.ubTimes.push(line);
    }
    return result;
}
function getAuthViewData(req) {
    const userSession = req.session.user;
    return {
        isLoggedIn: !!userSession,
        userName: userSession?.displayName || '',
        isAdmin: userSession?.role === 'admin'
    };
}
// 記事一覧
router.get('/', async (req, res) => {
    try {
        const auth = getAuthViewData(req);
        const userSession = req.session.user;
        const currentGoogleUserId = typeof userSession?.googleUserId === 'string' ? userSession.googleUserId : '';
        const rows = await (0, boardSupabase_1.listCurrentMonthBoardPosts)();
        const visibilityLabelByValue = {
            all: '全体',
            clan: 'クラン',
            self: '自分'
        };
        const difficultyLabelByValue = {
            '1': 'フルオート',
            '2': 'セミオート',
            '3': '簡単',
            '4': '普通',
            '5': '高難度'
        };
        const modeLabelByValue = {
            full: 'フル',
            agro: '持ち越し',
            rank2: '2段階目',
            rank3: '3段階目'
        };
        const articles = rows.flatMap((row) => {
            const article = (0, boardSupabase_1.boardRowToArticle)(row);
            const visibilityRaw = String(article.visibility || '').toLowerCase().trim();
            const difficultyRaw = String(article.difficulty ?? '').trim();
            const modeRaw = String(article.mode || '').toLowerCase().trim();
            const authorId = resolveArticleAuthorId(article);
            const isVisibleToCurrentUser = visibilityRaw === 'all'
                || (visibilityRaw === 'self' && authorId.length > 0 && authorId === currentGoogleUserId);
            if (!isVisibleToCurrentUser) {
                return [];
            }
            const partyMembers = resolveBoardDetailPartyMembers(article.party).slice().reverse();
            return [{
                    id: String(article.uniqueId || article.legacyId || row.legacy_id || row.id),
                    title: typeof article.postTitle === 'string' && article.postTitle.trim().length > 0
                        ? article.postTitle.trim()
                        : (typeof article.mode === 'string' && article.mode.trim().length > 0 ? article.mode.trim() : '無題'),
                    authorName: resolveArticleAuthorName(article) || '未設定',
                    difficultyValue: difficultyRaw,
                    difficultyLabel: difficultyLabelByValue[difficultyRaw] || '-',
                    modeValue: modeRaw,
                    modeLabel: modeLabelByValue[modeRaw] || (typeof article.mode === 'string' ? article.mode : '-'),
                    visibilityValue: visibilityRaw,
                    visibilityLabel: visibilityLabelByValue[visibilityRaw] || visibilityRaw || '-',
                    partyMembers: partyMembers.slice(0, 5).map((member) => ({
                        name: member.name,
                        imagePath: member.imagePath
                    }))
                }];
        });
        res.render('board', {
            title: 'ゆかりさん△',
            currentPage: 'board',
            ...auth,
            articles
        });
    }
    catch (error) {
        console.error('Failed to load board list from Supabase:', error);
        res.status(503).send('掲示板の読み込みに失敗しました');
    }
});
// 新規投稿画面（競合回避のため /:id より前に記述）
router.get('/post', (req, res) => {
    const auth = getAuthViewData(req);
    res.render('board-post', {
        title: 'ゆかりさん△',
        currentPage: 'board',
        ...auth
    });
});
// 個別記事
router.get('/:id', async (req, res) => {
    try {
        const auth = getAuthViewData(req);
        const row = await (0, boardSupabase_1.getCurrentMonthBoardPostByLegacyId)(req.params.id);
        if (!row) {
            return res.status(404).send('記事がありません');
        }
        const data = (0, boardSupabase_1.boardRowToArticle)(row);
        const partyMembers = resolveBoardDetailPartyMembers(data.party);
        const ubRows = resolveBoardDetailUbRows(data);
        const currentUserSession = req.session.user;
        const canEdit = canEditArticle(data, currentUserSession);
        const showOwnerOnlyMessage = !!currentUserSession && !canEdit;
        res.render('board-detail', {
            title: 'ゆかりさん△',
            currentPage: 'board',
            ...auth,
            article: data,
            partyMembers,
            ubRows,
            id: row.legacy_id || row.id,
            canEdit,
            showOwnerOnlyMessage
        });
    }
    catch (error) {
        console.error('Failed to load board detail from Supabase:', error);
        res.status(503).send('掲示板の読み込みに失敗しました');
    }
});
// 投稿処理（timelogテキスト→編集画面）
router.post('/edit', (req, res) => {
    const auth = getAuthViewData(req);
    const timelineInfoRaw = req.body.timelineInfo;
    if (typeof timelineInfoRaw === 'string' && timelineInfoRaw.trim().length > 0) {
        try {
            const parsedTimelineInfo = JSON.parse(timelineInfoRaw);
            if (!isTimelineInfo(parsedTimelineInfo)) {
                return res.status(400).send('timelineInfo の形式が不正です');
            }
            req.session.editingArticle = parsedTimelineInfo;
            const partyMembers = resolveBoardDetailPartyMembers(parsedTimelineInfo.party);
            const ubRows = resolveBoardDetailUbRows(parsedTimelineInfo);
            return res.render('board-edit', {
                title: 'ゆかりさん△',
                currentPage: 'board',
                ...auth,
                article: parsedTimelineInfo,
                partyMembers,
                ubRows,
                timelog: req.body.timelog || '',
                isNew: true
            });
        }
        catch {
            return res.status(400).send('timelineInfo の読み込みに失敗しました');
        }
    }
    const rawText = typeof req.body.timelog === 'string' ? req.body.timelog : '';
    const parsed = parseTimelog(rawText);
    req.session.editingArticle = parsed;
    const partyMembers = resolveBoardDetailPartyMembers(parsed.party);
    const ubRows = resolveBoardDetailUbRows(parsed);
    return res.render('board-edit', {
        title: 'ゆかりさん△',
        currentPage: 'board',
        ...auth,
        article: parsed,
        partyMembers,
        ubRows,
        timelog: rawText,
        isNew: true
    });
});
// 編集画面（既存記事）
router.get('/:id/edit', async (req, res) => {
    try {
        const auth = getAuthViewData(req);
        const row = await (0, boardSupabase_1.getCurrentMonthBoardPostByLegacyId)(req.params.id);
        if (!row) {
            return res.status(404).send('記事がありません');
        }
        const data = (0, boardSupabase_1.boardRowToArticle)(row);
        if (!ensureArticleEditableByUser(data, req, res)) {
            return;
        }
        const partyMembers = resolveBoardDetailPartyMembers(data.party);
        const ubRows = resolveBoardDetailUbRows(data);
        res.render('board-edit', {
            title: 'ゆかりさん△',
            currentPage: 'board',
            ...auth,
            article: data,
            partyMembers,
            ubRows,
            id: row.legacy_id || row.id,
            isNew: false
        });
    }
    catch (error) {
        console.error('Failed to load board edit page from Supabase:', error);
        res.status(503).send('掲示板の読み込みに失敗しました');
    }
});
// 記事削除
router.post('/:id/delete', async (req, res) => {
    try {
        const row = await (0, boardSupabase_1.getCurrentMonthBoardPostByLegacyId)(req.params.id);
        if (!row) {
            return res.status(404).send('記事がありません');
        }
        const data = (0, boardSupabase_1.boardRowToArticle)(row);
        if (!ensureArticleEditableByUser(data, req, res)) {
            return;
        }
        await (0, boardSupabase_1.deleteBoardPostByLegacyId)(req.params.id);
        return res.redirect('/board');
    }
    catch (error) {
        console.error('Failed to delete board post from Supabase:', error);
        res.status(503).send('掲示板の削除に失敗しました');
    }
});
// 編集保存（新規・既存）
router.post('/save', async (req, res) => {
    try {
        const nowId = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
        const timelineInfoRaw = req.body.timelineInfo;
        const userSession = req.session.user;
        if (!userSession) {
            return res.status(403).send('Googleでログイン後に編集可能になります');
        }
        const sessionGoogleUserId = typeof userSession?.googleUserId === 'string' ? userSession.googleUserId : '';
        const sessionAuthorName = typeof userSession?.displayName === 'string' ? userSession.displayName : '';
        const yearmonth = await (0, boardSupabase_1.getCurrentClanBattleYearMonth)();
        let legacyId = String(req.body.id || nowId);
        let article;
        if (typeof timelineInfoRaw === 'string' && timelineInfoRaw.trim().length > 0) {
            const parsedTimelineInfo = JSON.parse(timelineInfoRaw);
            if (!isTimelineInfo(parsedTimelineInfo)) {
                return res.status(400).send('timelineInfo の形式が不正です');
            }
            legacyId = parsedTimelineInfo.uniqueId || legacyId;
            const existingRow = await (0, boardSupabase_1.getCurrentMonthBoardPostByLegacyId)(legacyId);
            if (existingRow) {
                const existingArticle = (0, boardSupabase_1.boardRowToArticle)(existingRow);
                if (!canEditArticle(existingArticle, userSession)) {
                    return res.status(403).send('投稿者のみ編集可能です');
                }
            }
            article = {
                ...parsedTimelineInfo,
                authorid: typeof parsedTimelineInfo.authorid === 'string' && parsedTimelineInfo.authorid.trim().length > 0
                    ? parsedTimelineInfo.authorid
                    : sessionGoogleUserId,
                authorname: resolveArticleAuthorName(parsedTimelineInfo) || sessionAuthorName,
                authorName: typeof parsedTimelineInfo.authorName === 'string' && parsedTimelineInfo.authorName.trim().length > 0
                    ? parsedTimelineInfo.authorName
                    : sessionAuthorName,
                uniqueId: legacyId,
                yearmonth
            };
        }
        else {
            article = {
                bossname: req.body.bossname || '',
                mode: req.body.mode || '',
                damage: req.body.damage || '',
                battleTime: req.body.battleTime || '',
                battleDate: req.body.battleDate || '',
                authorid: sessionGoogleUserId,
                authorname: sessionAuthorName,
                authorName: sessionAuthorName,
                party: [],
                ubTimes: []
            };
            if (typeof req.body.party === 'string') {
                article.party = req.body.party.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0);
            }
            if (typeof req.body.ubTimes === 'string') {
                article.ubTimes = req.body.ubTimes.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0);
            }
            if ((!article.mode && !article.damage) && typeof req.body.timelog === 'string') {
                const parsed = parseTimelog(req.body.timelog);
                article.bossname = parsed.bossname;
                article.mode = parsed.mode;
                article.damage = parsed.damage;
                article.battleTime = parsed.battleTime;
                article.battleDate = parsed.battleDate;
                article.party = parsed.party;
                article.ubTimes = parsed.ubTimes;
            }
            const existingRow = await (0, boardSupabase_1.getCurrentMonthBoardPostByLegacyId)(legacyId);
            if (existingRow) {
                const existingArticle = (0, boardSupabase_1.boardRowToArticle)(existingRow);
                if (!canEditArticle(existingArticle, userSession)) {
                    return res.status(403).send('投稿者のみ編集可能です');
                }
            }
        }
        const savedRow = await (0, boardSupabase_1.upsertBoardPost)({
            legacyId,
            yearmonth,
            article,
            battleTimeSeconds: (0, boardSupabase_1.normalizeBattleTimeSeconds)(article.battleTime),
            battleDateIso: (0, boardSupabase_1.normalizeBattleDateIso)(article.battleDate),
            authorId: sessionGoogleUserId,
            authorName: sessionAuthorName
        });
        return res.redirect('/board/' + (savedRow.legacy_id || legacyId));
    }
    catch (error) {
        console.error('Failed to save board post to Supabase:', error);
        return res.status(503).send('掲示板の保存に失敗しました');
    }
});
exports.default = router;
//# sourceMappingURL=board.js.map