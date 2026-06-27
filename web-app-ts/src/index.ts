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
import multer from 'multer';
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

function getAuthViewData(req: express.Request) {
  const userSession = req.session.user as any;
  return {
    isLoggedIn: !!userSession,
    userName: userSession?.displayName || '',
    isAdmin: userSession?.role === 'admin'
  };
}

async function ensureAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const { isAdmin } = getAuthViewData(req);
  if (isAdmin) {
    next();
    return;
  }

  const userSession = req.session.user as any;
  const googleUserId = typeof userSession?.googleUserId === 'string' ? userSession.googleUserId : '';
  if (!googleUserId) {
    res.status(403).send('管理者のみ閲覧できます');
    return;
  }

  const latestRole = await getUserRoleFromFirestore(googleUserId);
  if (latestRole !== 'admin') {
    res.status(403).send('管理者のみ閲覧できます');
    return;
  }

  req.session.user = {
    ...userSession,
    role: 'admin'
  };

  req.session.save((saveError) => {
    if (saveError) {
      console.error('Failed to refresh admin role in session:', saveError);
      res.status(500).send('管理者セッションの更新に失敗しました');
      return;
    }
    next();
  });
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
  res.render('info', {
    title: 'ゆかりさん△',
    currentPage: 'info',
    ...getAuthViewData(req)
  });
});

app.get('/info', (req, res) => {
  res.render('info', {
    title: 'ゆかりさん△',
    currentPage: 'info',
    ...getAuthViewData(req)
  });
});

app.get('/users', (_req, res) => {
  res.redirect('/info');
});

import boardRouter, { refreshBoardCharaImageCache } from './routes/board';
app.use('/board', boardRouter);

app.get('/settings', (req, res) => {
  res.render('settings', {
    title: 'ゆかりさん△',
    currentPage: 'settings',
    ...getAuthViewData(req)
  });
});

app.get('/clanbattle-settings', (req, res) => {
  res.render('clanbattle-settings', {
    title: 'ゆかりさん△',
    currentPage: 'clanbattle-settings',
    ...getAuthViewData(req)
  });
});

const charaIndexPath = path.join(__dirname, '../chara/charaindex.json');
const charaDirPath = path.join(__dirname, '../chara');

type UploadFlash = {
  type: 'success' | 'error';
  message: string;
} | null;

