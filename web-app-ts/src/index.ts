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
  const discordServer = typeof userSession?.discordServer === 'string' ? userSession.discordServer.trim() : '';
  return {
    isLoggedIn: !!userSession,
    userName: userSession?.displayName || '',
    isAdmin: userSession?.role === 'admin',
    hasDiscordServer: discordServer.length > 0
  };
}

function getSessionDiscordServer(req: express.Request): string {
  const userSession = req.session.user as any;
  return typeof userSession?.discordServer === 'string' ? userSession.discordServer.trim() : '';
}

function ensureDiscordServerLinked(req: express.Request, res: express.Response, next: express.NextFunction) {
  const discordServer = getSessionDiscordServer(req);
  if (!discordServer) {
    res.redirect('/settings');
    return;
  }
  next();
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
app.locals.supabasePublicConfig = {
  url: process.env.SUPABASE_URL || '',
  publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || ''
};

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

app.get('/clan', ensureDiscordServerLinked, async (req, res) => {
  const config = getSupabaseConfig();
  const discordServer = getSessionDiscordServer(req);
  const fallbackPayload: ClanPagePayload = {
    discordServer,
    clan: null,
    members: [],
    refreshToken: 'none:0',
    loadError: ''
  };

  if (!config) {
    res.render('clan', {
      title: 'ゆかりさん△',
      currentPage: 'clan',
      ...getAuthViewData(req),
      clanPageData: {
        ...fallbackPayload,
        loadError: 'Supabase is not configured'
      }
    });
    return;
  }

  try {
    const clanPageData = await loadClanPagePayload(config, discordServer);
    res.render('clan', {
      title: 'ゆかりさん△',
      currentPage: 'clan',
      ...getAuthViewData(req),
      clanPageData
    });
  } catch (error) {
    console.error('Failed to load clan page data:', error);
    res.render('clan', {
      title: 'ゆかりさん△',
      currentPage: 'clan',
      ...getAuthViewData(req),
      clanPageData: {
        ...fallbackPayload,
        loadError: 'Supabaseからクラン情報を取得できませんでした。'
      }
    });
  }
});

type ClanBattleSettingsSavePayload = {
  yearmonth: string;
  bossname: string[];
  bossHp: Array<number | null>;
  startDate: string;
  endDate: string;
};

type UserOwnedCharacter = {
  officialName: string;
  nickname: string;
  owned: boolean;
  connectRank: number;
};

type UserProfileSettingsPayload = {
  googleUserId: string;
  discordId: string | null;
  discordServer: string | null;
  displayName: string;
  createdAt: number;
};

type UserProfileResponsePayload = UserProfileSettingsPayload & {
  ownedCharacters: UserOwnedCharacter[];
};

type UserOwnedCharacterRecord = UserOwnedCharacter & {
  googleUserId: string;
};

type ClanInfoRow = {
  source: string;
  clanid: string;
  name: string;
  bosslaps: number[];
  createdAt: string;
  updated_at: string;
};

type ClanMemberRow = {
  source: string;
  clanid: string;
  membersource: string;
  memberid: string;
  name: string;
  mention: string;
  taskkill: number;
  plan: number[];
  attacktime: Array<number | null>;
  sortie: number;
  attackboss: number;
  overattack: number | null;
  damage: number | null;
  attackmessage: string | null;
  lastactive: string;
  created_at: string;
  updated_at: string;
};

type ClanPagePayload = {
  discordServer: string;
  clan: ClanInfoRow | null;
  members: ClanMemberRow[];
  refreshToken: string;
  loadError: string;
};

type SupabaseConfig = {
  url: string;
  secretKey: string;
};

const SUPABASE_CLAN_BATTLE_TABLE = 'setting_clanbattle';
const SUPABASE_USER_PROFILE_TABLE = 'setting_userprofile';
const SUPABASE_USER_OWNED_CHARACTER_TABLE = 'setting_user_owned_character';
const SUPABASE_CLANS_TABLE = 'clans';
const SUPABASE_CLAN_MEMBERS_TABLE = 'clan_members';
const SUPABASE_CLAN_BATTLE_SINGLETON_ID = 0;

function getSupabaseConfig(): SupabaseConfig | null {
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    return null;
  }

  return {
    url,
    secretKey
  };
}

