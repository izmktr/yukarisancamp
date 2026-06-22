"use strict";
/// <reference path="./types/session.d.ts" />
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const envLocalPath = path_1.default.resolve(__dirname, '../.env.local');
const envPath = path_1.default.resolve(__dirname, '../.env');
dotenv_1.default.config({ path: envLocalPath });
dotenv_1.default.config({ path: envPath });
const express_1 = __importDefault(require("express"));
const express_session_1 = __importDefault(require("express-session"));
const express_ejs_layouts_1 = __importDefault(require("express-ejs-layouts"));
const board_1 = __importDefault(require("./api/board"));
const fs_1 = __importDefault(require("fs"));
function parseClanDataJson(raw) {
    // Preserve large Discord IDs in bosshistory.member without external parser.
    const normalized = raw.replace(/("member"\s*:\s*)(\d{16,})/g, '$1"$2"');
    return JSON.parse(normalized);
}
const app = (0, express_1.default)();
const port = 3000;
function getFirebaseConfigValue(key, fallback) {
    const value = process.env[key];
    return value && value.trim().length > 0 ? value : fallback;
}
const firebaseConfig = {
    apiKey: getFirebaseConfigValue('FIREBASE_API_KEY', 'AIzaSyDcD3rAJd8ayXudkYatnEdnzEga-V32rVQ'),
    authDomain: getFirebaseConfigValue('FIREBASE_AUTH_DOMAIN', 'yukarisan-f3b06.firebaseapp.com'),
    projectId: getFirebaseConfigValue('FIREBASE_PROJECT_ID', 'yukarisan-f3b06'),
    storageBucket: getFirebaseConfigValue('FIREBASE_STORAGE_BUCKET', 'yukarisan-f3b06.firebasestorage.app'),
    messagingSenderId: getFirebaseConfigValue('FIREBASE_MESSAGING_SENDER_ID', '995628919608'),
    appId: getFirebaseConfigValue('FIREBASE_APP_ID', '1:995628919608:web:42683b4de1c4de6d5fefcd'),
    measurementId: getFirebaseConfigValue('FIREBASE_MEASUREMENT_ID', 'G-PL9YLWJY76')
};
app.locals.firebaseConfig = firebaseConfig;
// セッションミドルウェア追加
app.use((0, express_session_1.default)({
    secret: 'yukarisan-secret',
    resave: false,
    saveUninitialized: true
}));
// EJSレイアウトの設定
app.use(express_ejs_layouts_1.default);
app.set('layout', 'layout');
app.set('view engine', 'ejs');
app.set('views', path_1.default.join(__dirname, '../views'));
// 静的ファイルの設定
app.use(express_1.default.static(path_1.default.join(__dirname, '../public')));
app.use('/chara-images', express_1.default.static(path_1.default.join(__dirname, '../chara')));
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
// APIルーティング
app.use('/api/board', board_1.default);
console.log('Web app starting...');
// ルート定義
app.get('/', (req, res) => {
    const userSession = req.session.user;
    res.render('index', {
        title: 'ゆかりさん△',
        currentPage: 'home',
        isLoggedIn: !!userSession,
        userName: userSession?.displayName || '',
        isAdmin: userSession?.role === 'admin'
    });
});
app.get('/info', (req, res) => {
    const userSession = req.session.user;
    res.render('info', {
        title: 'ゆかりさん△',
        currentPage: 'info',
        isLoggedIn: !!userSession,
        userName: userSession?.displayName || '',
        isAdmin: userSession?.role === 'admin'
    });
});
app.get('/users', (_req, res) => {
    res.redirect('/info');
});
const board_2 = __importDefault(require("./routes/board"));
app.use('/board', board_2.default);
app.get('/settings', (req, res) => {
    const userSession = req.session.user;
    res.render('settings', {
        title: 'ゆかりさん△',
        currentPage: 'settings',
        isLoggedIn: !!userSession,
        userName: userSession?.displayName || '',
        isAdmin: userSession?.role === 'admin'
    });
});
app.get('/clanbattle-settings', (req, res) => {
    const userSession = req.session.user;
    res.render('clanbattle-settings', {
        title: 'ゆかりさん△',
        currentPage: 'clanbattle-settings',
        isLoggedIn: !!userSession,
        userName: userSession?.displayName || '',
        isAdmin: userSession?.role === 'admin'
    });
});
app.get('/chara-check', (req, res) => {
    const userSession = req.session.user;
    const charaIndexPath = path_1.default.join(__dirname, '../chara/charaindex.json');
    let characters = [];
    try {
        const raw = fs_1.default.readFileSync(charaIndexPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            characters = parsed.filter((item) => {
                return item && typeof item.fileName === 'string' && typeof item.name === 'string';
            });
        }
    }
    catch (error) {
        console.error('Failed to load character index:', error);
    }
    res.render('chara-check', {
        title: 'ゆかりさん△',
        currentPage: 'chara-check',
        isLoggedIn: !!userSession,
        userName: userSession?.displayName || '',
        isAdmin: userSession?.role === 'admin',
        characters
    });
});
// クランデータ詳細表示
app.get('/clandata/:id', (req, res) => {
    const clanId = req.params.id;
    const clanDataPath = path_1.default.join(__dirname, '../clandata', `${clanId}.json`);
    let clanData = null;
    let error = null;
    try {
        if (fs_1.default.existsSync(clanDataPath)) {
            const raw = fs_1.default.readFileSync(clanDataPath, 'utf-8');
            clanData = parseClanDataJson(raw);
        }
        else {
            error = `クランID: ${clanId} のデータが見つかりません`;
        }
    }
    catch (err) {
        console.error('Failed to load clan data:', err);
        error = `クランデータの読み込みに失敗しました: ${err instanceof Error ? err.message : '不明なエラー'}`;
    }
    const userSession = req.session.user;
    res.render('clandata-detail', {
        title: 'ゆかりさん△ - クランデータ',
        currentPage: 'clandata',
        isLoggedIn: !!userSession,
        userName: userSession?.displayName || '',
        isAdmin: userSession?.role === 'admin',
        clanId,
        clanData,
        error
    });
});
// API時刻取得
app.get('/api/time', (req, res) => {
    res.json({ time: new Date().toLocaleTimeString('ja-JP') });
});
// APIユーザー情報取得
app.get('/api/user', (req, res) => {
    res.json({ user: req.session.user || null });
});
// ユーザーセッション保存API
app.post('/api/user/session', express_1.default.json(), async (req, res) => {
    try {
        const { googleUserId, displayName, role } = req.body;
        if (!googleUserId) {
            return res.status(400).json({ error: 'googleUserId is required' });
        }
        // セッションにユーザー情報を保存
        req.session.user = {
            googleUserId,
            displayName: displayName || 'ユーザー',
            role: role || 'user'
        };
        res.json({ success: true, message: 'User session saved' });
    }
    catch (error) {
        console.error('Error saving user session:', error);
        res.status(500).json({ error: 'Failed to save user session' });
    }
});
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
//# sourceMappingURL=index.js.map