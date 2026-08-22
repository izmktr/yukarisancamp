import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import {
  boardRowToArticle,
  deleteBoardPostByLegacyId,
  getCurrentClanBattleYearMonth,
  getCurrentMonthBoardPostByLegacyId,
  listCurrentMonthBoardPosts,
  normalizeBattleDateIso,
  normalizeBattleTimeSeconds,
  upsertBoardPost
} from '../services/boardSupabase';

// Session型拡張（TypeScriptエラー回避）
declare module 'express-session' {
  interface SessionData {
    editingArticle?: any;
  }
}

const router = Router();
const CHARA_INDEX_PATH = path.join(__dirname, '../../chara/charaindex.json');

type ParsedArticle = {
  bossname: string;
  mode: string;
  damage: string;
  battleTime: string;
  battleDate: string;
  authorid?: string;
  authorname?: string;
  authorName?: string;
  party: string[];
  ubTimes: string[];
};

type TimelinePartyMember = {
  name: string;
  star: number;
  level: number;
  rank: number;
};

type CharaIndexEntry = {
  fileName: string;
  name: string;
};

type BoardDetailPartyMember = {
  name: string;
  star: number | null;
  level: number | null;
  rank: number | null;
  imagePath: string | null;
};

type BoardDetailUbRow = {
  time: string;
  ubText: string;
  ubImagePath: string | null;
  activeIcons: number[];
  autoActive: boolean;
  comment: string;
  isAddedRow: boolean;
  timing: boolean;
};

type BoardDiffTimelineEntry = {
  time: string;
  character: string;
  imagePath: string | null;
  key: string;
};

type BoardDiffCell = {
  time: string;
  character: string;
  imagePath: string | null;
};

type BoardDiffRow = {
  time: string;
  source: BoardDiffCell | null;
  target: BoardDiffCell | null;
};

type BoardDiffCandidate = {
  id: string;
  title: string;
  damageText: string;
};

type BoardDiffComparison = {
  kind: 'timelog' | 'article';
  targetTitle: string;
  targetDamageText: string;
  targetPartyMembers: BoardDetailPartyMember[];
  rows: BoardDiffRow[];
  hasDiff: boolean;
  isSameBoss: boolean;
  isSameParty: boolean;
};

type TimelineUbEvent = {
  time: string;
  character: string;
};

type TimelineInfo = {
  uniqueId: string;
  yearmonth: string;
  bossname: string;
  mode: string;
  damage: number;
  battleTime: string;
  battleDate: string;
  authorid?: string;
  authorname?: string;
  authorName?: string;
  party: TimelinePartyMember[];
  ubTimeline: TimelineUbEvent[];
};

function isTimelinePartyMember(value: unknown): value is TimelinePartyMember {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const member = value as TimelinePartyMember;
  return typeof member.name === 'string'
    && Number.isInteger(member.star)
    && Number.isInteger(member.level)
    && Number.isInteger(member.rank);
}

function isTimelineUbEvent(value: unknown): value is TimelineUbEvent {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const event = value as TimelineUbEvent;
  return typeof event.time === 'string' && typeof event.character === 'string';
}

function isTimelineInfo(value: unknown): value is TimelineInfo {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const article = value as TimelineInfo;
  return typeof article.uniqueId === 'string'
    && /^\d{6}$/.test(article.yearmonth)
    && typeof article.bossname === 'string'
    && typeof article.mode === 'string'
    && Number.isInteger(article.damage)
    && /^\d{2}:\d{2}$/.test(article.battleTime)
    && /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/.test(article.battleDate)
    && (typeof (article as { authorid?: unknown }).authorid === 'undefined' || typeof (article as { authorid?: unknown }).authorid === 'string')
    && (typeof (article as { authorname?: unknown }).authorname === 'undefined' || typeof (article as { authorname?: unknown }).authorname === 'string')
    && (typeof article.authorName === 'undefined' || typeof article.authorName === 'string')
    && Array.isArray(article.party) && article.party.every(isTimelinePartyMember)
    && Array.isArray(article.ubTimeline) && article.ubTimeline.every(isTimelineUbEvent);
}