function getSupabaseTableEndpoint(config: SupabaseConfig, table: string): string {
  return `${config.url.replace(/\/$/, '')}/rest/v1/${encodeURIComponent(table)}`;
}

function normalizeDiscordServerToClanId(value: string): string {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? trimmed : '';
}

function toIsoStringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeClanInfoRow(raw: unknown): ClanInfoRow | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const source = raw as Record<string, unknown>;
  const clanIdText = typeof source.clanid === 'string'
    ? source.clanid.trim()
    : typeof source.clanid === 'number' && Number.isFinite(source.clanid)
      ? String(Math.trunc(source.clanid))
      : '';
  if (!/^\d+$/.test(clanIdText)) {
    return null;
  }

  const bosslaps = Array.isArray(source.bosslaps)
    ? source.bosslaps.map((item) => Number(item)).filter((item) => Number.isFinite(item)).map((item) => Math.trunc(item))
    : [];
  if (bosslaps.length !== 5) {
    return null;
  }

  return {
    source: typeof source.source === 'string' ? source.source : '',
    clanid: clanIdText,
    name: typeof source.name === 'string' ? source.name : '',
    bosslaps,
    createdAt: toIsoStringOrEmpty(source.createdAt),
    updated_at: toIsoStringOrEmpty(source.updated_at)
  };
}

function normalizeClanMemberRow(raw: unknown): ClanMemberRow | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const source = raw as Record<string, unknown>;
  const clanIdText = typeof source.clanid === 'string'
    ? source.clanid.trim()
    : typeof source.clanid === 'number' && Number.isFinite(source.clanid)
      ? String(Math.trunc(source.clanid))
      : '';
  const memberIdText = typeof source.memberid === 'string'
    ? source.memberid.trim()
    : typeof source.memberid === 'number' && Number.isFinite(source.memberid)
      ? String(Math.trunc(source.memberid))
      : '';
  if (!/^\d+$/.test(clanIdText) || !/^\d+$/.test(memberIdText)) {
    return null;
  }

  const plan = Array.isArray(source.plan)
    ? source.plan.map((item) => Number(item)).filter((item) => Number.isFinite(item)).map((item) => Math.trunc(item))
    : [];

  const attacktime = Array.isArray(source.attacktime)
    ? source.attacktime.map((item) => {
      if (item === null || item === undefined || item === '') {
        return null;
      }
      const numeric = Number(item);
      return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
    })
    : [];

  const overattack = source.overattack === null || source.overattack === undefined
    ? null
    : Number.isFinite(Number(source.overattack))
      ? Math.trunc(Number(source.overattack))
      : null;

  const damage = source.damage === null || source.damage === undefined
    ? null
    : Number.isFinite(Number(source.damage))
      ? Math.trunc(Number(source.damage))
      : null;

  return {
    source: typeof source.source === 'string' ? source.source : '',
    clanid: clanIdText,
    membersource: typeof source.membersource === 'string' ? source.membersource : '',
    memberid: memberIdText,
    name: typeof source.name === 'string' ? source.name : '',
    mention: typeof source.mention === 'string' ? source.mention : '',
    taskkill: Number.isFinite(Number(source.taskkill)) ? Math.trunc(Number(source.taskkill)) : 0,
    plan,
    attacktime,
    sortie: Number.isFinite(Number(source.sortie)) ? Math.trunc(Number(source.sortie)) : 0,
    attackboss: Number.isFinite(Number(source.attackboss)) ? Math.trunc(Number(source.attackboss)) : 0,
    overattack,
    damage,
    attackmessage: typeof source.attackmessage === 'string' ? source.attackmessage : null,
    lastactive: toIsoStringOrEmpty(source.lastactive),
    created_at: toIsoStringOrEmpty(source.created_at),
    updated_at: toIsoStringOrEmpty(source.updated_at)
  };
}

