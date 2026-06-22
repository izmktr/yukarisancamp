/// <reference path="./types/session.d.ts" />

import dotenv from 'dotenv';
import path from 'path';

const envLocalPath = path.resolve(__dirname, '../.env.local');
const envPath = path.resolve(__dirname, '../.env');

dotenv.config({ path: envLocalPath });
dotenv.config({ path: envPath });

import express from 'express';
import session from 'express-session';
import expressLayouts from 'express-ejs-layouts';
import boardApi from './api/board';
import fs from 'fs';

function parseClanDataJson(raw: string): any {
  // Preserve large Discord IDs in bosshistory.member without external parser.
  const normalized = raw.replace(/("member"\s*:\s*)(\d{16,})/g, '$1"$2"');
  return JSON.parse(normalized);
}

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
app.use('/chara-images', express.static(path.join(__dirname, '../chara')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// APIルーティング
app.use('/api/board', boardApi);

console.log('Web app starting...');

// ルート定義
app.get('/', (req, res) => {
  const userSession = req.session.user as any;
  res.render('index', {
    title: 'ゆかりさん△',
    currentPage: 'home',
    isLoggedIn: !!userSession,
    userName: userSession?.displayName || '',
    isAdmin: userSession?.role === 'admin'
  });
});

app.get('/info', (req, res) => {
  const userSession = req.session.user as any;
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

import boardRouter from './routes/board';
app.use('/board', boardRouter);

app.get('/settings', (req, res) => {
  const userSession = req.session.user as any;
  res.render('settings', {
    title: 'ゆかりさん△',
    currentPage: 'settings',
    isLoggedIn: !!userSession,
    userName: userSession?.displayName || '',
    isAdmin: userSession?.role === 'admin'
  });
});

app.get('/clanbattle-settings', (req, res) => {
  const userSession = req.session.user as any;
  res.render('clanbattle-settings', {
    title: 'ゆかりさん△',
    currentPage: 'clanbattle-settings',
    isLoggedIn: !!userSession,
    userName: userSession?.displayName || '',
    isAdmin: userSession?.role === 'admin'
  });
});

app.get('/chara-check', (req, res) => {
  const userSession = req.session.user as any;
  const charaIndexPath = path.join(__dirname, '../chara/charaindex.json');
  let characters: { fileName: string; name: string }[] = [];

  try {
    const raw = fs.readFileSync(charaIndexPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      characters = parsed.filter((item): item is { fileName: string; name: string } => {
        return item && typeof item.fileName === 'string' && typeof item.name === 'string';
      });
    }
  } catch (error) {
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
  const clanDataPath = path.join(__dirname, '../clandata', `${clanId}.json`);
  let clanData: any = null;
  let error: string | null = null;

  try {
    if (fs.existsSync(clanDataPath)) {
      const raw = fs.readFileSync(clanDataPath, 'utf-8');
      clanData = parseClanDataJson(raw);
    } else {
      error = `クランID: ${clanId} のデータが見つかりません`;
    }
  } catch (err) {
    console.error('Failed to load clan data:', err);
    error = `クランデータの読み込みに失敗しました: ${err instanceof Error ? err.message : '不明なエラー'}`;
  }

  const userSession = req.session.user as any;
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
app.post('/api/user/session', express.json(), async (req, res) => {
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
  } catch (error) {
    console.error('Error saving user session:', error);
    res.status(500).json({ error: 'Failed to save user session' });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
