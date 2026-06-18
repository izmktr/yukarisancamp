"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config({ path: '.env.local' });
const express_1 = __importDefault(require("express"));
const express_session_1 = __importDefault(require("express-session"));
const path_1 = __importDefault(require("path"));
const express_ejs_layouts_1 = __importDefault(require("express-ejs-layouts"));
const board_1 = __importDefault(require("./api/board"));
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
app.use(express_1.default.json());
// APIルーティング
app.use('/api/board', board_1.default);
// 型定義のテスト用サンプルデータ
const sampleUser = {
    googleUserId: "123456789",
    userId: "123456789",
    displayName: "テストユーザー",
    createdAt: Date.now(),
    favoriteThings: ["プリコネ", "クラバト"]
};
console.log('Web app starting...');
console.log('Sample user:', sampleUser);
// ルート定義
app.get('/', (req, res) => {
    res.render('index', {
        title: 'ゆかりさん△',
        currentPage: 'home',
        isLoggedIn: false,
        userName: ''
    });
});
app.get('/users', (req, res) => {
    res.render('users', {
        title: 'ゆかりさん△',
        currentPage: 'users',
        isLoggedIn: false,
        userName: '',
        sampleUser: sampleUser
    });
});
const board_2 = __importDefault(require("./routes/board"));
app.use('/board', board_2.default);
app.get('/settings', (req, res) => {
    res.render('settings', {
        title: 'ゆかりさん△',
        currentPage: 'settings',
        isLoggedIn: false,
        userName: ''
    });
});
// API時刻取得
app.get('/api/time', (req, res) => {
    res.json({ time: new Date().toLocaleTimeString('ja-JP') });
});
// APIユーザー情報取得
app.get('/api/user', (req, res) => {
    res.json({ user: sampleUser });
});
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
//# sourceMappingURL=index.js.map