async function supabaseSelectClanByDiscordServer(config: SupabaseConfig, discordServer: string): Promise<ClanInfoRow | null> {
  const clanId = normalizeDiscordServerToClanId(discordServer);
  if (!clanId) {
    return null;
  }

  const endpointUrl = getSupabaseTableEndpoint(config, SUPABASE_CLANS_TABLE);
  const query = new URLSearchParams({
    select: '*',
    clanid: `eq.${clanId}`,
    order: 'updated_at.desc',
    limit: '1'
  });

  const response = await fetch(`${endpointUrl}?${query.toString()}`, {
    method: 'GET',
    headers: {
      apikey: config.secretKey,
      Authorization: `Bearer ${config.secretKey}`
    }
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Supabase select clan failed: ${response.status} ${responseText}`);
  }

  const rows = await response.json() as unknown;
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return normalizeClanInfoRow(rows[0]);
}

async function supabaseSelectClanMembersByDiscordServer(config: SupabaseConfig, discordServer: string): Promise<ClanMemberRow[]> {
  const clanId = normalizeDiscordServerToClanId(discordServer);
  if (!clanId) {
    return [];
  }

  const endpointUrl = getSupabaseTableEndpoint(config, SUPABASE_CLAN_MEMBERS_TABLE);
  const query = new URLSearchParams({
    select: '*',
    clanid: `eq.${clanId}`,
    order: 'updated_at.desc'
  });

  const response = await fetch(`${endpointUrl}?${query.toString()}`, {
    method: 'GET',
    headers: {
      apikey: config.secretKey,
      Authorization: `Bearer ${config.secretKey}`
    }
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Supabase select clan members failed: ${response.status} ${responseText}`);
  }

  const rows = await response.json() as unknown;
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .map((row) => normalizeClanMemberRow(row))
    .filter((row): row is ClanMemberRow => !!row);
}

function toRefreshToken(clan: ClanInfoRow | null, members: ClanMemberRow[]): string {
  const stamps: string[] = [];
  if (clan?.updated_at) {
    stamps.push(clan.updated_at);
  }
  for (const member of members) {
    if (member.updated_at) {
      stamps.push(member.updated_at);
    }
  }
  const latest = stamps.sort().slice(-1)[0] || 'none';
  return `${latest}:${members.length}`;
}

async function loadClanPagePayload(config: SupabaseConfig, discordServer: string): Promise<ClanPagePayload> {
  const clan = await supabaseSelectClanByDiscordServer(config, discordServer);
  const members = await supabaseSelectClanMembersByDiscordServer(config, discordServer);
  return {
    discordServer,
    clan,
    members,
    refreshToken: toRefreshToken(clan, members),
    loadError: ''
  };
}

function normalizeClanBosslapsPayload(rawValue: unknown): number[] | null {
  if (!rawValue || typeof rawValue !== 'object') {
    return null;
  }

  const source = rawValue as Record<string, unknown>;
  if (!Array.isArray(source.bosslaps) || source.bosslaps.length !== 5) {
    return null;
  }

  const normalized: number[] = [];
  for (const value of source.bosslaps) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    const truncated = Math.trunc(numeric);
    if (truncated < 1) {
      return null;
    }
    normalized.push(truncated);
  }

  const minValue = Math.min(...normalized);
  const maxValue = Math.max(...normalized);
  if ((maxValue - minValue) >= 3) {
    return null;
  }

  return normalized;
}

type ClanBosslapsSavePayload = {
  source: 'discord' | 'web';
  clanid: string;
  bosslaps: number[];
};

function normalizeClanBosslapsSavePayload(rawValue: unknown): ClanBosslapsSavePayload | null {
  if (!rawValue || typeof rawValue !== 'object') {
    return null;
  }

  const source = rawValue as Record<string, unknown>;
  const normalizedBosslaps = normalizeClanBosslapsPayload(rawValue);
  if (!normalizedBosslaps) {
    return null;
  }

  const rawSource = typeof source.source === 'string' ? source.source.trim() : '';
  if (rawSource !== 'discord' && rawSource !== 'web') {
    return null;
  }

  const clanId = typeof source.clanid === 'string'
    ? source.clanid.trim()
    : typeof source.clanid === 'number' && Number.isFinite(source.clanid)
      ? String(Math.trunc(source.clanid))
      : '';
  if (!/^\d+$/.test(clanId)) {
    return null;
  }

  return {
    source: rawSource,
    clanid: clanId,
    bosslaps: normalizedBosslaps
  };
}