function sanitizeUploadFileName(originalName: string): string {
  const baseName = path.basename(originalName);
  // Keep common readable characters (including Japanese) and replace forbidden path/file characters.
  return baseName.replace(/[\\/:*?"<>|]/g, '_');
}

function getUploadFlashFromQuery(req: express.Request): UploadFlash {
  const status = typeof req.query.uploadStatus === 'string' ? req.query.uploadStatus : '';
  const fileName = typeof req.query.fileName === 'string' ? req.query.fileName : '';
  const addStatus = typeof req.query.addStatus === 'string' ? req.query.addStatus : '';
  const addedFileName = typeof req.query.addedFileName === 'string' ? req.query.addedFileName : '';
  const editStatus = typeof req.query.editStatus === 'string' ? req.query.editStatus : '';
  const editedFileName = typeof req.query.editedFileName === 'string' ? req.query.editedFileName : '';
  const cacheStatus = typeof req.query.cacheStatus === 'string' ? req.query.cacheStatus : '';
  const cacheCount = typeof req.query.cacheCount === 'string' ? req.query.cacheCount : '';

  if (status === 'success' && fileName) {
    return {
      type: 'success',
      message: `${fileName} をアップロードしました。`
    };
  }

  if (status === 'invalid-type') {
    return {
      type: 'error',
      message: 'アップロードできるファイルは .png のみです。'
    };
  }

  if (status === 'missing-file') {
    return {
      type: 'error',
      message: 'アップロードする .png ファイルを選択してください。'
    };
  }

  if (status === 'failed') {
    return {
      type: 'error',
      message: 'アップロードに失敗しました。時間をおいて再試行してください。'
    };
  }

  if (addStatus === 'success' && addedFileName) {
    return {
      type: 'success',
      message: `${addedFileName} を charaindex.json に追加しました。`
    };
  }

  if (addStatus === 'missing-name') {
    return {
      type: 'error',
      message: 'キャラ名を入力してください。'
    };
  }

  if (addStatus === 'missing-file') {
    return {
      type: 'error',
      message: '対象ファイル名が指定されていません。'
    };
  }

  if (addStatus === 'invalid-file') {
    return {
      type: 'error',
      message: '指定されたファイルは未登録PNGではありません。'
    };
  }

  if (addStatus === 'already-exists') {
    return {
      type: 'error',
      message: 'そのファイルはすでに charaindex.json に登録済みです。'
    };
  }

  if (addStatus === 'failed') {
    return {
      type: 'error',
      message: 'charaindex.json への追加に失敗しました。'
    };
  }

  if (editStatus === 'success' && editedFileName) {
    return {
      type: 'success',
      message: `${editedFileName} の名前を更新しました。`
    };
  }

  if (editStatus === 'missing-name') {
    return {
      type: 'error',
      message: '変更後のキャラ名を入力してください。'
    };
  }

  if (editStatus === 'missing-file') {
    return {
      type: 'error',
      message: '更新対象のファイル名が指定されていません。'
    };
  }

  if (editStatus === 'not-found') {
    return {
      type: 'error',
      message: '更新対象が charaindex.json に見つかりませんでした。'
    };
  }

  if (editStatus === 'failed') {
    return {
      type: 'error',
      message: 'キャラ名の更新に失敗しました。'
    };
  }

  if (cacheStatus === 'success') {
    const countText = /^\d+$/.test(cacheCount) ? `（${cacheCount}件）` : '';
    return {
      type: 'success',
      message: `掲示板のキャラ画像キャッシュを再読込しました${countText}。`
    };
  }

  if (cacheStatus === 'failed') {
    return {
      type: 'error',
      message: '掲示板のキャラ画像キャッシュ再読込に失敗しました。'
    };
  }

  return null;
}

function redirectCharaAddStatus(res: express.Response, status: string, fileName?: string) {
  const encodedFileName = fileName ? encodeURIComponent(fileName) : '';
  const suffix = encodedFileName ? `&addedFileName=${encodedFileName}` : '';
  res.redirect(`/chara-check?addStatus=${status}${suffix}`);
}

function redirectCharaEditStatus(res: express.Response, status: string, fileName?: string) {
  const encodedFileName = fileName ? encodeURIComponent(fileName) : '';
  const suffix = encodedFileName ? `&editedFileName=${encodedFileName}` : '';
  res.redirect(`/chara-check?editStatus=${status}${suffix}`);
}

function loadCharaCheckData() {
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

  return {
    characters,
    unindexedImages
  };
}

function renderCharaCheckPage(req: express.Request, res: express.Response) {
  const { characters, unindexedImages } = loadCharaCheckData();
  const uploadFlash = getUploadFlashFromQuery(req);

  res.render('chara-check', {
    title: 'ゆかりさん△',
    currentPage: 'chara-check',
    ...getAuthViewData(req),
    characters,
    unindexedImages,
    uploadFlash
  });
}

const charaUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      callback(null, charaDirPath);
    },
    filename: (_req, file, callback) => {
      callback(null, sanitizeUploadFileName(file.originalname));
    }
  }),
  fileFilter: (_req, file, callback) => {
    const extensionIsPng = path.extname(file.originalname).toLowerCase() === '.png';
    const mimeIsPng = file.mimetype === 'image/png';
    if (extensionIsPng && mimeIsPng) {
      callback(null, true);
      return;
    }
    callback(new Error('Only PNG files are allowed'));
  },
  limits: {
    files: 1
  }
});

app.get('/chara-check', ensureAdmin, (req, res) => {
  renderCharaCheckPage(req, res);
});

app.post('/chara-check/upload', ensureAdmin, (req, res) => {
  charaUpload.single('charaPng')(req, res, (error: unknown) => {
    if (error) {
      console.error('Character image upload failed:', error);
      const status = error instanceof multer.MulterError ? 'failed' : 'invalid-type';
      res.redirect(`/chara-check?uploadStatus=${status}`);
      return;
    }

    const uploadedFile = req.file;
    if (!uploadedFile) {
      res.redirect('/chara-check?uploadStatus=missing-file');
      return;
    }

    const fileName = encodeURIComponent(uploadedFile.filename);
    res.redirect(`/chara-check?uploadStatus=success&fileName=${fileName}`);
  });
});

