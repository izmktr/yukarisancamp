import { canEditArticle, canViewArticle } from '../utils/boardAccess';
import { Request, Response, Router } from 'express';
import {
  boardRowToArticle,
  boardRowToListItem,
  getCurrentClanBattleYearMonth,
  getAnyBoardPostByLegacyId,
  getCurrentMonthBoardPostByLegacyId,
  listCurrentMonthBoardPosts,
  normalizeBattleDateIso,
  normalizeBattleTimeSeconds,
  parseTimelog,
  upsertBoardPost
} from '../services/boardSupabase';

const router = Router();

function getSessionUser(req: Request): { googleUserId: string; displayName: string; discordServer: string } {
  const userSession = req.session?.user as { googleUserId?: string; displayName?: string; discordServer?: string } | undefined;
  return {
    googleUserId: typeof userSession?.googleUserId === 'string' ? userSession.googleUserId : '',
    displayName: typeof userSession?.displayName === 'string' ? userSession.displayName : '',
    discordServer: typeof userSession?.discordServer === 'string' ? userSession.discordServer.trim() : ''
  };
}

function applyAuthorDiscordServer(article: Record<string, unknown>, sessionDiscordServer: string): Record<string, unknown> {
  const currentSetting = article.setting && typeof article.setting === 'object' && !Array.isArray(article.setting)
    ? article.setting as Record<string, unknown>
    : {};

  return {
    ...article,
    authorclanid: sessionDiscordServer,
    setting: {
      ...currentSetting,
      discord_server: sessionDiscordServer
    }
  };
}

// 記事一覧取得
router.get('/', async (req: Request, res: Response) => {
  try {
    const rows = await listCurrentMonthBoardPosts();
    res.json(rows.filter((row) => canViewArticle(boardRowToArticle(row), getSessionUser(req)))
      .map((row) => boardRowToListItem(row)));
  } catch (error) {
    console.error('Failed to load board list from Supabase:', error);
    res.status(503).json({ error: '掲示板の読み込みに失敗しました' });
  }
});

// 個別記事取得
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const row = await getCurrentMonthBoardPostByLegacyId(req.params.id);
    if (!row || !canViewArticle(boardRowToArticle(row), getSessionUser(req))) {
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
    const sessionUser = getSessionUser(req);
    if (!sessionUser.googleUserId.trim()) {
      return res.status(401).json({ error: 'ログインが必要です' });
    }
    const { timelog } = req.body;
    const rawTimelog = typeof timelog === 'string' ? timelog : '';
    if (!rawTimelog.trim()) {
      return res.status(400).json({ error: 'timelog が必要です' });
    }

    const parsed = parseTimelog(rawTimelog);
    const yearmonth = await getCurrentClanBattleYearMonth();
    const legacyId = String(req.body.id || Date.now().toString());
    const existingRow = await getAnyBoardPostByLegacyId(legacyId);
    if (existingRow && !canEditArticle(existingRow, sessionUser)) {
      return res.status(403).json({ error: '投稿者のみ編集可能です' });
    }

    const savedRow = await upsertBoardPost({
      legacyId,
      yearmonth,
      article: applyAuthorDiscordServer({
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
      }, sessionUser.discordServer),
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
    const sessionUser = getSessionUser(req);
    if (!sessionUser.googleUserId.trim()) {
      return res.status(401).json({ error: 'ログインが必要です' });
    }
    const articleBody = typeof req.body.article === 'string'
      ? JSON.parse(req.body.article)
      : req.body.article;

    if (!articleBody || typeof articleBody !== 'object' || Array.isArray(articleBody)) {
      return res.status(400).json({ error: 'article が必要です' });
    }

    const yearmonth = await getCurrentClanBattleYearMonth();
    const legacyId = String(req.params.id || articleBody.uniqueId || articleBody.legacyId || Date.now().toString());
    const existingRow = await getCurrentMonthBoardPostByLegacyId(legacyId);
    if (!existingRow) {
      return res.status(404).json({ error: '記事がありません' });
    }
    if (!canEditArticle(existingRow, sessionUser)) {
      return res.status(403).json({ error: '投稿者のみ編集可能です' });
    }
    const article = articleBody as Record<string, unknown>;
    const visibility = typeof article.visibility === 'string' ? article.visibility.trim().toLowerCase() : existingRow.visibility;
    article.visibility = visibility === 'all' || (visibility === 'clan' && sessionUser.discordServer) ? visibility : 'self';

    const savedRow = await upsertBoardPost({
      legacyId,
      yearmonth,
      article: applyAuthorDiscordServer({
        ...article,
        uniqueId: legacyId,
        yearmonth,
        authorid: sessionUser.googleUserId,
        authorname: sessionUser.displayName,
        authorName: sessionUser.displayName
      }, sessionUser.discordServer),
      battleTimeSeconds: normalizeBattleTimeSeconds(article.battleTime),
      battleDateIso: normalizeBattleDateIso(article.battleDate),
      authorId: sessionUser.googleUserId,
      authorName: sessionUser.displayName
    });

    res.json({ ok: true, id: savedRow.legacy_id || legacyId });
  } catch (error) {
    console.error('Failed to update board post in Supabase:', error);
    res.status(503).json({ error: '保存に失敗しました' });
  }
});

export default router;