function resolveArticleAuthorId(article: any): string {
  if (!article || typeof article !== 'object') {
    return '';
  }

  const candidateValues = [article.author_id, article.authorid, article.authorId, article.googleUserId];
  const resolved = candidateValues.find((value) => typeof value === 'string' && value.trim().length > 0);
  return typeof resolved === 'string' ? resolved.trim() : '';
}

function resolveArticleAuthorName(article: any): string {
  if (!article || typeof article !== 'object') {
    return '';
  }

  const candidateValues = [article.author_name, article.authorname, article.authorName, article.displayName, article.userName];
  const resolved = candidateValues.find((value) => typeof value === 'string' && value.trim().length > 0);
  return typeof resolved === 'string' ? resolved.trim() : '';
}

function canEditArticle(article: any, userSession: any): boolean {
  const currentGoogleUserId = typeof userSession?.googleUserId === 'string' ? userSession.googleUserId : '';
  const authorId = resolveArticleAuthorId(article);
  return currentGoogleUserId.length > 0 && authorId.length > 0 && currentGoogleUserId === authorId;
}

function ensureArticleEditableByUser(article: any, req: any, res: any): boolean {
  const userSession = req.session.user as any;
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

function loadCharaIndex(): CharaIndexEntry[] {
  try {
    const raw = fs.readFileSync(CHARA_INDEX_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((entry): entry is CharaIndexEntry => {
      return entry
        && typeof entry === 'object'
        && typeof (entry as CharaIndexEntry).fileName === 'string'
        && typeof (entry as CharaIndexEntry).name === 'string';
    });
  } catch (error) {
    console.error('Failed to load chara index:', error);
    return [];
  }
}

let charaIndex: CharaIndexEntry[] = [];
let charaImageByName = new Map<string, string>();
let charaImageByNormalizedName = new Map<string, string>();

function rebuildCharaImageCache(): number {
  const loaded = loadCharaIndex();
  charaIndex = loaded;
  charaImageByName = new Map(loaded.map((entry) => [entry.name, entry.fileName]));
  charaImageByNormalizedName = new Map(
    loaded.map((entry) => [normalizeCharacterLookupKey(entry.name), entry.fileName])
  );
  return loaded.length;
}

export function refreshBoardCharaImageCache(): number {
  return rebuildCharaImageCache();
}

rebuildCharaImageCache();

function normalizeCharacterLookupKey(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/[\s　・･]/g, '')
    .trim();
}

function normalizeCharacterName(name: string): string {
  return name.trim();
}

function splitCharacterName(name: string): { base: string; suffix: string | null } {
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

function resolveCharacterImagePath(name: string): string | null {
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

function parseLegacyPartyMember(value: string): BoardDetailPartyMember {
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

function resolveBoardDetailPartyMembers(party: unknown): BoardDetailPartyMember[] {
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

function resolveBoardDetailUbRows(article: any): BoardDetailUbRow[] {
  const rows: BoardDetailUbRow[] = [];

  if (Array.isArray(article?.ubTimeline)) {
    for (const ub of article.ubTimeline) {
      if (!ub || typeof ub !== 'object') {
        continue;
      }

      const event = ub as {
        time?: unknown;
        character?: unknown;
        activeIcons?: unknown;
        autoActive?: unknown;
        comment?: unknown;
        isAddedRow?: unknown;
        timing?: unknown;
      };
      const time = typeof event.time === 'string' ? event.time : '';
      const ubText = typeof event.character === 'string' ? event.character.trim() : '';
      if (!time && !ubText) {
        continue;
      }

      const ubImagePath = ubText ? resolveCharacterImagePath(ubText) : null;
      const activeIcons = Array.isArray(event.activeIcons)
        ? event.activeIcons.filter((value): value is number => Number.isInteger(value) && value >= 0 && value <= 4)
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

function normalizeBossNameForCompare(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/[\s\u3000]/g, '').trim().toLowerCase()
    : '';
}

function buildPartySignature(party: unknown): string {
  return resolveBoardDetailPartyMembers(party)
    .map((member) => normalizeCharacterLookupKey(member.name))
    .join('|');
}

function resolveArticleDisplayTitle(article: any): string {
  if (typeof article?.postTitle === 'string' && article.postTitle.trim().length > 0) {
    return article.postTitle.trim();
  }
  if (typeof article?.mode === 'string' && article.mode.trim().length > 0) {
    return article.mode.trim();
  }
  return '無題';
}

function resolveArticleDamageText(article: any): string {
  const damage = article?.damage;
  if (typeof damage === 'number' && Number.isFinite(damage)) {
    return damage.toLocaleString('ja-JP');
  }
  if (typeof damage === 'string') {
    return damage;
  }
  return '';
}

function evaluateBoardDiffMeta(sourceArticle: any, targetArticle: any, rows: BoardDiffRow[]): {
  hasDiff: boolean;
  isSameBoss: boolean;
  isSameParty: boolean;
} {
  const sourceBoss = normalizeBossNameForCompare(sourceArticle?.bossname);
  const targetBoss = normalizeBossNameForCompare(targetArticle?.bossname);
  const sourceParty = buildPartySignature(sourceArticle?.party);
  const targetParty = buildPartySignature(targetArticle?.party);

  return {
    hasDiff: rows.some((row) => !row.source || !row.target),
    isSameBoss: sourceBoss.length > 0 && sourceBoss === targetBoss,
    isSameParty: sourceParty.length > 0 && sourceParty === targetParty
  };
}

function resolveBoardDiffTimelineEntries(ubRows: BoardDetailUbRow[]): BoardDiffTimelineEntry[] {
  return ubRows
    .map((row) => {
      const time = typeof row.time === 'string' ? row.time.trim() : '';
      const character = typeof row.ubText === 'string' ? row.ubText.trim() : '';
      if (!time && !character) {
        return null;
      }

      const key = `${time}@@${normalizeCharacterLookupKey(character)}`;
      return {
        time,
        character,
        imagePath: row.ubImagePath,
        key
      };
    })
    .filter((entry): entry is BoardDiffTimelineEntry => !!entry);
}

function toBoardDiffCell(entry: BoardDiffTimelineEntry): BoardDiffCell {
  return {
    time: entry.time,
    character: entry.character,
    imagePath: entry.imagePath
  };
}

function parseTimelineTimeToSeconds(time: string): number | null {
  const match = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  return (Number(match[1]) * 60) + Number(match[2]);
}

function appendMergedUnmatchedRows(
  rows: BoardDiffRow[],
  sourceEntries: BoardDiffTimelineEntry[],
  sourceStart: number,
  sourceEnd: number,
  targetEntries: BoardDiffTimelineEntry[],
  targetStart: number,
  targetEnd: number
): void {
  let sourceIndex = sourceStart;
  let targetIndex = targetStart;

  while (sourceIndex < sourceEnd || targetIndex < targetEnd) {
    if (sourceIndex >= sourceEnd) {
      const targetEntry = targetEntries[targetIndex];
      rows.push({
        time: targetEntry.time,
        source: null,
        target: toBoardDiffCell(targetEntry)
      });
      targetIndex += 1;
      continue;
    }

    if (targetIndex >= targetEnd) {
      const sourceEntry = sourceEntries[sourceIndex];
      rows.push({
        time: sourceEntry.time,
        source: toBoardDiffCell(sourceEntry),
        target: null
      });
      sourceIndex += 1;
      continue;
    }

    const sourceEntry = sourceEntries[sourceIndex];
    const targetEntry = targetEntries[targetIndex];
    const sourceSeconds = parseTimelineTimeToSeconds(sourceEntry.time);
    const targetSeconds = parseTimelineTimeToSeconds(targetEntry.time);

    if (sourceSeconds !== null && targetSeconds !== null) {
      // TLは残り時間の降順（大きい秒数が先頭）を維持する
      if (sourceSeconds >= targetSeconds) {
        rows.push({
          time: sourceEntry.time,
          source: toBoardDiffCell(sourceEntry),
          target: null
        });
        sourceIndex += 1;
      } else {
        rows.push({
          time: targetEntry.time,
          source: null,
          target: toBoardDiffCell(targetEntry)
        });
        targetIndex += 1;
      }
      continue;
    }

    rows.push({
      time: sourceEntry.time,
      source: toBoardDiffCell(sourceEntry),
      target: null
    });
    sourceIndex += 1;
  }
}

function buildBoardDiffMatchPairs(
  sourceEntries: BoardDiffTimelineEntry[],
  targetEntries: BoardDiffTimelineEntry[]
): Array<{ sourceIndex: number; targetIndex: number }> {
  const sourceLength = sourceEntries.length;
  const targetLength = targetEntries.length;
  const dp: number[][] = Array.from({ length: sourceLength + 1 }, () => Array(targetLength + 1).fill(0));

  for (let sourceIndex = sourceLength - 1; sourceIndex >= 0; sourceIndex -= 1) {
    for (let targetIndex = targetLength - 1; targetIndex >= 0; targetIndex -= 1) {
      if (sourceEntries[sourceIndex].key === targetEntries[targetIndex].key) {
        dp[sourceIndex][targetIndex] = dp[sourceIndex + 1][targetIndex + 1] + 1;
      } else {
        dp[sourceIndex][targetIndex] = Math.max(dp[sourceIndex + 1][targetIndex], dp[sourceIndex][targetIndex + 1]);
      }
    }
  }

  const pairs: Array<{ sourceIndex: number; targetIndex: number }> = [];
  let sourceIndex = 0;
  let targetIndex = 0;

  while (sourceIndex < sourceLength && targetIndex < targetLength) {
    if (sourceEntries[sourceIndex].key === targetEntries[targetIndex].key) {
      pairs.push({ sourceIndex, targetIndex });
      sourceIndex += 1;
      targetIndex += 1;
      continue;
    }

    if (dp[sourceIndex + 1][targetIndex] >= dp[sourceIndex][targetIndex + 1]) {
      sourceIndex += 1;
    } else {
      targetIndex += 1;
    }
  }

  return pairs;
}

function buildBoardDiffRows(sourceUbRows: BoardDetailUbRow[], targetUbRows: BoardDetailUbRow[]): BoardDiffRow[] {
  const sourceEntries = resolveBoardDiffTimelineEntries(sourceUbRows);
  const targetEntries = resolveBoardDiffTimelineEntries(targetUbRows);
  const matchPairs = buildBoardDiffMatchPairs(sourceEntries, targetEntries);

  const rows: BoardDiffRow[] = [];
  let sourceIndex = 0;
  let targetIndex = 0;

  matchPairs.forEach((pair) => {
    appendMergedUnmatchedRows(rows, sourceEntries, sourceIndex, pair.sourceIndex, targetEntries, targetIndex, pair.targetIndex);

    const sourceEntry = sourceEntries[pair.sourceIndex];
    const targetEntry = targetEntries[pair.targetIndex];
    rows.push({
      time: sourceEntry.time || targetEntry.time,
      source: toBoardDiffCell(sourceEntry),
      target: toBoardDiffCell(targetEntry)
    });

    sourceIndex = pair.sourceIndex + 1;
    targetIndex = pair.targetIndex + 1;
  });

  appendMergedUnmatchedRows(rows, sourceEntries, sourceIndex, sourceEntries.length, targetEntries, targetIndex, targetEntries.length);

  return rows;
}

async function resolveBoardDiffCandidates(currentArticle: any, currentLegacyId: string, currentGoogleUserId: string): Promise<BoardDiffCandidate[]> {
  if (!currentGoogleUserId) {
    return [];
  }

  const targetBoss = normalizeBossNameForCompare(currentArticle?.bossname);
  const targetParty = buildPartySignature(currentArticle?.party);
  const rows = await listCurrentMonthBoardPosts();

  return rows.flatMap((row) => {
    const legacyId = String(row.legacy_id || row.id || '');
    if (!legacyId || legacyId === currentLegacyId) {
      return [];
    }

    const article = boardRowToArticle(row);
    if (resolveArticleAuthorId(article) !== currentGoogleUserId) {
      return [];
    }

    if (normalizeBossNameForCompare(article?.bossname) !== targetBoss) {
      return [];
    }

    if (buildPartySignature(article?.party) !== targetParty) {
      return [];
    }

    return [{
      id: legacyId,
      title: resolveArticleDisplayTitle(article),
      damageText: resolveArticleDamageText(article)
    }];
  });
}

function parseTimelog(text: string): ParsedArticle {
  const lines = text.split(/\r?\n/);
  const result: ParsedArticle = {
    bossname: '', mode: '', damage: '', battleTime: '', battleDate: '', party: [], ubTimes: []
  };
  let section = '';
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('クランモード')) {
      result.mode = line;
      const modeBody = line.replace(/^クランモード\s*/, '').trim();
      const modeParts = modeBody.split(/[\s\u3000]+/).filter(Boolean);
      if (modeParts.length >= 3) {
        result.bossname = modeParts.slice(2).join(' ').trim();
      } else {
        const stageIndex = modeParts.findIndex((part) => part.endsWith('段階目'));
        if (stageIndex >= 0 && stageIndex < modeParts.length - 1) {
          result.bossname = modeParts.slice(stageIndex + 1).join(' ').trim();
        } else {
          const bossMatch = modeBody.match(/^(?:[^\s\u3000]+段階目[\s\u3000]+)?(.+)$/);
          result.bossname = bossMatch ? bossMatch[1].trim() : modeBody;
        }
      }
    }
    else if (line.match(/\d+ダメージ/)) result.damage = line;
    else if (line.startsWith('バトル時間')) result.battleTime = line.replace('バトル時間', '').trim();
    else if (line.startsWith('バトル日時')) result.battleDate = line.replace('バトル日時', '').trim();
    else if (line.startsWith('◆パーティ編成')) section = 'party';
    else if (line.startsWith('◆ユニオンバースト発動時間')) section = 'ub';
    else if (line.startsWith('----')) section = '';
    else if (section === 'party') result.party.push(line);
    else if (section === 'ub') result.ubTimes.push(line);
  }
  return result;
}

function getAuthViewData(req: any) {
  const userSession = req.session.user as any;
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
    const userSession = req.session.user as any;
    const currentGoogleUserId = typeof userSession?.googleUserId === 'string' ? userSession.googleUserId : '';
    const rows = await listCurrentMonthBoardPosts();
    const visibilityLabelByValue: Record<string, string> = {
      all: '全体',
      clan: 'クラン',
      self: '自分'
    };
    const difficultyLabelByValue: Record<string, string> = {
      '1': 'フルオート',
      '2': 'セミオート',
      '3': '簡単',
      '4': '普通',
      '5': '高難度'
    };
    const modeLabelByValue: Record<string, string> = {
      full: 'フル',
      agro: '持ち越し',
      rank2: '2段階目',
      rank3: '3段階目'
    };

    const articles = rows.flatMap((row) => {
      const article = boardRowToArticle(row);
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
  } catch (error) {
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

// 記事差分ページ
router.get('/:id/diff', async (req, res) => {
  try {
    const auth = getAuthViewData(req);
    const sourceRow = await getCurrentMonthBoardPostByLegacyId(req.params.id);
    if (!sourceRow) {
      return res.status(404).send('記事がありません');
    }

    const sourceArticle = boardRowToArticle(sourceRow);
    const sourcePartyMembers = resolveBoardDetailPartyMembers(sourceArticle.party);
    const userSession = req.session.user as any;
    const currentGoogleUserId = typeof userSession?.googleUserId === 'string' ? userSession.googleUserId : '';
    const myComparableArticles = await resolveBoardDiffCandidates(sourceArticle, String(sourceRow.legacy_id || sourceRow.id), currentGoogleUserId);

    return res.render('board-diff', {
      title: 'ゆかりさん△',
      currentPage: 'board',
      ...auth,
      id: sourceRow.legacy_id || sourceRow.id,
      sourceArticle,
      sourcePartyMembers,
      myComparableArticles,
      compareTimelogText: '',
      compareTimelogError: '',
      comparison: null
    });
  } catch (error) {
    console.error('Failed to load board diff page from Supabase:', error);
    return res.status(503).send('掲示板の読み込みに失敗しました');
  }
});

router.post('/:id/diff/timelog', async (req, res) => {
  try {
    const auth = getAuthViewData(req);
    const sourceRow = await getCurrentMonthBoardPostByLegacyId(req.params.id);
    if (!sourceRow) {
      return res.status(404).send('記事がありません');
    }

    const sourceArticle = boardRowToArticle(sourceRow);
    const sourcePartyMembers = resolveBoardDetailPartyMembers(sourceArticle.party);
    const sourceUbRows = resolveBoardDetailUbRows(sourceArticle);
    const userSession = req.session.user as any;
    const currentGoogleUserId = typeof userSession?.googleUserId === 'string' ? userSession.googleUserId : '';
    const myComparableArticles = await resolveBoardDiffCandidates(sourceArticle, String(sourceRow.legacy_id || sourceRow.id), currentGoogleUserId);

    const compareTimelogText = typeof req.body.compareTimelog === 'string' ? req.body.compareTimelog : '';
    let compareTimelogError = '';
    let comparison: BoardDiffComparison | null = null;

    if (!compareTimelogText.trim()) {
      compareTimelogError = '比較するタイムラインを入力してください';
    } else {
      const parsed = parseTimelog(compareTimelogText);
      const targetUbRows = resolveBoardDetailUbRows(parsed);
      if (targetUbRows.length === 0) {
        compareTimelogError = '比較できるタイムライン行が見つかりませんでした';
      } else {
        const rows = buildBoardDiffRows(sourceUbRows, targetUbRows);
        const meta = evaluateBoardDiffMeta(sourceArticle, parsed, rows);
        comparison = {
          kind: 'timelog',
          targetTitle: '入力タイムライン',
          targetDamageText: parsed.damage || '',
          targetPartyMembers: resolveBoardDetailPartyMembers(parsed.party),
          rows,
          hasDiff: meta.hasDiff,
          isSameBoss: meta.isSameBoss,
          isSameParty: meta.isSameParty
        };
      }
    }

    return res.render('board-diff', {
      title: 'ゆかりさん△',
      currentPage: 'board',
      ...auth,
      id: sourceRow.legacy_id || sourceRow.id,
      sourceArticle,
      sourcePartyMembers,
      myComparableArticles,
      compareTimelogText,
      compareTimelogError,
      comparison
    });
  } catch (error) {
    console.error('Failed to compare board timelog:', error);
    return res.status(503).send('比較処理に失敗しました');
  }
});

router.post('/:id/diff/article/:targetId', async (req, res) => {
  try {
    const auth = getAuthViewData(req);
    const sourceRow = await getCurrentMonthBoardPostByLegacyId(req.params.id);
    if (!sourceRow) {
      return res.status(404).send('記事がありません');
    }

    const sourceArticle = boardRowToArticle(sourceRow);
    const sourcePartyMembers = resolveBoardDetailPartyMembers(sourceArticle.party);
    const sourceUbRows = resolveBoardDetailUbRows(sourceArticle);
    const userSession = req.session.user as any;
    const currentGoogleUserId = typeof userSession?.googleUserId === 'string' ? userSession.googleUserId : '';
    const myComparableArticles = await resolveBoardDiffCandidates(sourceArticle, String(sourceRow.legacy_id || sourceRow.id), currentGoogleUserId);
    const targetId = String(req.params.targetId || '');
    const selectableTargetIds = new Set(myComparableArticles.map((item) => item.id));

    if (!selectableTargetIds.has(targetId)) {
      return res.status(403).send('この比較先は選択できません');
    }

    const targetRow = await getCurrentMonthBoardPostByLegacyId(targetId);
    if (!targetRow) {
      return res.status(404).send('比較先の記事がありません');
    }

    const targetArticle = boardRowToArticle(targetRow);
    const targetPartyMembers = resolveBoardDetailPartyMembers(targetArticle.party);
    const targetUbRows = resolveBoardDetailUbRows(targetArticle);
    const rows = buildBoardDiffRows(sourceUbRows, targetUbRows);
    const meta = evaluateBoardDiffMeta(sourceArticle, targetArticle, rows);
    const comparison: BoardDiffComparison = {
      kind: 'article',
      targetTitle: resolveArticleDisplayTitle(targetArticle),
      targetDamageText: resolveArticleDamageText(targetArticle),
      targetPartyMembers,
      rows,
      hasDiff: meta.hasDiff,
      isSameBoss: meta.isSameBoss,
      isSameParty: meta.isSameParty
    };

    return res.render('board-diff', {
      title: 'ゆかりさん△',
      currentPage: 'board',
      ...auth,
      id: sourceRow.legacy_id || sourceRow.id,
      sourceArticle,
      sourcePartyMembers,
      myComparableArticles,
      compareTimelogText: '',
      compareTimelogError: '',
      comparison
    });
  } catch (error) {
    console.error('Failed to compare board article:', error);
    return res.status(503).send('比較処理に失敗しました');
  }
});

// 個別記事
router.get('/:id', async (req, res) => {
  try {
    const auth = getAuthViewData(req);
    const row = await getCurrentMonthBoardPostByLegacyId(req.params.id);
    if (!row) {
      return res.status(404).send('記事がありません');
    }

    const data = boardRowToArticle(row);
    const partyMembers = resolveBoardDetailPartyMembers(data.party);
    const ubRows = resolveBoardDetailUbRows(data);
    const currentUserSession = req.session.user as any;
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
  } catch (error) {
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
    } catch {
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
    const row = await getCurrentMonthBoardPostByLegacyId(req.params.id);
    if (!row) {
      return res.status(404).send('記事がありません');
    }

    const data = boardRowToArticle(row);
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
  } catch (error) {
    console.error('Failed to load board edit page from Supabase:', error);
    res.status(503).send('掲示板の読み込みに失敗しました');
  }
});

// 記事削除
router.post('/:id/delete', async (req, res) => {
  try {
    const row = await getCurrentMonthBoardPostByLegacyId(req.params.id);
    if (!row) {
      return res.status(404).send('記事がありません');
    }

    const data = boardRowToArticle(row);
    if (!ensureArticleEditableByUser(data, req, res)) {
      return;
    }

    await deleteBoardPostByLegacyId(req.params.id);
    return res.redirect('/board');
  } catch (error) {
    console.error('Failed to delete board post from Supabase:', error);
    res.status(503).send('掲示板の削除に失敗しました');
  }
});

// 編集保存（新規・既存）
router.post('/save', async (req, res) => {
  try {
    const nowId = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const timelineInfoRaw = req.body.timelineInfo;
    const userSession = req.session.user as any;
    if (!userSession) {
      return res.status(403).send('Googleでログイン後に編集可能になります');
    }

    const sessionGoogleUserId = typeof userSession?.googleUserId === 'string' ? userSession.googleUserId : '';
    const sessionAuthorName = typeof userSession?.displayName === 'string' ? userSession.displayName : '';
    const yearmonth = await getCurrentClanBattleYearMonth();

    let legacyId = String(req.body.id || nowId);
    let article: ParsedArticle | TimelineInfo;

    if (typeof timelineInfoRaw === 'string' && timelineInfoRaw.trim().length > 0) {
      const parsedTimelineInfo = JSON.parse(timelineInfoRaw);
      if (!isTimelineInfo(parsedTimelineInfo)) {
        return res.status(400).send('timelineInfo の形式が不正です');
      }

      legacyId = parsedTimelineInfo.uniqueId || legacyId;
      const existingRow = await getCurrentMonthBoardPostByLegacyId(legacyId);
      if (existingRow) {
        const existingArticle = boardRowToArticle(existingRow);
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
    } else {
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
        article.party = req.body.party.split(/\r?\n/).map((s: string) => s.trim()).filter((s: string) => s.length > 0);
      }
      if (typeof req.body.ubTimes === 'string') {
        article.ubTimes = req.body.ubTimes.split(/\r?\n/).map((s: string) => s.trim()).filter((s: string) => s.length > 0);
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

      const existingRow = await getCurrentMonthBoardPostByLegacyId(legacyId);
      if (existingRow) {
        const existingArticle = boardRowToArticle(existingRow);
        if (!canEditArticle(existingArticle, userSession)) {
          return res.status(403).send('投稿者のみ編集可能です');
        }
      }
    }

    const savedRow = await upsertBoardPost({
      legacyId,
      yearmonth,
      article,
      battleTimeSeconds: normalizeBattleTimeSeconds((article as ParsedArticle).battleTime),
      battleDateIso: normalizeBattleDateIso((article as ParsedArticle).battleDate),
      authorId: sessionGoogleUserId,
      authorName: sessionAuthorName
    });

    return res.redirect('/board/' + (savedRow.legacy_id || legacyId));
  } catch (error) {
    console.error('Failed to save board post to Supabase:', error);
    return res.status(503).send('掲示板の保存に失敗しました');
  }
});

export default router;
