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
const app_1 = require("firebase-admin/app");
const auth_1 = require("firebase-admin/auth");
const firestore_1 = require("firebase-admin/firestore");
// Firebase Admin SDK 初期化
let adminDb = null;
try {
    const serviceAccountPath = process.env.FIREBASE_ADMIN_SDK_KEY;
    if (serviceAccountPath) {
        // パスを解決
        const resolvedPath = path_1.default.resolve(__dirname, serviceAccountPath);
        console.log('Firebase serviceAccountKey path:', resolvedPath);
        // ファイルが存在するか確認
        if (!fs_1.default.existsSync(resolvedPath)) {
            throw new Error(`serviceAccountKey.json not found at: ${resolvedPath}`);
        }
        const serviceAccountJson = fs_1.default.readFileSync(resolvedPath, 'utf-8');
        const serviceAccount = JSON.parse(serviceAccountJson);
        (0, app_1.initializeApp)({
            credential: (0, app_1.cert)(serviceAccount)
        });
        adminDb = (0, firestore_1.getFirestore)();
        console.log('Firebase Admin SDK initialized successfully');
    }
    else {
        console.warn('FIREBASE_ADMIN_SDK_KEY not set. role management will use default "user" role.');
    }
}
catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.warn('Firebase Admin SDK initialization failed:', errorMsg);
    console.warn('Troubleshooting: Check if firebase-admin is installed and serviceAccountKey.json path is correct');
}
// Firestore から user role を取得（userRoles コレクション運用）
async function getUserRoleFromFirestore(googleUserId) {
    if (!adminDb) {
        return 'user';
    }
    try {
        const doc = await adminDb.collection('userRoles').doc(googleUserId).get();
        if (doc.exists) {
            const data = doc.data();
            return data?.role === 'admin' ? 'admin' : 'user';
        }
    }
    catch (error) {
        console.error('Failed to fetch role from Firestore:', error);
    }
    return 'user';
}
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
    res.render('info', {
        title: 'ゆかりさん△',
        currentPage: 'info',
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
app.post('/api/user/logout', (req, res) => {
    req.session.user = undefined;
    req.session.save((saveError) => {
        if (saveError) {
            console.error('Failed to clear user session:', saveError);
            return res.status(500).json({ error: 'Failed to clear user session' });
        }
        return res.json({ success: true });
    });
});
// ユーザーセッション保存API
// セキュリティ:
//   - Authorization: Bearer <Firebase ID Token> を必須とし、Admin SDK で検証
//   - req.body の googleUserId は使わず、検証済みトークンの uid を使用
//   - Admin SDK 未初期化の場合はリクエストを拒否
app.post('/api/user/session', express_1.default.json(), async (req, res) => {
    try {
        if (!adminDb) {
            return res.status(503).json({ error: 'Authentication service is not available' });
        }
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Authorization header with Bearer token is required' });
        }
        const idToken = authHeader.slice(7);
        let decodedToken;
        try {
            decodedToken = await (0, auth_1.getAuth)().verifyIdToken(idToken);
        }
        catch {
            return res.status(401).json({ error: 'Invalid or expired ID token' });
        }
        const googleUserId = decodedToken.uid;
        const { displayName } = req.body;
        // role は Firestore から取得（トークンの uid で検索）
        const role = await getUserRoleFromFirestore(googleUserId);
        // セッションにユーザー情報を保存
        req.session.user = {
            googleUserId,
            displayName: displayName || 'ユーザー',
            role
        };
        res.json({ success: true, message: 'User session saved', role });
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