async function supabaseUpdateClanBosslaps(config: SupabaseConfig, source: string, clanId: string, bosslaps: number[]): Promise<void> {
  const normalizedSource = typeof source === 'string' ? source.trim() : '';
  if (!normalizedSource) {
    throw new Error('Invalid clan source');
  }
  if (!/^\d+$/.test(clanId)) {
    throw new Error('Invalid clan id');
  }

  const endpointUrl = getSupabaseTableEndpoint(config, SUPABASE_CLANS_TABLE);
  const query = new URLSearchParams({
    source: `eq.${normalizedSource}`,
    clanid: `eq.${clanId}`
  });

  const response = await fetch(`${endpointUrl}?${query.toString()}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: config.secretKey,
      Authorization: `Bearer ${config.secretKey}`,
      Prefer: 'return=representation'
    },
    body: JSON.stringify({
      bosslaps,
      updated_at: new Date().toISOString()
    })
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Supabase update clan bosslaps failed: ${response.status} ${responseText}`);
  }

  const rows = await response.json() as unknown;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Supabase update clan bosslaps matched 0 rows');
  }
}

function normalizeUserOwnedCharacters(rawValue: unknown): UserOwnedCharacter[] | null {
  if (rawValue === undefined || rawValue === null) {
    return [];
  }

  if (!Array.isArray(rawValue)) {
    return null;
  }

  const normalized: UserOwnedCharacter[] = [];
  for (const entry of rawValue) {
    if (!entry || typeof entry !== 'object') {
      return null;
    }

    const item = entry as Record<string, unknown>;
    if (typeof item.officialName !== 'string' || typeof item.nickname !== 'string' || typeof item.owned !== 'boolean') {
      return null;
    }

    const connectRankNumber = Number(item.connectRank);
    if (!Number.isFinite(connectRankNumber)) {
      return null;
    }

    normalized.push({
      officialName: item.officialName.trim(),
      nickname: item.nickname.trim(),
      owned: item.owned,
      connectRank: Math.trunc(connectRankNumber)
    });
  }

  return normalized;
}

function normalizeUserProfileSettingsPayload(rawValue: unknown, defaults: { googleUserId: string; displayName: string }): UserProfileSettingsPayload | null {
  const source = rawValue && typeof rawValue === 'object' ? rawValue as Record<string, unknown> : {};

  const googleUserIdRaw = typeof source.googleUserId === 'string' && source.googleUserId.trim().length > 0
    ? source.googleUserId.trim()
    : defaults.googleUserId;
  if (!googleUserIdRaw) {
    return null;
  }

  const displayNameRaw = typeof source.displayName === 'string' && source.displayName.trim().length > 0
    ? source.displayName.trim()
    : defaults.displayName;
  if (!displayNameRaw) {
    return null;
  }

  const discordIdRaw = source.discordId;
  const discordServerRaw = source.discordServer;

  const discordId = typeof discordIdRaw === 'string'
    ? discordIdRaw
    : discordIdRaw === null || typeof discordIdRaw === 'undefined'
      ? null
      : null;

  const discordServer = typeof discordServerRaw === 'string'
    ? discordServerRaw
    : discordServerRaw === null || typeof discordServerRaw === 'undefined'
      ? null
      : null;

  const createdAtRaw = source.createdAt;
  const createdAtNumber = Number(createdAtRaw);

  return {
    googleUserId: googleUserIdRaw,
    discordId,
    discordServer,
    displayName: displayNameRaw,
    createdAt: Number.isFinite(createdAtNumber) ? createdAtNumber : Date.now()
  };
}

function toUserOwnedCharacterRecords(googleUserId: string, characters: UserOwnedCharacter[]): UserOwnedCharacterRecord[] {
  return characters.map((character) => ({
    googleUserId,
    officialName: character.officialName,
    nickname: character.nickname,
    owned: character.owned,
    connectRank: character.connectRank
  }));
}

function buildUserProfileResponsePayload(profile: UserProfileSettingsPayload, ownedCharacters: UserOwnedCharacter[]): UserProfileResponsePayload {
  return {
    ...profile,
    ownedCharacters
  };
}

