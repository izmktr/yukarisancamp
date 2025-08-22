import { Request, Response, Router } from 'express';
import path from 'path';
import fs from 'fs';

const router = Router();
const DATA_DIR = path.join(__dirname, '../../data/board');

// 記事一覧取得
router.get('/', (req: Request, res: Response) => {
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
  res.json(articles);
});

// 個別記事取得
router.get('/:id', (req: Request, res: Response) => {
  const file = path.join(DATA_DIR, req.params.id + '.json');
  if (!fs.existsSync(file)) return res.status(404).json({ error: '記事がありません' });
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  res.json(data);
});

// 投稿（timelogテキスト→json保存）
router.post('/post', (req: Request, res: Response) => {
  const { timelog } = req.body;
  // ここでパース関数を呼び出す（仮）
  let parsed;
  try {
    parsed = JSON.parse(timelog); // 実際は独自パース
  } catch {
    return res.status(400).json({ error: 'パース失敗' });
  }
  const id = Date.now().toString();
  fs.writeFileSync(path.join(DATA_DIR, id + '.json'), JSON.stringify(parsed, null, 2), 'utf-8');
  res.json({ id });
});

// 編集保存
router.post('/:id/edit', (req: Request, res: Response) => {
  const file = path.join(DATA_DIR, req.params.id + '.json');
  const { article } = req.body;
  fs.writeFileSync(file, JSON.stringify(article, null, 2), 'utf-8');
  res.json({ ok: true });
});

export default router;
