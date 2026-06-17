"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const router = (0, express_1.Router)();
const DATA_DIR = path_1.default.join(__dirname, '../../data/board');
// 記事一覧取得
router.get('/', (req, res) => {
    const files = fs_1.default.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
    const articles = files.map(file => {
        const data = JSON.parse(fs_1.default.readFileSync(path_1.default.join(DATA_DIR, file), 'utf-8'));
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
router.get('/:id', (req, res) => {
    const file = path_1.default.join(DATA_DIR, req.params.id + '.json');
    if (!fs_1.default.existsSync(file))
        return res.status(404).json({ error: '記事がありません' });
    const data = JSON.parse(fs_1.default.readFileSync(file, 'utf-8'));
    res.json(data);
});
// 投稿（timelogテキスト→json保存）
router.post('/post', (req, res) => {
    const { timelog } = req.body;
    // ここでパース関数を呼び出す（仮）
    let parsed;
    try {
        parsed = JSON.parse(timelog); // 実際は独自パース
    }
    catch {
        return res.status(400).json({ error: 'パース失敗' });
    }
    const id = Date.now().toString();
    fs_1.default.writeFileSync(path_1.default.join(DATA_DIR, id + '.json'), JSON.stringify(parsed, null, 2), 'utf-8');
    res.json({ id });
});
// 編集保存
router.post('/:id/edit', (req, res) => {
    const file = path_1.default.join(DATA_DIR, req.params.id + '.json');
    const { article } = req.body;
    fs_1.default.writeFileSync(file, JSON.stringify(article, null, 2), 'utf-8');
    res.json({ ok: true });
});
exports.default = router;
//# sourceMappingURL=board.js.map