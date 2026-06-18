import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import express from 'express';
import session from 'express-session';
import path from 'path';
import expressLayouts from 'express-ejs-layouts';
import { UserProfile } from './types';
import boardApi from './api/board';

const app = express();
const port = 3000;

function getFirebaseConfigValue(key: string, fallback: string): string {
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
app.use(session({
  secret: 'yukarisan-secret',
  resave: false,
  saveUninitialized: true
}));

// EJSレイアウトの設定
app.use(expressLayouts);
app.set('layout', 'layout');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// 静的ファイルの設定
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

// APIルーティング
app.use('/api/board', boardApi);

// 型定義のテスト用サンプルデータ
const sampleUser: UserProfile = {
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

import boardRouter from './routes/board';
app.use('/board', boardRouter);

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