async function verifyFirebaseIdTokenFromRequest(req: express.Request): Promise<{ uid: string; displayName: string }> {
  if (!adminDb) {
    throw new Error('Authentication service is not available');
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Authorization header with Bearer token is required');
  }

  const idToken = authHeader.slice(7);
  const decodedToken = await getAuth().verifyIdToken(idToken);
  const uid = typeof decodedToken.uid === 'string' ? decodedToken.uid : '';
  if (!uid) {
    throw new Error('Invalid ID token payload');
  }

  const displayName = typeof decodedToken.name === 'string' && decodedToken.name.trim().length > 0
    ? decodedToken.name.trim()
    : typeof decodedToken.email === 'string' && decodedToken.email.trim().length > 0
      ? decodedToken.email.trim()
      : 'ユーザー';

  return { uid, displayName };
}

async function supabaseSelectUserProfileByGoogleUserId(config: SupabaseConfig, googleUserId: string): Promise<UserProfileSettingsPayload | null> {
  const endpointUrl = getSupabaseTableEndpoint(config, SUPABASE_USER_PROFILE_TABLE);
  const query = new URLSearchParams({
    select: '*',
    googleUserId: `eq.${googleUserId}`,
    limit: '1'
  });

  const response = await fetch(`${endpointUrl}?${query.toString()}`, {
    method: 'GET',
    headers: {
      apikey: config.secretKey,
      Authorization: `Bearer ${config.secretKey}`
    }
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Supabase select user profile failed: ${response.status} ${responseText}`);
  }

  const rows = await response.json() as unknown;
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return normalizeUserProfileSettingsPayload(rows[0], {
    googleUserId,
    displayName: 'ユーザー'
  });
}

async function supabaseUpsertUserProfile(config: SupabaseConfig, payload: UserProfileSettingsPayload): Promise<void> {
  const endpointUrl = getSupabaseTableEndpoint(config, SUPABASE_USER_PROFILE_TABLE);

  const response = await fetch(endpointUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: config.secretKey,
      Authorization: `Bearer ${config.secretKey}`,
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Supabase upsert user profile failed: ${response.status} ${responseText}`);
  }
}

