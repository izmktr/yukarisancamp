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
import { cert, initializeApp as initializeAdminApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

// Firebase Admin SDK 初期化
let adminDb: Firestore | null = null;

try {
  const serviceAccountPath = process.env.FIREBASE_ADMIN_SDK_KEY;
  if (serviceAccountPath) {
    // パスを解決
    const resolvedPath = path.resolve(__dirname, serviceAccountPath);
    console.log('Firebase serviceAccountKey path:', resolvedPath);

    // ファイルが存在するか確認
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`serviceAccountKey.json not found at: ${resolvedPath}`);
    }

    const serviceAccountJson = fs.readFileSync(resolvedPath, 'utf-8');
    const serviceAccount = JSON.parse(serviceAccountJson);

    initializeAdminApp({
      credential: cert(serviceAccount)
    });
    adminDb = getFirestore();
    console.log('Firebase Admin SDK initialized successfully');
  } else {
    console.warn('FIREBASE_ADMIN_SDK_KEY not set. role management will use default "user" role.');
  }
} catch (error) {
  const errorMsg = error instanceof Error ? error.message : String(error);
  console.warn('Firebase Admin SDK initialization failed:', errorMsg);
  console.warn('Troubleshooting: Check if firebase-admin is installed and serviceAccountKey.json path is correct');
}

// Firestore から user role を取得（userRoles コレクション運用）
async function getUserRoleFromFirestore(googleUserId: string): Promise<'user' | 'admin'> {
  if (!adminDb) {
    return 'user';
  }
  try {
    const doc = await adminDb.collection('userRoles').doc(googleUserId).get();
    if (doc.exists) {
      const data = doc.data();
      return data?.role === 'admin' ? 'admin' : 'user';
    }
  } catch (error) {
    console.error('Failed to fetch role from Firestore:', error);
  }
  return 'user';
}

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
  res.render('info', {
    title: 'ゆかりさん△',
    currentPage: 'info',
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
  const charaDirPath = path.join(__dirname, '../chara');
  let characters: { fileName: string; name: string }[] = [];
  let unindexedImages: string[] = [];

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

  try {
    const indexedFileNames = new Set(characters.map((character) => character.fileName));
    unindexedImages = fs.readdirSync(charaDirPath)
      .filter((fileName) => fileName.toLowerCase().endsWith('.png'))
      .filter((fileName) => !indexedFileNames.has(fileName))
      .sort((left, right) => left.localeCompare(right, 'ja'));
  } catch (error) {
    console.error('Failed to scan character image directory:', error);
  }

  res.render('chara-check', {
    title: 'ゆかりさん△',
    currentPage: 'chara-check',
    isLoggedIn: !!userSession,
    userName: userSession?.displayName || '',
    isAdmin: userSession?.role === 'admin',
    characters,
    unindexedImages
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
app.post('/api/user/session', express.json(), async (req, res) => {
  try {
    if (!adminDb) {
      return res.status(503).json({ error: 'Authentication service is not available' });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization header with Bearer token is required' });
    }

    const idToken = authHeader.slice(7);
    let decodedToken: any;
    try {
      decodedToken = await getAuth().verifyIdToken(idToken);
    } catch {
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
  } catch (error) {
    console.error('Error saving user session:', error);
    res.status(500).json({ error: 'Failed to save user session' });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