app.post('/chara-check/add', ensureAdmin, (req, res) => {
  const fileName = typeof req.body.fileName === 'string' ? req.body.fileName.trim() : '';
  const name = typeof req.body.characterName === 'string' ? req.body.characterName.trim() : '';

  if (!fileName) {
    redirectCharaAddStatus(res, 'missing-file');
    return;
  }

  if (!name) {
    redirectCharaAddStatus(res, 'missing-name');
    return;
  }

  const safeFileName = path.basename(fileName);
  const imagePath = path.join(charaDirPath, safeFileName);
  if (!safeFileName.toLowerCase().endsWith('.png') || !fs.existsSync(imagePath)) {
    redirectCharaAddStatus(res, 'invalid-file');
    return;
  }

  try {
    const raw = fs.readFileSync(charaIndexPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed) ? parsed.filter((item) => {
      return item && typeof item.fileName === 'string' && typeof item.name === 'string';
    }) as { fileName: string; name: string }[] : [];

    if (entries.some((entry) => entry.fileName === safeFileName)) {
      redirectCharaAddStatus(res, 'already-exists', safeFileName);
      return;
    }

    entries.push({
      fileName: safeFileName,
      name
    });

    fs.writeFileSync(charaIndexPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf-8');
    redirectCharaAddStatus(res, 'success', safeFileName);
  } catch (error) {
    console.error('Failed to append chara index entry:', error);
    redirectCharaAddStatus(res, 'failed');
  }
});

app.post('/chara-check/update', ensureAdmin, (req, res) => {
  const fileName = typeof req.body.fileName === 'string' ? req.body.fileName.trim() : '';
  const name = typeof req.body.characterName === 'string' ? req.body.characterName.trim() : '';

  if (!fileName) {
    redirectCharaEditStatus(res, 'missing-file');
    return;
  }

  if (!name) {
    redirectCharaEditStatus(res, 'missing-name');
    return;
  }

  const safeFileName = path.basename(fileName);

  try {
    const raw = fs.readFileSync(charaIndexPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed) ? parsed.filter((item) => {
      return item && typeof item.fileName === 'string' && typeof item.name === 'string';
    }) as { fileName: string; name: string }[] : [];

    const target = entries.find((entry) => entry.fileName === safeFileName);
    if (!target) {
      redirectCharaEditStatus(res, 'not-found', safeFileName);
      return;
    }

    target.name = name;
    fs.writeFileSync(charaIndexPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf-8');
    redirectCharaEditStatus(res, 'success', safeFileName);
  } catch (error) {
    console.error('Failed to update chara index entry:', error);
    redirectCharaEditStatus(res, 'failed');
  }
});

app.post('/chara-check/refresh-cache', ensureAdmin, (_req, res) => {
  try {
    const cacheCount = refreshBoardCharaImageCache();
    res.redirect(`/chara-check?cacheStatus=success&cacheCount=${cacheCount}`);
  } catch (error) {
    console.error('Failed to refresh board chara image cache:', error);
    res.redirect('/chara-check?cacheStatus=failed');
  }
});

type ClanListItem = {
  id: string;
  name: string;
  memberCount: number;
  bossCountText: string;
};

app.get('/clanlist', ensureAdmin, (req, res) => {
  const clanDataDirPath = path.join(__dirname, '../clandata');
  let clans: ClanListItem[] = [];

  try {
    const files = fs.readdirSync(clanDataDirPath)
      .filter((fileName) => fileName.toLowerCase().endsWith('.json'));

    clans = files.map((fileName) => {
      const clanId = fileName.replace(/\.json$/i, '');
      const filePath = path.join(clanDataDirPath, fileName);
      let parsed: any = {};

      try {
        parsed = parseClanDataJson(fs.readFileSync(filePath, 'utf-8'));
      } catch (error) {
        console.error(`Failed to parse clan data (${fileName}):`, error);
      }

      const clanName = typeof parsed?.name === 'string' && parsed.name.trim().length > 0
        ? parsed.name.trim()
        : clanId;

      const memberCount = parsed?.members && typeof parsed.members === 'object'
        ? Object.keys(parsed.members).length
        : 0;

      const bossCountText = Array.isArray(parsed?.bosscount)
        ? parsed.bosscount.map((value: unknown) => String(value)).join(', ')
        : '-';

      return {
        id: clanId,
        name: clanName,
        memberCount,
        bossCountText
      };
    }).sort((left, right) => left.name.localeCompare(right.name, 'ja'));
  } catch (error) {
    console.error('Failed to load clan data list:', error);
  }

  res.render('clanlist', {
    title: 'ゆかりさん△',
    currentPage: 'clanlist',
    ...getAuthViewData(req),
    clans
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

  res.render('clandata-detail', {
    title: 'ゆかりさん△ - クランデータ',
    currentPage: 'clandata',
    ...getAuthViewData(req),
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