async function supabaseSelectUserOwnedCharactersByGoogleUserId(config: SupabaseConfig, googleUserId: string): Promise<UserOwnedCharacter[]> {
  const endpointUrl = getSupabaseTableEndpoint(config, SUPABASE_USER_OWNED_CHARACTER_TABLE);
  const query = new URLSearchParams({
    select: '*',
    googleUserId: `eq.${googleUserId}`
  });

  const response = await fetch(`${endpointUrl}?${query.toString()}`, {
    method: 'GET',
    headers: {
      apikey: config.secretKey,
      Authorization: `Bearer ${config.secretKey}`
    }
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Supabase select user owned characters failed: ${response.status} ${responseText}`);
  }

  const rows = await response.json() as unknown;
  const normalized = normalizeUserOwnedCharacters(rows);
  if (!normalized) {
    throw new Error('Supabase returned invalid ownedCharacters payload');
  }

  return normalized;
}

async function supabaseReplaceUserOwnedCharacters(config: SupabaseConfig, googleUserId: string, ownedCharacters: UserOwnedCharacter[]): Promise<void> {
  const endpointUrl = getSupabaseTableEndpoint(config, SUPABASE_USER_OWNED_CHARACTER_TABLE);
  const deleteQuery = new URLSearchParams({
    googleUserId: `eq.${googleUserId}`
  });

  const deleteResponse = await fetch(`${endpointUrl}?${deleteQuery.toString()}`, {
    method: 'DELETE',
    headers: {
      apikey: config.secretKey,
      Authorization: `Bearer ${config.secretKey}`,
      Prefer: 'return=minimal'
    }
  });

  if (!deleteResponse.ok) {
    const responseText = await deleteResponse.text();
    throw new Error(`Supabase delete user owned characters failed: ${deleteResponse.status} ${responseText}`);
  }

  if (ownedCharacters.length === 0) {
    return;
  }

  const rows = toUserOwnedCharacterRecords(googleUserId, ownedCharacters);
  const insertResponse = await fetch(endpointUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: config.secretKey,
      Authorization: `Bearer ${config.secretKey}`,
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(rows)
  });

  if (!insertResponse.ok) {
    const responseText = await insertResponse.text();
    throw new Error(`Supabase insert user owned characters failed: ${insertResponse.status} ${responseText}`);
  }
}

async function ensureUserProfileSettingsFromSupabase(
  config: SupabaseConfig,
  defaults: { googleUserId: string; displayName: string }
): Promise<UserProfileSettingsPayload> {
  const existing = await supabaseSelectUserProfileByGoogleUserId(config, defaults.googleUserId);
  if (existing) {
    return existing;
  }

  const created = normalizeUserProfileSettingsPayload({}, defaults);
  if (!created) {
    throw new Error('Failed to construct default user profile payload');
  }

  await supabaseUpsertUserProfile(config, created);
  return created;
}

function getBaseYearMonth(referenceDate = new Date()): string {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const monthEndDate = new Date(year, month + 1, 0).getDate();
  const currentMonthThreshold = monthEndDate - 9;
  const baseDate = referenceDate.getDate() > currentMonthThreshold
    ? referenceDate
    : new Date(year, month, 0);

  const baseYear = baseDate.getFullYear();
  const baseMonth = String(baseDate.getMonth() + 1).padStart(2, '0');
  return `${baseYear}${baseMonth}`;
}

function formatDateAsIsoLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getClanBattleDefaultDates(baseDate = new Date()): { startDate: string; endDate: string } {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const lastDay = new Date(year, month + 1, 0);

  const startDate = new Date(lastDay);
  startDate.setDate(lastDay.getDate() - 5);

  const endDate = new Date(lastDay);
  endDate.setDate(lastDay.getDate() - 1);

  return {
    startDate: formatDateAsIsoLocal(startDate),
    endDate: formatDateAsIsoLocal(endDate)
  };
}

function getEmptyClanBattleState(yearmonth: string): ClanBattleSettingsSavePayload {
  const defaults = getClanBattleDefaultDates();
  return {
    yearmonth,
    bossname: Array.from({ length: 5 }, () => ''),
    bossHp: Array.from({ length: 5 }, () => null),
    startDate: defaults.startDate,
    endDate: defaults.endDate
  };
}

function applyClanBattleDateDefaults(state: ClanBattleSettingsSavePayload): ClanBattleSettingsSavePayload {
  const defaults = getClanBattleDefaultDates();
  return {
    ...state,
    startDate: state.startDate && state.startDate.trim().length > 0 ? state.startDate : defaults.startDate,
    endDate: state.endDate && state.endDate.trim().length > 0 ? state.endDate : defaults.endDate
  };
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeClanBattleSettingsSavePayload(rawValue: unknown): ClanBattleSettingsSavePayload | null {
  if (!rawValue || typeof rawValue !== 'object') {
    return null;
  }

  const source = rawValue as Record<string, unknown>;
  const yearmonth = typeof source.yearmonth === 'string' ? source.yearmonth.trim() : '';
  const bossnameSource = Array.isArray(source.bossname) ? source.bossname : [];
  const bossHpSource = Array.isArray(source.bossHp) ? source.bossHp : [];

  if (!/^\d{6}$/.test(yearmonth)) {
    return null;
  }

  if (bossnameSource.length !== 5 || bossHpSource.length !== 5) {
    return null;
  }

  const bossname = bossnameSource.map((value) => {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value).trim();
  });

  const bossHp: Array<number | null> = [];
  for (const value of bossHpSource) {
    if (value === null || value === undefined || value === '') {
      bossHp.push(null);
      continue;
    }

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return null;
    }
    bossHp.push(Math.trunc(numericValue));
  }

  const startDate = source.startDate;
  const endDate = source.endDate;
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    return null;
  }

  return {
    yearmonth,
    bossname,
    bossHp,
    startDate,
    endDate
  };
}

async function supabaseSelectClanBattleState(config: SupabaseConfig): Promise<ClanBattleSettingsSavePayload | null> {
  const endpointUrl = `${config.url.replace(/\/$/, '')}/rest/v1/${encodeURIComponent(SUPABASE_CLAN_BATTLE_TABLE)}`;
  const query = new URLSearchParams({
    select: '*',
    id: `eq.${SUPABASE_CLAN_BATTLE_SINGLETON_ID}`,
    limit: '1'
  });

  const response = await fetch(`${endpointUrl}?${query.toString()}`, {
    method: 'GET',
    headers: {
      apikey: config.secretKey,
      Authorization: `Bearer ${config.secretKey}`
    }
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Supabase select failed: ${response.status} ${responseText}`);
  }

  const rows = await response.json() as unknown;
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return normalizeClanBattleSettingsSavePayload(rows[0]);
}

