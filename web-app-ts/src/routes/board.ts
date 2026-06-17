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
  res.render('board-list', { articles });
});

// 新規投稿画面（競合回避のため /:id より前に記述）
router.get('/post', (req, res) => {
  res.render('board-post');
});

// 個別記事
router.get('/:id', (req, res) => {
  const file = path.join(DATA_DIR, req.params.id + '.json');
  if (!fs.existsSync(file)) return res.status(404).send('記事がありません');
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  res.render('board-detail', { article: data, id: req.params.id });
});

// 投稿処理（timelogテキスト→編集画面）
router.post('/edit', (req, res) => {
  const rawText = req.body.timelog;
  // timelogテキストをパースする関数（仮実装）
  function parseTimelog(text: string) {
    const lines = text.split(/\r?\n/);
    const result: {
      mode: string;
      damage: string;
      battleTime: string;
      battleDate: string;
      party: string[];
      ubTimes: string[];
    } = {
      mode: '', damage: '', battleTime: '', battleDate: '', party: [], ubTimes: []
    };
    let section = '';
    for (const line of lines) {
      if (line.startsWith('クランモード')) result.mode = line.trim();
      else if (line.match(/\d+ダメージ/)) result.damage = line.trim();
      else if (line.startsWith('バトル時間')) result.battleTime = line.replace('バトル時間', '').trim();
      else if (line.startsWith('バトル日時')) result.battleDate = line.replace('バトル日時', '').trim();
      else if (line.startsWith('◆パーティ編成')) section = 'party';
      else if (line.startsWith('◆ユニオンバースト発動時間')) section = 'ub';
      else if (line.startsWith('----')) section = '';
      else if (section === 'party' && line) result.party.push(line.trim());
      else if (section === 'ub' && line) result.ubTimes.push(line.trim());
    }
    return result;
  }
  const parsed = parseTimelog(rawText);
  req.session.editingArticle = parsed;
  res.render('board-edit', { article: parsed, timelog: rawText, isNew: true });
});

// 編集画面（既存記事）
router.get('/:id/edit', (req, res) => {
  const file = path.join(DATA_DIR, req.params.id + '.json');
  if (!fs.existsSync(file)) return res.status(404).send('記事がありません');
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  res.render('board-edit', { article: data, id: req.params.id, isNew: false });
});

// 編集保存（新規・既存）
router.post('/save', (req, res) => {
  let article = req.body.article;
  if (typeof article === 'string') {
    try { article = JSON.parse(article); } catch {}
  }
  // 新規の場合はID生成
  let id = req.body.id;
  if (!id) {
    id = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  }
  const file = path.join(DATA_DIR, id + '.json');
  fs.writeFileSync(file, JSON.stringify(article, null, 2), 'utf-8');
  res.redirect('/board/' + id);
});

export default router;
