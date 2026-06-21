import { Router } from 'express';
import path from 'path';
import fs from 'fs';

// Session型拡張（TypeScriptエラー回避）
declare module 'express-session' {
  interface SessionData {
    editingArticle?: any;
  }
}

const router = Router();
const DATA_DIR = path.join(__dirname, '../../data/board');

type ParsedArticle = {
  mode: string;
  damage: string;
  battleTime: string;
  battleDate: string;
  party: string[];
  ubTimes: string[];
};

type TimelinePartyMember = {
  name: string;
  star: number;
  level: number;
  rank: number;
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
    && Array.isArray(article.party) && article.party.every(isTimelinePartyMember)
    && Array.isArray(article.ubTimeline) && article.ubTimeline.every(isTimelineUbEvent);
}

function parseTimelog(text: string): ParsedArticle {
  const lines = text.split(/\r?\n/);
  const result: ParsedArticle = {
    mode: '', damage: '', battleTime: '', battleDate: '', party: [], ubTimes: []
  };
  let section = '';
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('クランモード')) result.mode = line;
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

// 記事一覧
router.get('/', (req, res) => {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  const articles = files.map(file => {
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8'));
    return {
      id: file.replace('.json', ''),
      mode: data.mode,
      damage: data.damage,
      battleTime: data.battleTime,
      battleDate: data.battleDate
    };
  });
  res.render('board', {
    title: 'ゆかりさん△',
    currentPage: 'board',
    isLoggedIn: false,
    userName: '',
    articles
  });
});

// 新規投稿画面（競合回避のため /:id より前に記述）
router.get('/post', (req, res) => {
  res.render('board-post', {
    title: 'ゆかりさん△',
    currentPage: 'board',
    isLoggedIn: false,
    userName: ''
  });
});

// 個別記事
router.get('/:id', (req, res) => {
  const file = path.join(DATA_DIR, req.params.id + '.json');
  if (!fs.existsSync(file)) return res.status(404).send('記事がありません');
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  res.render('board-detail', {
    title: 'ゆかりさん△',
    currentPage: 'board',
    isLoggedIn: false,
    userName: '',
    article: data,
    id: req.params.id
  });
});

// 投稿処理（timelogテキスト→編集画面）
router.post('/edit', (req, res) => {
  const rawText = req.body.timelog;
  const parsed = parseTimelog(rawText);
  req.session.editingArticle = parsed;
  res.render('board-edit', {
    title: 'ゆかりさん△',
    currentPage: 'board',
    isLoggedIn: false,
    userName: '',
    article: parsed,
    timelog: rawText,
    isNew: true
  });
});

// 編集画面（既存記事）
router.get('/:id/edit', (req, res) => {
  const file = path.join(DATA_DIR, req.params.id + '.json');
  if (!fs.existsSync(file)) return res.status(404).send('記事がありません');
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  res.render('board-edit', {
    title: 'ゆかりさん△',
    currentPage: 'board',
    isLoggedIn: false,
    userName: '',
    article: data,
    id: req.params.id,
    isNew: false
  });
});

// 編集保存（新規・既存）
router.post('/save', (req, res) => {
  const nowId = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const timelineInfoRaw = req.body.timelineInfo;

  if (typeof timelineInfoRaw === 'string' && timelineInfoRaw.trim().length > 0) {
    try {
      const parsedTimelineInfo = JSON.parse(timelineInfoRaw);
      if (!isTimelineInfo(parsedTimelineInfo)) {
        return res.status(400).send('timelineInfo の形式が不正です');
      }

      const id = parsedTimelineInfo.uniqueId || req.body.id || nowId;
      const timelineInfo: TimelineInfo = {
        ...parsedTimelineInfo,
        uniqueId: id
      };

      const file = path.join(DATA_DIR, id + '.json');
      fs.writeFileSync(file, JSON.stringify(timelineInfo, null, 2), 'utf-8');
      return res.redirect('/board/' + id);
    } catch {
      return res.status(400).send('timelineInfo の読み込みに失敗しました');
    }
  }

  const article: ParsedArticle = {
    mode: req.body.mode || '',
    damage: req.body.damage || '',
    battleTime: req.body.battleTime || '',
    battleDate: req.body.battleDate || '',
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
    article.mode = parsed.mode;
    article.damage = parsed.damage;
    article.battleTime = parsed.battleTime;
    article.battleDate = parsed.battleDate;
    article.party = parsed.party;
    article.ubTimes = parsed.ubTimes;
  }

  const id = req.body.id || nowId;
  const file = path.join(DATA_DIR, id + '.json');
  fs.writeFileSync(file, JSON.stringify(article, null, 2), 'utf-8');
  res.redirect('/board/' + id);
});

export default router;