async function supabaseUpsertClanBattleState(config: SupabaseConfig, payload: ClanBattleSettingsSavePayload): Promise<void> {
  const endpointUrl = `${config.url.replace(/\/$/, '')}/rest/v1/${encodeURIComponent(SUPABASE_CLAN_BATTLE_TABLE)}`;

  const response = await fetch(endpointUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: config.secretKey,
      Authorization: `Bearer ${config.secretKey}`,
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify({
      id: SUPABASE_CLAN_BATTLE_SINGLETON_ID,
      ...payload
    })
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Supabase upsert failed: ${response.status} ${responseText}`);
  }
}

async function ensureClanBattleStateFromSupabase(config: SupabaseConfig): Promise<ClanBattleSettingsSavePayload> {
  const currentState = await supabaseSelectClanBattleState(config);
  if (currentState) {
    const normalizedCurrent = applyClanBattleDateDefaults(currentState);
    if (normalizedCurrent.startDate !== currentState.startDate || normalizedCurrent.endDate !== currentState.endDate) {
      await supabaseUpsertClanBattleState(config, normalizedCurrent);
    }
    return normalizedCurrent;
  }

  const initialState = getEmptyClanBattleState(getBaseYearMonth());
  const initialStateWithDefaults = applyClanBattleDateDefaults(initialState);
  await supabaseUpsertClanBattleState(config, initialStateWithDefaults);
  return initialStateWithDefaults;
}

app.get('/api/clanbattle-settings/current', async (req, res) => {
  const config = getSupabaseConfig();
  if (!config) {
    return res.status(503).json({ error: 'Supabase is not configured' });
  }

  try {
    const state = await ensureClanBattleStateFromSupabase(config);
    return res.json({ state });
  } catch (error) {
    console.error('Failed to load current clanbattle settings from Supabase:', error);
    return res.status(502).json({ error: 'Failed to load clanbattle settings from Supabase' });
  }
});

app.post('/api/clanbattle-settings/save', ensureAdmin, express.json(), async (req, res) => {
  const payload = normalizeClanBattleSettingsSavePayload(req.body);
  if (!payload) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const config = getSupabaseConfig();
  if (!config) {
    return res.status(503).json({ error: 'Supabase is not configured' });
  }

  try {
    await supabaseUpsertClanBattleState(config, payload);
    return res.json({ success: true });
  } catch (error) {
    console.error('Failed to save clanbattle settings to Supabase:', error);
    return res.status(502).json({ error: 'Failed to connect to Supabase' });
  }
});

app.get('/api/clan/refresh-token', ensureDiscordServerLinked, async (req, res) => {
  const config = getSupabaseConfig();
  if (!config) {
    return res.status(503).json({ error: 'Supabase is not configured' });
  }

  try {
    const discordServer = getSessionDiscordServer(req);
    const payload = await loadClanPagePayload(config, discordServer);
    return res.json({ refreshToken: payload.refreshToken });
  } catch (error) {
    console.error('Failed to load clan refresh token:', error);
    return res.status(502).json({ error: 'Failed to load clan refresh token' });
  }
});

app.post('/api/clan/bosslaps/save', ensureDiscordServerLinked, express.json(), async (req, res) => {
  const payload = normalizeClanBosslapsSavePayload(req.body);
  if (!payload) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const sessionClanId = normalizeDiscordServerToClanId(getSessionDiscordServer(req));
  if (!sessionClanId) {
    return res.status(403).json({ error: 'Invalid session clan id' });
  }

  const config = getSupabaseConfig();
  if (!config) {
    return res.status(503).json({ error: 'Supabase is not configured' });
  }

  try {
    await supabaseUpdateClanBosslaps(config, payload.source, sessionClanId, payload.bosslaps);
    return res.json({ success: true });
  } catch (error) {
    console.error('Failed to save clan bosslaps:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to save clan bosslaps';
    return res.status(502).json({ error: errorMessage });
  }
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
        ? (() => {
            const numericBossCounts = parsed.bosscount
              .map((value: unknown) => Number(value))
              .filter((value: number) => Number.isFinite(value));

            if (numericBossCounts.length === 0) {
              return '-';
            }

            const maxBossCount = Math.max(...numericBossCounts);
            return String(maxBossCount + 1);
          })()
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

app.get('/api/settings/profile/current', async (req, res) => {
  const config = getSupabaseConfig();
  if (!config) {
    return res.status(503).json({ error: 'Supabase is not configured' });
  }

  try {
    const verified = await verifyFirebaseIdTokenFromRequest(req);
    const profile = await ensureUserProfileSettingsFromSupabase(config, {
      googleUserId: verified.uid,
      displayName: verified.displayName
    });
    const ownedCharacters = await supabaseSelectUserOwnedCharactersByGoogleUserId(config, verified.uid);

    return res.json({ profile: buildUserProfileResponsePayload(profile, ownedCharacters) });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('Authorization header') || errorMessage.includes('Invalid') || errorMessage.includes('token')) {
      return res.status(401).json({ error: errorMessage });
    }

    if (errorMessage.includes('Authentication service is not available')) {
      return res.status(503).json({ error: errorMessage });
    }

    console.error('Failed to load settings profile from Supabase:', error);
    return res.status(502).json({ error: errorMessage || 'Failed to load settings profile from Supabase' });
  }
});

app.post('/api/settings/profile/save', express.json(), async (req, res) => {
  const config = getSupabaseConfig();
  if (!config) {
    return res.status(503).json({ error: 'Supabase is not configured' });
  }

  try {
    const verified = await verifyFirebaseIdTokenFromRequest(req);
    const currentProfile = await ensureUserProfileSettingsFromSupabase(config, {
      googleUserId: verified.uid,
      displayName: verified.displayName
    });

    const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
    const hasOwnedCharactersPatch = Object.prototype.hasOwnProperty.call(body, 'ownedCharacters');
    let normalizedOwnedCharactersPatch: UserOwnedCharacter[] = [];

    if (hasOwnedCharactersPatch) {
      const normalizedOwnedCharacters = normalizeUserOwnedCharacters(body.ownedCharacters);
      if (!normalizedOwnedCharacters) {
        return res.status(400).json({ error: 'Invalid payload' });
      }
      normalizedOwnedCharactersPatch = normalizedOwnedCharacters;
    }

    const patch: Record<string, unknown> = {
      ...currentProfile
    };

    if (Object.prototype.hasOwnProperty.call(body, 'displayName')) {
      patch.displayName = body.displayName;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'discordId')) {
      patch.discordId = body.discordId;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'discordServer')) {
      patch.discordServer = body.discordServer;
    }

    const normalized = normalizeUserProfileSettingsPayload(patch, {
      googleUserId: verified.uid,
      displayName: currentProfile.displayName
    });

    if (!normalized) {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    await supabaseUpsertUserProfile(config, normalized);

    if (hasOwnedCharactersPatch) {
      await supabaseReplaceUserOwnedCharacters(config, verified.uid, normalizedOwnedCharactersPatch);
    }

    const ownedCharacters = hasOwnedCharactersPatch
      ? normalizedOwnedCharactersPatch
      : await supabaseSelectUserOwnedCharactersByGoogleUserId(config, verified.uid);

    return res.json({
      success: true,
      profile: buildUserProfileResponsePayload(normalized, ownedCharacters)
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('Authorization header') || errorMessage.includes('Invalid') || errorMessage.includes('token')) {
      return res.status(401).json({ error: errorMessage });
    }

    if (errorMessage.includes('Authentication service is not available')) {
      return res.status(503).json({ error: errorMessage });
    }

    console.error('Failed to save settings profile to Supabase:', error);
    return res.status(502).json({ error: errorMessage || 'Failed to save settings profile to Supabase' });
  }
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
    const discordServer = typeof req.body?.discordServer === 'string' ? req.body.discordServer.trim() : '';

    // role は Firestore から取得（トークンの uid で検索）
    const role = await getUserRoleFromFirestore(googleUserId);

    // セッションにユーザー情報を保存
    req.session.user = {
      googleUserId,
      displayName: displayName || 'ユーザー',
      role,
      discordServer
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
