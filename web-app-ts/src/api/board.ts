import { Request, Response, Router } from 'express';
import {
  boardRowToArticle,
  boardRowToListItem,
  getCurrentClanBattleYearMonth,
  getCurrentMonthBoardPostByLegacyId,
  listCurrentMonthBoardPosts,
  normalizeBattleDateIso,
  normalizeBattleTimeSeconds,
  parseTimelog,
  upsertBoardPost
} from '../services/boardSupabase';

const router = Router();

function getSessionUser(req: Request): { googleUserId: string; displayName: string } {
  const userSession = req.session?.user as { googleUserId?: string; displayName?: string } | undefined;
  return {
    googleUserId: typeof userSession?.googleUserId === 'string' ? userSession.googleUserId : '',
    displayName: typeof userSession?.displayName === 'string' ? userSession.displayName : ''
  };
}

// 記事一覧取得
router.get('/', async (_req: Request, res: Response) => {
  try {
    const rows = await listCurrentMonthBoardPosts();
    res.json(rows.map((row) => boardRowToListItem(row)));
  } catch (error) {
    console.error('Failed to load board list from Supabase:', error);
    res.status(503).json({ error: '掲示板の読み込みに失敗しました' });
  }
});

// 個別記事取得
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const row = await getCurrentMonthBoardPostByLegacyId(req.params.id);
    if (!row) {
      return res.status(404).json({ error: '記事がありません' });
    }

    res.json(boardRowToArticle(row));
  } catch (error) {
    console.error('Failed to load board detail from Supabase:', error);
    res.status(503).json({ error: '掲示板の読み込みに失敗しました' });
  }
});

// 投稿（timelogテキスト→json保存）
router.post('/post', async (req: Request, res: Response) => {
  try {
    const { timelog } = req.body;
    const rawTimelog = typeof timelog === 'string' ? timelog : '';
    if (!rawTimelog.trim()) {
      return res.status(400).json({ error: 'timelog が必要です' });
    }

    const parsed = parseTimelog(rawTimelog);
    const sessionUser = getSessionUser(req);
    const yearmonth = await getCurrentClanBattleYearMonth();
    const legacyId = String(req.body.id || Date.now().toString());

    const savedRow = await upsertBoardPost({
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
      battleTimeSeconds: normalizeBattleTimeSeconds(parsed.battleTime),
      battleDateIso: normalizeBattleDateIso(parsed.battleDate),
      authorId: sessionUser.googleUserId,
      authorName: sessionUser.displayName
    });

    res.json({ id: savedRow.legacy_id || legacyId });
  } catch (error) {
    console.error('Failed to create board post in Supabase:', error);
    res.status(503).json({ error: '投稿に失敗しました' });
  }
});

// 編集保存
router.post('/:id/edit', async (req: Request, res: Response) => {
  try {
    const articleBody = typeof req.body.article === 'string'
      ? JSON.parse(req.body.article)
      : req.body.article;

    if (!articleBody || typeof articleBody !== 'object') {
      return res.status(400).json({ error: 'article が必要です' });
    }

    const yearmonth = await getCurrentClanBattleYearMonth();
    const legacyId = String(req.params.id || articleBody.uniqueId || articleBody.legacyId || Date.now().toString());
    const sessionUser = getSessionUser(req);
    const article = articleBody as Record<string, unknown>;

    const savedRow = await upsertBoardPost({
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
      battleTimeSeconds: normalizeBattleTimeSeconds(article.battleTime),
      battleDateIso: normalizeBattleDateIso(article.battleDate),
      authorId: typeof article.authorid === 'string' && article.authorid.trim().length > 0 ? article.authorid : sessionUser.googleUserId,
      authorName: typeof article.authorname === 'string' && article.authorname.trim().length > 0 ? article.authorname : sessionUser.displayName
    });

    res.json({ ok: true, id: savedRow.legacy_id || legacyId });
  } catch (error) {
    console.error('Failed to update board post in Supabase:', error);
    res.status(503).json({ error: '保存に失敗しました' });
  }
});

export default router;
