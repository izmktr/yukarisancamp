"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const boardSupabase_1 = require("../services/boardSupabase");
const router = (0, express_1.Router)();
function getSessionUser(req) {
    const userSession = req.session?.user;
    return {
        googleUserId: typeof userSession?.googleUserId === 'string' ? userSession.googleUserId : '',
        displayName: typeof userSession?.displayName === 'string' ? userSession.displayName : ''
    };
}
// 記事一覧取得
router.get('/', async (_req, res) => {
    try {
        const rows = await (0, boardSupabase_1.listCurrentMonthBoardPosts)();
        res.json(rows.map((row) => (0, boardSupabase_1.boardRowToListItem)(row)));
    }
    catch (error) {
        console.error('Failed to load board list from Supabase:', error);
        res.status(503).json({ error: '掲示板の読み込みに失敗しました' });
    }
});
// 個別記事取得
router.get('/:id', async (req, res) => {
    try {
        const row = await (0, boardSupabase_1.getCurrentMonthBoardPostByLegacyId)(req.params.id);
        if (!row) {
            return res.status(404).json({ error: '記事がありません' });
        }
        res.json((0, boardSupabase_1.boardRowToArticle)(row));
    }
    catch (error) {
        console.error('Failed to load board detail from Supabase:', error);
        res.status(503).json({ error: '掲示板の読み込みに失敗しました' });
    }
});
// 投稿（timelogテキスト→json保存）
router.post('/post', async (req, res) => {
    try {
        const { timelog } = req.body;
        const rawTimelog = typeof timelog === 'string' ? timelog : '';
        if (!rawTimelog.trim()) {
            return res.status(400).json({ error: 'timelog が必要です' });
        }
        const parsed = (0, boardSupabase_1.parseTimelog)(rawTimelog);
        const sessionUser = getSessionUser(req);
        const yearmonth = await (0, boardSupabase_1.getCurrentClanBattleYearMonth)();
        const legacyId = String(req.body.id || Date.now().toString());
        const savedRow = await (0, boardSupabase_1.upsertBoardPost)({
            legacyId,
            yearmonth,
            article: {
                uniqueId: legacyId,
                yearmonth,
                bossname: parsed.bossname,
                mode: parsed.mode,
                damage: parsed.damage,
                battleTime: parsed.battleTime,
                battleDate: parsed.battleDate,
                authorid: sessionUser.googleUserId,
                authorname: sessionUser.displayName,
                authorName: sessionUser.displayName,
                postTitle: parsed.bossname,
                visibility: 'self',
                difficulty: 3,
                postComment: '',
                party: parsed.party,
                ubTimes: parsed.ubTimes
            },
            battleTimeSeconds: (0, boardSupabase_1.normalizeBattleTimeSeconds)(parsed.battleTime),
            battleDateIso: (0, boardSupabase_1.normalizeBattleDateIso)(parsed.battleDate),
            authorId: sessionUser.googleUserId,
            authorName: sessionUser.displayName
        });
        res.json({ id: savedRow.legacy_id || legacyId });
    }
    catch (error) {
        console.error('Failed to create board post in Supabase:', error);
        res.status(503).json({ error: '投稿に失敗しました' });
    }
});
// 編集保存
router.post('/:id/edit', async (req, res) => {
    try {
        const articleBody = typeof req.body.article === 'string'
            ? JSON.parse(req.body.article)
            : req.body.article;
        if (!articleBody || typeof articleBody !== 'object') {
            return res.status(400).json({ error: 'article が必要です' });
        }
        const yearmonth = await (0, boardSupabase_1.getCurrentClanBattleYearMonth)();
        const legacyId = String(req.params.id || articleBody.uniqueId || articleBody.legacyId || Date.now().toString());
        const sessionUser = getSessionUser(req);
        const article = articleBody;
        const savedRow = await (0, boardSupabase_1.upsertBoardPost)({
            legacyId,
            yearmonth,
            article: {
                ...article,
                uniqueId: legacyId,
                yearmonth,
                authorid: typeof article.authorid === 'string' ? article.authorid : sessionUser.googleUserId,
                authorname: typeof article.authorname === 'string' ? article.authorname : sessionUser.displayName,
                authorName: typeof article.authorName === 'string' ? article.authorName : sessionUser.displayName
            },
            battleTimeSeconds: (0, boardSupabase_1.normalizeBattleTimeSeconds)(article.battleTime),
            battleDateIso: (0, boardSupabase_1.normalizeBattleDateIso)(article.battleDate),
            authorId: typeof article.authorid === 'string' && article.authorid.trim().length > 0 ? article.authorid : sessionUser.googleUserId,
            authorName: typeof article.authorname === 'string' && article.authorname.trim().length > 0 ? article.authorname : sessionUser.displayName
        });
        res.json({ ok: true, id: savedRow.legacy_id || legacyId });
    }
    catch (error) {
        console.error('Failed to update board post in Supabase:', error);
        res.status(503).json({ error: '保存に失敗しました' });
    }
});
exports.default = router;
//# sourceMappingURL=board.js.map