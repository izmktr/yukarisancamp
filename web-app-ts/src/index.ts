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
import { randomInt } from 'crypto';
import { getBaseDate } from './utils/baseDate';
import { decrypt, encrypt } from './utils/encrypt';

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

function isNonEmptyTrimmedString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function getClanMemberRoleLabel(role: ClanMemberRow['role']): string {
  if (role === 'leader') {
    return 'マスター';
  }

  if (role === 'officer') {
    return 'サブリーダー';
  }

  return '';
}

function getClanMemberRoleSortWeight(role: ClanMemberRow['role']): number {
  if (role === 'leader') {
    return 0;
  }

  if (role === 'officer') {
    return 1;
  }

  return 2;
}

function sortClanMembersForManagement(members: ClanMemberRow[]): ClanMemberRow[] {
  return [...members].sort((left, right) => {
    const roleDiff = getClanMemberRoleSortWeight(left.role) - getClanMemberRoleSortWeight(right.role);
    if (roleDiff !== 0) {
      return roleDiff;
    }

    const nameDiff = left.name.localeCompare(right.name, 'ja');
    if (nameDiff !== 0) {
      return nameDiff;
    }

    return left.memberid.localeCompare(right.memberid, 'ja');
  });
}

async function canShowClanManagementTab(config: SupabaseConfig, googleUserId: string): Promise<boolean> {
  const profile = await supabaseSelectUserProfileByGoogleUserId(config, googleUserId);
  if (!profile || !isNonEmptyTrimmedString(profile.discordServer) || !isNonEmptyTrimmedString(profile.discordId)) {
    return false;
  }

  const clanMembers = await supabaseSelectClanMembersByDiscordServer(config, profile.discordServer);
  return clanMembers.some((member) => member.role !== 'member');
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

app.use(async (req, _res, next) => {
  const res = _res as express.Response & {
    locals: {
      clanManagementTabVisible?: boolean;
    };
  };

  res.locals.clanManagementTabVisible = false;

  if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.includes('.')) {
    next();
    return;
  }

  const config = getSupabaseConfig();
  const userSession = req.session.user as any;
  const googleUserId = typeof userSession?.googleUserId === 'string' ? userSession.googleUserId : '';
  if (!config || !googleUserId) {
    next();
    return;
  }

  try {
    res.locals.clanManagementTabVisible = await canShowClanManagementTab(config, googleUserId);
  } catch (error) {
    console.error('Failed to determine clan management tab visibility:', error);
  }

  next();
});

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
    currentMember: null,
    attackHistories: [],
    bossNames: [],
    bossHp: [],
    baseDate: getBaseDate(),
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
    const userSession = req.session.user as any;
    const googleUserId = typeof userSession?.googleUserId === 'string' ? userSession.googleUserId : '';
    const profile = googleUserId
      ? await supabaseSelectUserProfileByGoogleUserId(config, googleUserId)
      : null;
    const discordId = profile && isNonEmptyTrimmedString(profile.discordId) ? profile.discordId.trim() : '';
    const clanPageData = await loadClanPagePayload(config, discordServer, discordId);
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

app.get('/clan-data', ensureDiscordServerLinked, async (req, res) => {
  const config = getSupabaseConfig();
  const userSession = req.session.user as any;
  const googleUserId = typeof userSession?.googleUserId === 'string' ? userSession.googleUserId : '';

  if (!config || !googleUserId) {
    res.redirect('/settings');
    return;
  }

  try {
    const profile = await supabaseSelectUserProfileByGoogleUserId(config, googleUserId);
    const discordServer = profile && isNonEmptyTrimmedString(profile.discordServer)
      ? profile.discordServer.trim()
      : getSessionDiscordServer(req);

    if (!discordServer) {
      res.redirect('/settings');
      return;
    }

    const clanDataPage = await loadClanDataPagePayload(config, discordServer);
    if (!clanDataPage) {
      res.redirect('/clan');
      return;
    }

    res.render('clan-data', {
      title: 'ゆかりさん△',
      currentPage: 'clan-data',
      ...getAuthViewData(req),
      clanDataPageData: clanDataPage,
      clanId: normalizeDiscordServerToClanId(discordServer)
    });
  } catch (error) {
    console.error('Failed to load clan data page:', error);
    res.redirect('/clan');
  }
});

app.get('/clan-management', ensureDiscordServerLinked, async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  const config = getSupabaseConfig();
  const userSession = req.session.user as any;
  const googleUserId = typeof userSession?.googleUserId === 'string' ? userSession.googleUserId : '';

  if (!config || !googleUserId || !res.locals.clanManagementTabVisible) {
    res.redirect('/clan');
    return;
  }

  try {
    const profile = await supabaseSelectUserProfileByGoogleUserId(config, googleUserId);
    const discordServer = profile && isNonEmptyTrimmedString(profile.discordServer) ? profile.discordServer : getSessionDiscordServer(req);
    const clanPageData = discordServer ? await loadClanPagePayload(config, discordServer) : null;

    if (!clanPageData || !clanPageData.clan) {
      res.redirect('/clan');
      return;
    }

    res.render('clan-management', {
      title: 'ゆかりさん△',
      currentPage: 'clan-management',
      ...getAuthViewData(req),
      clanManagementData: {
        ...clanPageData,
        members: sortClanMembersForManagement(clanPageData.members)
      }
    });
  } catch (error) {
    console.error('Failed to load clan management page data:', error);
    res.redirect('/clan');
  }
});

app.post('/clan-management/members/delete', ensureDiscordServerLinked, async (req, res) => {
  const config = getSupabaseConfig();
  if (!config) {
    res.status(503).send('Supabase is not configured');
    return;
  }

  const userSession = req.session.user as any;
  const googleUserId = typeof userSession?.googleUserId === 'string' ? userSession.googleUserId : '';
  if (!googleUserId || !await canShowClanManagementTab(config, googleUserId)) {
    res.status(403).send('クラン管理権限がありません');
    return;
  }

  const profile = await supabaseSelectUserProfileByGoogleUserId(config, googleUserId);
  const discordServer = profile && isNonEmptyTrimmedString(profile.discordServer) ? profile.discordServer : getSessionDiscordServer(req);
  const clanId = normalizeDiscordServerToClanId(discordServer);
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
  const memberid = typeof body.memberid === 'string' ? body.memberid.trim() : '';
  const bodyClanId = typeof body.clanid === 'string' ? body.clanid.trim() : '';

  if (!clanId || bodyClanId !== clanId || !isEntityId(memberid)) {
    res.status(400).send('不正な削除リクエストです');
    return;
  }

  try {
    await supabaseDeleteClanMember(config, clanId, memberid);
    res.redirect(`/clan-management?updatedAt=${Date.now()}`);
  } catch (error) {
    console.error('Failed to delete clan member:', error);
    res.status(502).send('メンバーの削除に失敗しました');
  }
});

app.post('/clan-management/members/add', ensureDiscordServerLinked, async (req, res) => {
  const config = getSupabaseConfig();
  if (!config) {
    res.status(503).send('Supabase is not configured');
    return;
  }

  const userSession = req.session.user as any;
  const googleUserId = typeof userSession?.googleUserId === 'string' ? userSession.googleUserId : '';
  if (!googleUserId || !await canShowClanManagementTab(config, googleUserId)) {
    res.status(403).send('クラン管理権限がありません');
    return;
  }

  const profile = await supabaseSelectUserProfileByGoogleUserId(config, googleUserId);
  const discordServer = profile && isNonEmptyTrimmedString(profile.discordServer) ? profile.discordServer : getSessionDiscordServer(req);
  const clanId = normalizeDiscordServerToClanId(discordServer);
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';

  if (!clanId || !name) {
    res.status(400).send('名前を入力してください');
    return;
  }

  try {
    const clan = await supabaseSelectClanByDiscordServer(config, discordServer);
    if (!clan) {
      res.status(404).send('クラン情報が見つかりません');
      return;
    }

    const nextMemberId = await supabaseGenerateWebId(config);
    const now = new Date().toISOString();
    await supabaseInsertClanMember(config, {
      clanid: clanId,
      memberid: nextMemberId,
      name,
      mention: name,
      role: 'member',
      taskkill: 0,
      plan: [],
      yearmonth: '',
      attacktime: [],
      sortie: 0,
      attackboss: 0,
      attacklap: 0,
      overattack: null,
      damage: null,
      attackmessage: null,
      lastactive: now,
      created_at: now,
      updated_at: now
    });
    res.redirect(`/clan-management?updatedAt=${Date.now()}`);
  } catch (error) {
    console.error('Failed to add clan member:', error);
    res.status(502).send('メンバーの追加に失敗しました');
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
  discordServerName: string | null;
  ownedCharacters: UserOwnedCharacter[];
};

type UserOwnedCharacterRecord = UserOwnedCharacter & {
  googleUserId: string;
};

type ClanInfoRow = {
  clanid: string;
  name: string;
  bosslaps: number[];
  createdAt: string;
  updated_at: string;
};

type ClanMemberRow = {
  clanid: string;
  memberid: string;
  name: string;
  mention: string;
  role: 'member' | 'officer' | 'leader';
  taskkill: number;
  plan: number[];
  yearmonth: string;
  attacktime: Array<number | null>;
  sortie: number;
  attackboss: number;
  attacklap: number;
  overattack: number | null;
  damage: number | null;
  attackmessage: string | null;
  lastactive: string;
  created_at: string;
  updated_at: string;
};

type AttackHistoryRow = {
  id: number;
  day?: string | number | null;
  clanid?: string;
  memberid?: string;
  sortie: number;
  sortiecount?: number;
  boss: number;
  attacklap: number | null;
  overtime: number;
  defeat: boolean;
};

type ClanBossStateRow = {
  clanid: string;
  yearmonth: string;
  boss_index: number;
  current_hp: number;
  max_hp: number;
  is_defeated: boolean;
  updated_at: string;
  updated_by: string | null;
};

type ClanPagePayload = {
  discordServer: string;
  clan: ClanInfoRow | null;
  members: ClanMemberRow[];
  currentMember: ClanMemberRow | null;
  attackHistories: AttackHistoryRow[];
  bossNames: string[];
  bossHp: Array<number | null>;
  baseDate: string;
  refreshToken: string;
  loadError: string;
};

type SupabaseConfig = {
  url: string;
  secretKey: string;
};

const SUPABASE_CLAN_BATTLE_TABLE = 'setting_clanbattle';
const SUPABASE_CLAN_BATTLE_EVENT_TABLE = 'setting_clanbattle_events';
const SUPABASE_USER_PROFILE_TABLE = 'setting_userprofile';
const SUPABASE_USER_OWNED_CHARACTER_TABLE = 'setting_user_owned_character';
const SUPABASE_CLANS_TABLE = 'clans';
const SUPABASE_CLAN_MEMBERS_TABLE = 'clan_members';
const SUPABASE_CLAN_BOSS_STATE_TABLE = 'clan_boss_state';
const SUPABASE_ATTACK_HISTORIES_TABLE = 'attack_histories';
const SUPABASE_CLAN_BATTLE_SINGLETON_ID = 0;

type ClanBattleSettingEventPayload = {
  yearmonth: string;
  event_type: 'upsert';
  source: 'web-app-ts';
  triggered_by: string | null;
};

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

function isEntityId(value: string): boolean {
  return /^(?:\d+|w\d{8})$/.test(value);
}

function canAttackClanBoss(bosslaps: number[], attackBoss: number): boolean {
  return bosslaps.length === 5
    && Number.isInteger(attackBoss)
    && attackBoss >= 1
    && attackBoss <= 5
    && bosslaps[attackBoss - 1] < Math.min(...bosslaps) + 2;
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
  if (!isEntityId(clanIdText)) {
    return null;
  }

  const bosslaps = Array.isArray(source.bosslaps)
    ? source.bosslaps.map((item) => Number(item)).filter((item) => Number.isFinite(item)).map((item) => Math.trunc(item))
    : [];
  if (bosslaps.length !== 5) {
    return null;
  }

  return {
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
  const attackData = source.attackdata && typeof source.attackdata === 'object'
    ? source.attackdata as Record<string, unknown>
    : {};
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
  if (!isEntityId(clanIdText) || !isEntityId(memberIdText)) {
    return null;
  }

  const plan = Array.isArray(source.plan)
    ? source.plan.map((item) => Number(item)).filter((item) => Number.isFinite(item)).map((item) => Math.trunc(item))
    : [];

  const attacktime = Array.isArray(attackData.attacktime)
    ? attackData.attacktime.map((item) => {
      if (item === null || item === undefined || item === '') {
        return null;
      }
      const numeric = Number(item);
      return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
    })
    : [];

  const overattack = attackData.overattack === null || attackData.overattack === undefined
    ? null
    : Number.isFinite(Number(attackData.overattack))
      ? Math.trunc(Number(attackData.overattack))
      : null;

  const damage = attackData.damage === null || attackData.damage === undefined
    ? null
    : Number.isFinite(Number(attackData.damage))
      ? Math.trunc(Number(attackData.damage))
      : null;

  return {
    clanid: clanIdText,
    memberid: memberIdText,
    name: typeof source.name === 'string' ? source.name : '',
    mention: typeof source.mention === 'string' ? source.mention : '',
    role: source.role === 'officer' || source.role === 'leader' ? source.role : 'member',
    taskkill: Number.isFinite(Number(source.taskkill)) ? Math.trunc(Number(source.taskkill)) : 0,
    plan,
    yearmonth: typeof attackData.yearmonth === 'string' ? attackData.yearmonth : '',
    attacktime,
    sortie: Number.isFinite(Number(attackData.sortie)) ? Math.trunc(Number(attackData.sortie)) : 0,
    attackboss: Number.isFinite(Number(attackData.attackboss)) ? Math.trunc(Number(attackData.attackboss)) : 0,
    attacklap: Number.isFinite(Number(attackData.attacklap)) ? Math.trunc(Number(attackData.attacklap)) : 0,
    overattack,
    damage,
    attackmessage: typeof attackData.attackmessage === 'string' ? attackData.attackmessage : null,
    lastactive: toIsoStringOrEmpty(source.lastactive),
    created_at: toIsoStringOrEmpty(source.created_at),
    updated_at: toIsoStringOrEmpty(source.updated_at)
  };
}

function toClanMemberAttackData(member: ClanMemberRow): Record<string, unknown> {
  return {
    yearmonth: member.yearmonth,
    sortie: member.sortie,
    attacklap: member.attacklap,
    attackboss: member.attackboss,
    overattack: member.overattack,
    attacktime: member.attacktime,
    damage: member.damage,
    attackmessage: member.attackmessage
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

async function supabaseSelectDiscordClanName(config: SupabaseConfig, discordServer: string | null): Promise<string | null> {
  const clanId = normalizeDiscordServerToClanId(discordServer || '');
  if (!clanId) {
    return null;
  }

  const endpointUrl = getSupabaseTableEndpoint(config, SUPABASE_CLANS_TABLE);
  const query = new URLSearchParams({
    select: 'name',
    clanid: `eq.${clanId}`,
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
    throw new Error(`Supabase select Discord clan name failed: ${response.status} ${responseText}`);
  }

  const rows = await response.json() as unknown;
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }
  const row = rows[0] as Record<string, unknown>;
  return typeof row.name === 'string' && row.name.trim() ? row.name.trim() : null;
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

function normalizeAttackHistoryRow(raw: unknown): AttackHistoryRow | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const source = raw as Record<string, unknown>;
  const id = Number(source.id);
  const sortie = Number(source.sortie);
  const boss = Number(source.boss);
  const attacklap = source.attacklap === null || source.attacklap === undefined
    ? null
    : Number(source.attacklap);
  const overtime = Number(source.overtime);
  const sorteiCountValue = source.sortiecount === null || source.sortiecount === undefined
    ? undefined
    : Number(source.sortiecount);
  const dayValue = source.day === null || source.day === undefined
    ? null
    : typeof source.day === 'string' || typeof source.day === 'number'
      ? source.day
      : null;
  if (![id, sortie, boss, overtime].every(Number.isFinite)
    || (attacklap !== null && !Number.isFinite(attacklap))
    || (sorteiCountValue !== undefined && !Number.isFinite(sorteiCountValue))
    || typeof source.defeat !== 'boolean') {
    return null;
  }

  return {
    id: Math.trunc(id),
    day: dayValue,
    clanid: typeof source.clanid === 'string' || typeof source.clanid === 'number' ? String(source.clanid) : undefined,
    memberid: typeof source.memberid === 'string' || typeof source.memberid === 'number' ? String(source.memberid) : undefined,
    sortie: Math.trunc(sortie),
    sortiecount: sorteiCountValue === undefined ? undefined : Math.trunc(sorteiCountValue),
    boss: Math.trunc(boss),
    attacklap: attacklap === null ? null : Math.trunc(attacklap),
    overtime: Math.trunc(overtime),
    defeat: source.defeat
  };
}

function normalizeClanBossStateRow(raw: unknown): ClanBossStateRow | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const source = raw as Record<string, unknown>;
  const bossIndex = Number(source.boss_index);
  const currentHp = Number(source.current_hp);
  const maxHp = Number(source.max_hp);
  if (!Number.isInteger(bossIndex) || bossIndex < 1 || bossIndex > 5
    || !Number.isFinite(currentHp) || currentHp < 0
    || !Number.isFinite(maxHp) || maxHp < 0
    || typeof source.is_defeated !== 'boolean') {
    return null;
  }

  return {
    clanid: typeof source.clanid === 'string' ? source.clanid : '',
    yearmonth: typeof source.yearmonth === 'string' ? source.yearmonth : '',
    boss_index: Math.trunc(bossIndex),
    current_hp: Math.trunc(currentHp),
    max_hp: Math.trunc(maxHp),
    is_defeated: source.is_defeated,
    updated_at: typeof source.updated_at === 'string' ? source.updated_at : '',
    updated_by: typeof source.updated_by === 'string' ? source.updated_by : null
  };
}

async function supabaseSelectClanBossStates(
  config: SupabaseConfig,
  clanid: string,
  yearmonth: string
): Promise<ClanBossStateRow[]> {
  const endpointUrl = getSupabaseTableEndpoint(config, SUPABASE_CLAN_BOSS_STATE_TABLE);
  const query = new URLSearchParams({
    select: 'clanid,yearmonth,boss_index,current_hp,max_hp,is_defeated,updated_at,updated_by',
    clanid: `eq.${clanid}`,
    yearmonth: `eq.${yearmonth}`,
    order: 'boss_index.asc'
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
    throw new Error(`Supabase select clan boss state failed: ${response.status} ${responseText}`);
  }

  const rows = await response.json() as unknown;
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .map((row) => normalizeClanBossStateRow(row))
    .filter((row): row is ClanBossStateRow => !!row);
}

async function supabaseUpsertClanBossStateCurrentHp(
  config: SupabaseConfig,
  clanid: string,
  yearmonth: string,
  bossIndex: number,
  currentHp: number,
  maxHp: number,
  updatedBy: string
): Promise<void> {
  const endpointUrl = getSupabaseTableEndpoint(config, SUPABASE_CLAN_BOSS_STATE_TABLE);
  const query = new URLSearchParams({
    on_conflict: 'clanid,yearmonth,boss_index'
  });

  const response = await fetch(`${endpointUrl}?${query.toString()}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: config.secretKey,
      Authorization: `Bearer ${config.secretKey}`,
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify([{
      clanid,
      yearmonth,
      boss_index: bossIndex,
      current_hp: currentHp,
      max_hp: maxHp,
      is_defeated: currentHp <= 0,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy
    }])
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Supabase upsert clan boss state failed: ${response.status} ${responseText}`);
  }
}

async function resolveClanBossHpForDisplay(
  config: SupabaseConfig,
  clan: ClanInfoRow | null,
  clanBattleState: ClanBattleSettingsSavePayload
): Promise<Array<number | null>> {
  const fallbackBossHp = clanBattleState?.bossHp || [];
  if (!clan || !clan.clanid || !clanBattleState?.yearmonth) {
    return fallbackBossHp;
  }

  const bossStates = await supabaseSelectClanBossStates(config, clan.clanid, clanBattleState.yearmonth);
  if (bossStates.length === 0) {
    return fallbackBossHp;
  }

  const mergedBossHp = fallbackBossHp.slice(0, 5);
  while (mergedBossHp.length < 5) {
    mergedBossHp.push(null);
  }
  bossStates.forEach((row) => {
    mergedBossHp[row.boss_index - 1] = row.current_hp;
  });

  return mergedBossHp;
}

async function supabaseSelectAttackHistories(
  config: SupabaseConfig,
  member: ClanMemberRow,
  day: string
): Promise<AttackHistoryRow[]> {
  const endpointUrl = getSupabaseTableEndpoint(config, SUPABASE_ATTACK_HISTORIES_TABLE);
  const query = new URLSearchParams({
    select: 'id,day,clanid,memberid,sortie,boss,attacklap,overtime,defeat',
    memberid: `eq.${member.memberid}`,
    day: `eq.${day}`,
    order: 'sortie.asc,overtime.desc'
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
    throw new Error(`Supabase select attack histories failed: ${response.status} ${responseText}`);
  }

  const rows = await response.json() as unknown;
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .map((row) => normalizeAttackHistoryRow(row))
    .filter((row): row is AttackHistoryRow => !!row)
    .sort((left, right) => left.sortie - right.sortie || right.overtime - left.overtime);
}

function isWithinClanBattleDateRange(dayValue: string | number | null | undefined, startDate: string, endDate: string): boolean {
  const normalizedDay = String(dayValue ?? '');
  if (!normalizedDay || !startDate || !endDate) {
    return false;
  }

  return normalizedDay >= startDate && normalizedDay <= endDate;
}

async function supabaseSelectClanAttackHistories(
  config: SupabaseConfig,
  discordServer: string,
  baseDate: string,
  startDate?: string,
  endDate?: string
): Promise<AttackHistoryRow[]> {
  const clanId = normalizeDiscordServerToClanId(discordServer);
  if (!clanId || !baseDate) {
    return [];
  }

  const endpointUrl = getSupabaseTableEndpoint(config, SUPABASE_ATTACK_HISTORIES_TABLE);
  const query = new URLSearchParams({
    select: 'id,day,clanid,memberid,sortie,sortiecount,boss,attacklap,overtime,defeat',
    clanid: `eq.${clanId}`,
    order: 'day.asc,sortie.asc,overtime.asc'
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
    throw new Error(`Supabase select clan attack histories failed: ${response.status} ${responseText}`);
  }

  const rows = await response.json() as unknown;
  if (!Array.isArray(rows)) {
    return [];
  }

  const baseRangeStart = startDate && endDate ? startDate : baseDate;
  const baseRangeEnd = endDate && startDate ? endDate : baseDate;

  return rows
    .map((row) => normalizeAttackHistoryRow(row))
    .filter((row): row is AttackHistoryRow => !!row)
    .filter((row) => {
      const dayValue = String(row.day ?? '');
      return dayValue === baseDate || isWithinClanBattleDateRange(dayValue, baseRangeStart, baseRangeEnd);
    })
    .sort((left, right) => {
      const leftDay = String(left.day ?? '');
      const rightDay = String(right.day ?? '');
      if (leftDay !== rightDay) {
        return leftDay.localeCompare(rightDay);
      }
      if (left.sortie !== right.sortie) {
        return left.sortie - right.sortie;
      }
      return left.overtime - right.overtime;
    });
}

async function supabaseDeleteClanMember(
  config: SupabaseConfig,
  clanId: string,
  memberid: string
): Promise<void> {
  const endpointUrl = getSupabaseTableEndpoint(config, SUPABASE_CLAN_MEMBERS_TABLE);
  const query = new URLSearchParams({
    clanid: `eq.${clanId}`,
    memberid: `eq.${memberid}`
  });

  const response = await fetch(`${endpointUrl}?${query.toString()}`, {
    method: 'DELETE',
    headers: {
      apikey: config.secretKey,
      Authorization: `Bearer ${config.secretKey}`,
      Prefer: 'return=minimal'
    }
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Supabase delete clan member failed: ${response.status} ${responseText}`);
  }
}

async function supabaseGenerateWebId(config: SupabaseConfig): Promise<string> {
  const endpointUrl = `${config.url.replace(/\/$/, '')}/rest/v1/rpc/generate_web_id`;
  const response = await fetch(endpointUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: config.secretKey,
      Authorization: `Bearer ${config.secretKey}`
    },
    body: '{}'
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Supabase generate web id failed: ${response.status} ${responseText}`);
  }

  const webId = await response.json() as unknown;
  if (typeof webId !== 'string' || !/^w\d{8}$/.test(webId)) {
    throw new Error('Supabase generated an invalid web id');
  }
  return webId;
}

async function supabaseInsertClanMember(config: SupabaseConfig, member: ClanMemberRow): Promise<void> {
  const endpointUrl = getSupabaseTableEndpoint(config, SUPABASE_CLAN_MEMBERS_TABLE);
  const {
    sortie,
    attacklap,
    attackboss,
    overattack,
    attacktime,
    yearmonth,
    damage,
    attackmessage,
    ...memberData
  } = member;
  const response = await fetch(endpointUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: config.secretKey,
      Authorization: `Bearer ${config.secretKey}`,
      Prefer: 'return=minimal'
    },
    body: JSON.stringify([{
      ...memberData,
      attackdata: toClanMemberAttackData(member)
    }])
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Supabase insert clan member failed: ${response.status} ${responseText}`);
  }
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

async function loadClanPagePayload(
  config: SupabaseConfig,
  discordServer: string,
  currentDiscordId = ''
): Promise<ClanPagePayload> {
  const clan = await supabaseSelectClanByDiscordServer(config, discordServer);
  const [members, clanBattleState] = await Promise.all([
    supabaseSelectClanMembersByDiscordServer(config, discordServer),
    ensureClanBattleStateFromSupabase(config)
  ]);
  const bossHp = await resolveClanBossHpForDisplay(config, clan, clanBattleState);
  const currentMember = members.find((member) => (
    member.memberid === currentDiscordId
  ));
  const baseDate = getBaseDate();
  const attackHistories = currentMember
    ? await supabaseSelectAttackHistories(config, currentMember, baseDate)
    : [];
  return {
    discordServer,
    clan,
    members,
    currentMember: currentMember || null,
    attackHistories,
    bossNames: clanBattleState?.bossname || [],
    bossHp,
    baseDate,
    refreshToken: toRefreshToken(clan, members),
    loadError: ''
  };
}

async function loadClanDataPagePayload(config: SupabaseConfig, discordServer: string): Promise<{
  clan: ClanInfoRow | null;
  members: ClanMemberRow[];
  bossNames: string[];
  bossHp: Array<number | null>;
  bossHistories: AttackHistoryRow[];
  baseDate: string;
  startDate: string;
  endDate: string;
  loadError: string;
} | null> {
  const clan = await supabaseSelectClanByDiscordServer(config, discordServer);
  if (!clan) {
    return null;
  }

  const baseDate = getBaseDate();
  const clanBattleState = await ensureClanBattleStateFromSupabase(config);
  const bossHp = await resolveClanBossHpForDisplay(config, clan, clanBattleState);
  const [members, bossHistories] = await Promise.all([
    supabaseSelectClanMembersByDiscordServer(config, discordServer),
    supabaseSelectClanAttackHistories(config, discordServer, baseDate, clanBattleState.startDate, clanBattleState.endDate)
  ]);

  return {
    clan,
    members,
    bossNames: clanBattleState?.bossname || [],
    bossHp,
    bossHistories,
    baseDate,
    startDate: clanBattleState.startDate,
    endDate: clanBattleState.endDate,
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

  const clanId = typeof source.clanid === 'string'
    ? source.clanid.trim()
    : typeof source.clanid === 'number' && Number.isFinite(source.clanid)
      ? String(Math.trunc(source.clanid))
      : '';
  if (!isEntityId(clanId)) {
    return null;
  }

  return {
    clanid: clanId,
    bosslaps: normalizedBosslaps
  };
}

async function supabaseUpdateClanBosslaps(config: SupabaseConfig, clanId: string, bosslaps: number[]): Promise<void> {
  if (!isEntityId(clanId)) {
    throw new Error('Invalid clan id');
  }

  const endpointUrl = getSupabaseTableEndpoint(config, SUPABASE_CLANS_TABLE);
  const query = new URLSearchParams({
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

async function supabaseStartClanMemberAttack(
  config: SupabaseConfig,
  member: ClanMemberRow,
  attackBoss: number,
  attackLap: number,
  sortie: number,
  carryOvertime: number | null = null
): Promise<void> {
  const endpointUrl = getSupabaseTableEndpoint(config, SUPABASE_CLAN_MEMBERS_TABLE);
  const query = new URLSearchParams({
    memberid: `eq.${member.memberid}`,
    'attackdata->>attackboss': 'eq.0'
  });

  const attacktime = [...member.attacktime];
  if (carryOvertime !== null) {
    while (attacktime.length < sortie) {
      attacktime.push(null);
    }
    attacktime[sortie - 1] = carryOvertime;
  }

  const attackdata: Record<string, unknown> = {
    ...toClanMemberAttackData(member),
    attackboss: attackBoss,
    attacklap: attackLap,
    sortie,
    overattack: carryOvertime === null ? 0 : 1,
    damage: 0,
    attackmessage: ''
  };
  if (carryOvertime !== null) {
    attackdata.attacktime = attacktime;
  }
  const updatePayload = {
    attackdata,
    updated_at: new Date().toISOString()
  };

  const response = await fetch(`${endpointUrl}?${query.toString()}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: config.secretKey,
      Authorization: `Bearer ${config.secretKey}`,
      Prefer: 'return=representation'
    },
    body: JSON.stringify(updatePayload)
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Supabase start clan member attack failed: ${response.status} ${responseText}`);
  }

  const rows = await response.json() as unknown;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Attack has already started or clan member was not found');
  }
}

async function supabaseFinishClanMemberAttack(
  config: SupabaseConfig,
  member: ClanMemberRow,
  action: 'complete' | 'defeat' | 'cancel',
  overtime: number
): Promise<void> {
  const endpointUrl = `${config.url.replace(/\/$/, '')}/rest/v1/rpc/finish_clan_member_attack`;
  const response = await fetch(endpointUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: config.secretKey,
      Authorization: `Bearer ${config.secretKey}`
    },
    body: JSON.stringify({
      p_memberid: member.memberid,
      p_action: action,
      p_overtime: overtime
    })
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Supabase finish clan member attack failed: ${response.status} ${responseText}`);
  }
}

async function supabaseUpdateClanMemberAttackMessage(
  config: SupabaseConfig,
  member: ClanMemberRow,
  damage: number | null,
  attackMessage: string
): Promise<void> {
  const endpointUrl = getSupabaseTableEndpoint(config, SUPABASE_CLAN_MEMBERS_TABLE);
  const query = new URLSearchParams({
    memberid: `eq.${member.memberid}`
  });

  const attackdata: Record<string, unknown> = {
    ...toClanMemberAttackData(member),
    attackmessage: attackMessage
  };
  if (damage !== null) {
    attackdata.damage = damage;
  }
  const updatePayload = {
    attackdata,
    updated_at: new Date().toISOString()
  };

  const response = await fetch(`${endpointUrl}?${query.toString()}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: config.secretKey,
      Authorization: `Bearer ${config.secretKey}`,
      Prefer: 'return=representation'
    },
    body: JSON.stringify(updatePayload)
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Supabase update clan member attack message failed: ${response.status} ${responseText}`);
  }

  const rows = await response.json() as unknown;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Clan member was not found for attack message update');
  }
}

type AttackHistoryEditInput = {
  id: number;
  attacklap: number;
  boss: number;
  defeat: boolean;
  overtime: number;
};

function normalizeAttackHistoryEditInput(raw: unknown): AttackHistoryEditInput | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const source = raw as Record<string, unknown>;
  const id = Number(source.id);
  const attacklap = Number(source.attacklap);
  const boss = Number(source.boss);
  const defeat = source.defeat;
  const overtime = Number(source.overtime);
  if (!Number.isInteger(id) || id < 1
    || !Number.isInteger(attacklap) || attacklap < 0
    || !Number.isInteger(boss) || boss < 1 || boss > 5
    || typeof defeat !== 'boolean'
    || !Number.isInteger(overtime)
    || (defeat && overtime !== 0 && (overtime < 20 || overtime > 90))) {
    return null;
  }

  return { id, attacklap, boss, defeat, overtime: defeat ? overtime : 0 };
}

async function supabaseUpdateAttackHistory(
  config: SupabaseConfig,
  member: ClanMemberRow,
  day: string,
  input: AttackHistoryEditInput
): Promise<void> {
  const endpointUrl = getSupabaseTableEndpoint(config, SUPABASE_ATTACK_HISTORIES_TABLE);
  const query = new URLSearchParams({
    id: `eq.${input.id}`,
    memberid: `eq.${member.memberid}`,
    day: `eq.${day}`
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
      attacklap: input.attacklap,
      boss: input.boss,
      defeat: input.defeat,
      overtime: input.overtime,
      sortiecount: input.defeat ? 1 : 2,
      updatetime: new Date().toISOString()
    })
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Supabase update attack history failed: ${response.status} ${responseText}`);
  }

  const rows = await response.json() as unknown;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Attack history was not found');
  }
}

async function supabaseDeleteAttackHistory(
  config: SupabaseConfig,
  member: ClanMemberRow,
  day: string,
  historyId: number
): Promise<void> {
  const endpointUrl = `${config.url.replace(/\/$/, '')}/rest/v1/rpc/delete_clan_member_attack_history`;
  const response = await fetch(endpointUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: config.secretKey,
      Authorization: `Bearer ${config.secretKey}`
    },
    body: JSON.stringify({
      p_memberid: member.memberid,
      p_day: day,
      p_history_id: historyId
    })
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Supabase delete attack history failed: ${response.status} ${responseText}`);
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

function buildUserProfileResponsePayload(
  profile: UserProfileSettingsPayload,
  ownedCharacters: UserOwnedCharacter[],
  discordServerName: string | null
): UserProfileResponsePayload {
  return {
    ...profile,
    discordServerName,
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

async function supabaseInsertClanBattleEvent(config: SupabaseConfig, payload: ClanBattleSettingEventPayload): Promise<void> {
  const endpointUrl = `${config.url.replace(/\/$/, '')}/rest/v1/${encodeURIComponent(SUPABASE_CLAN_BATTLE_EVENT_TABLE)}`;

  const response = await fetch(endpointUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: config.secretKey,
      Authorization: `Bearer ${config.secretKey}`,
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Supabase insert clan battle event failed: ${response.status} ${responseText}`);
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

  const userSession = req.session.user as { googleUserId?: string } | undefined;
  const triggeredBy = typeof userSession?.googleUserId === 'string' ? userSession.googleUserId : null;

  try {
    await supabaseUpsertClanBattleState(config, payload);
    await supabaseInsertClanBattleEvent(config, {
      yearmonth: payload.yearmonth,
      event_type: 'upsert',
      source: 'web-app-ts',
      triggered_by: triggeredBy
    });
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
    await supabaseUpdateClanBosslaps(config, sessionClanId, payload.bosslaps);
    return res.json({ success: true });
  } catch (error) {
    console.error('Failed to save clan bosslaps:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to save clan bosslaps';
    return res.status(502).json({ error: errorMessage });
  }
});

app.post('/api/clan/attack/start', ensureDiscordServerLinked, express.json(), async (req, res) => {
  const attackBoss = Number(req.body?.attackBoss);
  if (!Number.isInteger(attackBoss) || attackBoss < 1 || attackBoss > 5) {
    return res.status(400).json({ error: 'Invalid attack boss' });
  }

  const config = getSupabaseConfig();
  if (!config) {
    return res.status(503).json({ error: 'Supabase is not configured' });
  }

  const userSession = req.session.user as any;
  const googleUserId = typeof userSession?.googleUserId === 'string' ? userSession.googleUserId : '';
  if (!googleUserId) {
    return res.status(403).json({ error: 'User is not authenticated' });
  }

  try {
    const profile = await supabaseSelectUserProfileByGoogleUserId(config, googleUserId);
    const discordId = profile && isNonEmptyTrimmedString(profile.discordId) ? profile.discordId.trim() : '';
    if (!discordId) {
      return res.status(403).json({ error: 'Discord account is not linked' });
    }

    const discordServer = getSessionDiscordServer(req);
    const [clan, members] = await Promise.all([
      supabaseSelectClanByDiscordServer(config, discordServer),
      supabaseSelectClanMembersByDiscordServer(config, discordServer)
    ]);
    if (!clan || clan.bosslaps.length !== 5) {
      return res.status(404).json({ error: 'Clan boss laps were not found' });
    }
    if (!canAttackClanBoss(clan.bosslaps, attackBoss)) {
      return res.status(409).json({ error: 'This boss cannot be attacked at its current lap' });
    }

    const currentMember = members.find((member) => (
      member.memberid === discordId
    ));
    if (!currentMember) {
      return res.status(404).json({ error: 'Clan member was not found' });
    }
    if (currentMember.attackboss !== 0) {
      return res.status(409).json({ error: 'Attack has already started' });
    }

    const attackHistories = await supabaseSelectAttackHistories(config, currentMember, getBaseDate());
    const maxSortie = attackHistories.length === 0
      ? 0
      : Math.max(...attackHistories.map((history) => history.sortie));
    if (maxSortie >= 3) {
      return res.status(409).json({ error: 'All attacks have already been completed' });
    }
    const sortie = maxSortie + 1;
    const attackLap = clan.bosslaps[attackBoss - 1];

    await supabaseStartClanMemberAttack(config, currentMember, attackBoss, attackLap, sortie);
    return res.json({ success: true });
  } catch (error) {
    console.error('Failed to start clan member attack:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to start attack';
    return res.status(502).json({ error: errorMessage });
  }
});

app.post('/api/clan/attack/carryover/start', ensureDiscordServerLinked, express.json(), async (req, res) => {
  const attackBoss = Number(req.body?.attackBoss);
  const historyId = Number(req.body?.historyId);
  if (!Number.isInteger(attackBoss) || attackBoss < 1 || attackBoss > 5
    || !Number.isInteger(historyId) || historyId < 1) {
    return res.status(400).json({ error: 'Invalid carry-over attack' });
  }

  const config = getSupabaseConfig();
  if (!config) {
    return res.status(503).json({ error: 'Supabase is not configured' });
  }

  const userSession = req.session.user as any;
  const googleUserId = typeof userSession?.googleUserId === 'string' ? userSession.googleUserId : '';
  if (!googleUserId) {
    return res.status(403).json({ error: 'User is not authenticated' });
  }

  try {
    const profile = await supabaseSelectUserProfileByGoogleUserId(config, googleUserId);
    const discordId = profile && isNonEmptyTrimmedString(profile.discordId) ? profile.discordId.trim() : '';
    if (!discordId) {
      return res.status(403).json({ error: 'Discord account is not linked' });
    }

    const discordServer = getSessionDiscordServer(req);
    const [clan, members] = await Promise.all([
      supabaseSelectClanByDiscordServer(config, discordServer),
      supabaseSelectClanMembersByDiscordServer(config, discordServer)
    ]);
    if (!clan || clan.bosslaps.length !== 5) {
      return res.status(404).json({ error: 'Clan boss laps were not found' });
    }
    if (!canAttackClanBoss(clan.bosslaps, attackBoss)) {
      return res.status(409).json({ error: 'This boss cannot be attacked at its current lap' });
    }

    const currentMember = members.find((member) => (
      member.memberid === discordId
    ));
    if (!currentMember) {
      return res.status(404).json({ error: 'Clan member was not found' });
    }
    if (currentMember.attackboss !== 0) {
      return res.status(409).json({ error: 'Attack has already started' });
    }

    const attackHistories = await supabaseSelectAttackHistories(config, currentMember, getBaseDate());
    const carryHistory = attackHistories.find((history) => history.id === historyId);
    const sameSortieCount = carryHistory
      ? attackHistories.filter((history) => history.sortie === carryHistory.sortie).length
      : 0;
    if (!carryHistory || !carryHistory.defeat || sameSortieCount !== 1
      || carryHistory.overtime < 20 || carryHistory.overtime > 90) {
      return res.status(409).json({ error: 'Carry-over attack is no longer available' });
    }

    const attackLap = clan.bosslaps[attackBoss - 1];
    await supabaseStartClanMemberAttack(
      config,
      currentMember,
      attackBoss,
      attackLap,
      carryHistory.sortie,
      carryHistory.overtime
    );
    return res.json({ success: true });
  } catch (error) {
    console.error('Failed to start carry-over attack:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to start carry-over attack';
    return res.status(502).json({ error: errorMessage });
  }
});

app.post('/api/clan/attack/finish', ensureDiscordServerLinked, express.json(), async (req, res) => {
  const action = req.body?.action;
  if (action !== 'complete' && action !== 'defeat' && action !== 'cancel') {
    return res.status(400).json({ error: 'Invalid attack action' });
  }

  const overtime = action === 'defeat' ? Number(req.body?.overtime) : 0;
  if (!Number.isInteger(overtime)) {
    return res.status(400).json({ error: 'Invalid overtime' });
  }

  const config = getSupabaseConfig();
  if (!config) {
    return res.status(503).json({ error: 'Supabase is not configured' });
  }

  const userSession = req.session.user as any;
  const googleUserId = typeof userSession?.googleUserId === 'string' ? userSession.googleUserId : '';
  if (!googleUserId) {
    return res.status(403).json({ error: 'User is not authenticated' });
  }

  try {
    const profile = await supabaseSelectUserProfileByGoogleUserId(config, googleUserId);
    const discordId = profile && isNonEmptyTrimmedString(profile.discordId) ? profile.discordId.trim() : '';
    if (!discordId) {
      return res.status(403).json({ error: 'Discord account is not linked' });
    }

    const members = await supabaseSelectClanMembersByDiscordServer(config, getSessionDiscordServer(req));
    const currentMember = members.find((member) => (
      member.memberid === discordId
    ));
    if (!currentMember) {
      return res.status(404).json({ error: 'Clan member was not found' });
    }
    if (currentMember.attackboss === 0) {
      return res.status(409).json({ error: 'Attack is not active' });
    }
    const isCarryOverAttack = currentMember.overattack === 1;
    if (action === 'defeat'
      && ((!isCarryOverAttack && (overtime < 20 || overtime > 90))
        || (isCarryOverAttack && overtime !== 0))) {
      return res.status(400).json({
        error: isCarryOverAttack
          ? 'Carry-over attack overtime must be zero'
          : 'Overtime must be between 20 and 90'
      });
    }

    await supabaseFinishClanMemberAttack(config, currentMember, action, overtime);
    return res.json({ success: true });
  } catch (error) {
    console.error('Failed to finish clan member attack:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to finish attack';
    return res.status(502).json({ error: errorMessage });
  }
});

app.post('/api/clan/attack/message', ensureDiscordServerLinked, express.json(), async (req, res) => {
  const rawDamage = req.body?.damage;
  const damage = rawDamage === undefined || rawDamage === null || rawDamage === ''
    ? null
    : Number(rawDamage);
  const attackMessage = typeof req.body?.message === 'string' ? req.body.message.trim() : '';

  if (damage !== null && (!Number.isInteger(damage) || damage < 0)) {
    return res.status(400).json({ error: 'Invalid damage' });
  }
  if (attackMessage.length > 200) {
    return res.status(400).json({ error: 'Message is too long' });
  }

  const config = getSupabaseConfig();
  if (!config) {
    return res.status(503).json({ error: 'Supabase is not configured' });
  }

  const userSession = req.session.user as any;
  const googleUserId = typeof userSession?.googleUserId === 'string' ? userSession.googleUserId : '';
  if (!googleUserId) {
    return res.status(403).json({ error: 'User is not authenticated' });
  }

  try {
    const profile = await supabaseSelectUserProfileByGoogleUserId(config, googleUserId);
    const discordId = profile && isNonEmptyTrimmedString(profile.discordId) ? profile.discordId.trim() : '';
    if (!discordId) {
      return res.status(403).json({ error: 'Discord account is not linked' });
    }

    const members = await supabaseSelectClanMembersByDiscordServer(config, getSessionDiscordServer(req));
    const currentMember = members.find((member) => (
      member.memberid === discordId
    ));
    if (!currentMember) {
      return res.status(404).json({ error: 'Clan member was not found' });
    }
    if (currentMember.attackboss === 0) {
      return res.status(409).json({ error: 'Attack is not active' });
    }

    await supabaseUpdateClanMemberAttackMessage(config, currentMember, damage, attackMessage);
    return res.json({ success: true });
  } catch (error) {
    console.error('Failed to update clan member attack message:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to update attack message';
    return res.status(502).json({ error: errorMessage });
  }
});

app.post('/api/clan/active-boss-hp/save', ensureDiscordServerLinked, express.json(), async (req, res) => {
  const hp = Number(req.body?.hp);
  if (!Number.isInteger(hp) || hp < 0) {
    return res.status(400).json({ error: 'Invalid hp' });
  }

  const config = getSupabaseConfig();
  if (!config) {
    return res.status(503).json({ error: 'Supabase is not configured' });
  }

  const userSession = req.session.user as any;
  const googleUserId = typeof userSession?.googleUserId === 'string' ? userSession.googleUserId : '';
  if (!googleUserId) {
    return res.status(403).json({ error: 'User is not authenticated' });
  }

  try {
    const profile = await supabaseSelectUserProfileByGoogleUserId(config, googleUserId);
    const discordId = profile && isNonEmptyTrimmedString(profile.discordId) ? profile.discordId.trim() : '';
    if (!discordId) {
      return res.status(403).json({ error: 'Discord account is not linked' });
    }

    const discordServer = getSessionDiscordServer(req);
    const clan = await supabaseSelectClanByDiscordServer(config, discordServer);
    if (!clan) {
      return res.status(404).json({ error: 'Clan was not found' });
    }

    const members = await supabaseSelectClanMembersByDiscordServer(config, discordServer);
    const currentMember = members.find((member) => (
      member.memberid === discordId
    ));
    if (!currentMember) {
      return res.status(404).json({ error: 'Clan member was not found' });
    }
    if (currentMember.attackboss === 0) {
      return res.status(409).json({ error: 'Attack is not active' });
    }

    const clanBattleState = await ensureClanBattleStateFromSupabase(config);
    const bossIndex = currentMember.attackboss;
    const bossStates = await supabaseSelectClanBossStates(config, clan.clanid, clanBattleState.yearmonth);
    const targetState = bossStates.find((row) => row.boss_index === bossIndex) || null;
    const settingMaxHp = Number(clanBattleState.bossHp[bossIndex - 1]);
    const resolvedMaxHp = targetState
      ? targetState.max_hp
      : Number.isFinite(settingMaxHp) && settingMaxHp >= 0
        ? Math.trunc(settingMaxHp)
        : hp;

    await supabaseUpsertClanBossStateCurrentHp(
      config,
      clan.clanid,
      clanBattleState.yearmonth,
      bossIndex,
      hp,
      resolvedMaxHp,
      discordId
    );

    return res.json({ success: true });
  } catch (error) {
    console.error('Failed to save active boss hp:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to save active boss hp';
    return res.status(502).json({ error: errorMessage });
  }
});

app.post('/api/clan/attack-history/save', ensureDiscordServerLinked, express.json(), async (req, res) => {
  const rawHistories = Array.isArray(req.body?.histories) ? req.body.histories : [];
  const histories: Array<AttackHistoryEditInput | null> = rawHistories.map(normalizeAttackHistoryEditInput);
  if (histories.length === 0 || histories.some((history) => history === null)) {
    return res.status(400).json({ error: 'Invalid attack histories' });
  }

  const config = getSupabaseConfig();
  if (!config) {
    return res.status(503).json({ error: 'Supabase is not configured' });
  }

  const userSession = req.session.user as any;
  const googleUserId = typeof userSession?.googleUserId === 'string' ? userSession.googleUserId : '';
  if (!googleUserId) {
    return res.status(403).json({ error: 'User is not authenticated' });
  }

  try {
    const profile = await supabaseSelectUserProfileByGoogleUserId(config, googleUserId);
    const discordId = profile && isNonEmptyTrimmedString(profile.discordId) ? profile.discordId.trim() : '';
    if (!discordId) {
      return res.status(403).json({ error: 'Discord account is not linked' });
    }

    const members = await supabaseSelectClanMembersByDiscordServer(config, getSessionDiscordServer(req));
    const currentMember = members.find((member) => (
      member.memberid === discordId
    ));
    if (!currentMember) {
      return res.status(404).json({ error: 'Clan member was not found' });
    }

    const day = getBaseDate();
    const currentHistories = await supabaseSelectAttackHistories(config, currentMember, day);
    for (const history of histories as AttackHistoryEditInput[]) {
      const currentHistory = currentHistories.find((item) => item.id === history.id);
      if (!currentHistory) {
        return res.status(404).json({ error: 'Attack history was not found' });
      }
      const hasSameSortieHistory = currentHistories.some((item) => (
        item.id !== currentHistory.id && item.sortie === currentHistory.sortie
      ));
      const isZeroOvertimeFixed = hasSameSortieHistory && currentHistory.overtime === 0;
      if (history.defeat && !isZeroOvertimeFixed
        && (history.overtime < 20 || history.overtime > 90)) {
        return res.status(400).json({ error: 'Overtime must be between 20 and 90' });
      }
      if (hasSameSortieHistory && currentHistory.overtime > 0
        && (!history.defeat || history.overtime < 20 || history.overtime > 90)) {
        return res.status(409).json({ error: 'Carry-over source history must remain defeated' });
      }
      if (hasSameSortieHistory && currentHistory.overtime === 0 && history.overtime !== 0) {
        return res.status(409).json({ error: 'Carry-over attack history overtime must remain zero' });
      }
    }
    for (const history of histories as AttackHistoryEditInput[]) {
      await supabaseUpdateAttackHistory(config, currentMember, day, history);
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('Failed to update attack histories:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to update attack histories';
    return res.status(502).json({ error: errorMessage });
  }
});

app.post('/api/clan/attack-history/delete', ensureDiscordServerLinked, express.json(), async (req, res) => {
  const historyId = Number(req.body?.id);
  if (!Number.isInteger(historyId) || historyId < 1) {
    return res.status(400).json({ error: 'Invalid attack history ID' });
  }

  const config = getSupabaseConfig();
  if (!config) {
    return res.status(503).json({ error: 'Supabase is not configured' });
  }

  const userSession = req.session.user as any;
  const googleUserId = typeof userSession?.googleUserId === 'string' ? userSession.googleUserId : '';
  if (!googleUserId) {
    return res.status(403).json({ error: 'User is not authenticated' });
  }

  try {
    const profile = await supabaseSelectUserProfileByGoogleUserId(config, googleUserId);
    const discordId = profile && isNonEmptyTrimmedString(profile.discordId) ? profile.discordId.trim() : '';
    if (!discordId) {
      return res.status(403).json({ error: 'Discord account is not linked' });
    }

    const members = await supabaseSelectClanMembersByDiscordServer(config, getSessionDiscordServer(req));
    const currentMember = members.find((member) => (
      member.memberid === discordId
    ));
    if (!currentMember) {
      return res.status(404).json({ error: 'Clan member was not found' });
    }

    const day = getBaseDate();
    const attackHistories = await supabaseSelectAttackHistories(config, currentMember, day);
    const targetHistory = attackHistories.find((history) => history.id === historyId);
    if (!targetHistory) {
      return res.status(404).json({ error: 'Attack history was not found' });
    }
    const hasSameSortieHistory = attackHistories.some((history) => (
      history.id !== targetHistory.id && history.sortie === targetHistory.sortie
    ));
    if (targetHistory.overtime > 0 && hasSameSortieHistory) {
      return res.status(409).json({ error: 'Carry-over source history cannot be deleted after use' });
    }

    await supabaseDeleteAttackHistory(config, currentMember, day, historyId);
    return res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete attack history:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to delete attack history';
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
    const [ownedCharacters, discordServerName] = await Promise.all([
      supabaseSelectUserOwnedCharactersByGoogleUserId(config, verified.uid),
      supabaseSelectDiscordClanName(config, profile.discordServer)
    ]);

    return res.json({ profile: buildUserProfileResponsePayload(profile, ownedCharacters, discordServerName) });
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
    const discordServerName = await supabaseSelectDiscordClanName(config, normalized.discordServer);

    return res.json({
      success: true,
      profile: buildUserProfileResponsePayload(normalized, ownedCharacters, discordServerName)
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

app.post('/api/settings/discord-link/start', async (req, res) => {
  const commonKey = process.env.YUKALINK_COMMON_KEY?.trim();
  if (!commonKey) {
    return res.status(503).json({ error: 'Discord連携用の共通鍵が設定されていません。' });
  }

  try {
    const verified = await verifyFirebaseIdTokenFromRequest(req);
    const randomValue = randomInt(100_000_000, 1_000_000_000).toString();

    req.session.discordLinkChallenge = {
      googleUserId: verified.uid,
      randomValue,
      createdAt: Date.now()
    };

    await new Promise<void>((resolve, reject) => {
      req.session.save((error) => error ? reject(error) : resolve());
    });

    return res.json({ command: `yukalink ${encrypt(randomValue, commonKey)}` });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('Authorization header') || errorMessage.includes('Invalid') || errorMessage.includes('token')) {
      return res.status(401).json({ error: errorMessage });
    }
    console.error('Failed to start Discord linking:', error);
    return res.status(502).json({ error: 'Discord連携の開始に失敗しました。' });
  }
});

app.post('/api/settings/discord-link/complete', express.json(), async (req, res) => {
  const config = getSupabaseConfig();
  const commonKey = process.env.YUKALINK_COMMON_KEY?.trim();
  if (!config || !commonKey) {
    return res.status(503).json({ error: 'Discord連携に必要なサーバー設定がありません。' });
  }

  try {
    const verified = await verifyFirebaseIdTokenFromRequest(req);
    const challenge = req.session.discordLinkChallenge;
    if (
      !challenge
      || challenge.googleUserId !== verified.uid
      || Date.now() - challenge.createdAt > 10 * 60 * 1000
    ) {
      return res.status(400).json({ error: '連携情報の有効期限が切れています。もう一度やり直してください。' });
    }

    const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
    const replyKey = typeof body.replyKey === 'string' ? body.replyKey.trim() : '';
    if (!replyKey) {
      return res.status(400).json({ error: '返信キーを入力してください。' });
    }

    const [randomValue, discordServer, discordId, ...extraValues] = decrypt(replyKey, commonKey).trimEnd().split(',');
    if (
      extraValues.length > 0
      || randomValue !== challenge.randomValue
      || !/^\d+$/.test(discordServer || '')
      || !/^\d+$/.test(discordId || '')
    ) {
      return res.status(400).json({ error: '返信キーが正しくありません。' });
    }

    const currentProfile = await ensureUserProfileSettingsFromSupabase(config, {
      googleUserId: verified.uid,
      displayName: verified.displayName
    });
    const linkedProfile: UserProfileSettingsPayload = {
      ...currentProfile,
      discordServer,
      discordId
    };
    await supabaseUpsertUserProfile(config, linkedProfile);
    delete req.session.discordLinkChallenge;
    if (req.session.user?.googleUserId === verified.uid) {
      req.session.user.discordServer = discordServer;
    }
    await new Promise<void>((resolve, reject) => {
      req.session.save((error) => error ? reject(error) : resolve());
    });

    const [ownedCharacters, discordServerName] = await Promise.all([
      supabaseSelectUserOwnedCharactersByGoogleUserId(config, verified.uid),
      supabaseSelectDiscordClanName(config, linkedProfile.discordServer)
    ]);
    return res.json({
      success: true,
      profile: buildUserProfileResponsePayload(linkedProfile, ownedCharacters, discordServerName)
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('Authorization header') || errorMessage.includes('Invalid') || errorMessage.includes('token')) {
      return res.status(401).json({ error: errorMessage });
    }
    console.error('Failed to complete Discord linking:', error);
    return res.status(400).json({ error: '返信キーを確認できませんでした。' });
  }
});

app.post('/api/settings/discord-link/unlink', async (req, res) => {
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
    const unlinkedProfile: UserProfileSettingsPayload = {
      ...currentProfile,
      discordServer: null,
      discordId: null
    };
    await supabaseUpsertUserProfile(config, unlinkedProfile);
    delete req.session.discordLinkChallenge;
    if (req.session.user?.googleUserId === verified.uid) {
      delete req.session.user.discordServer;
    }
    await new Promise<void>((resolve, reject) => {
      req.session.save((error) => error ? reject(error) : resolve());
    });

    const ownedCharacters = await supabaseSelectUserOwnedCharactersByGoogleUserId(config, verified.uid);
    return res.json({
      success: true,
      profile: buildUserProfileResponsePayload(unlinkedProfile, ownedCharacters, null)
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('Authorization header') || errorMessage.includes('Invalid') || errorMessage.includes('token')) {
      return res.status(401).json({ error: errorMessage });
    }
    console.error('Failed to unlink Discord:', error);
    return res.status(502).json({ error: 'Discord連携の解除に失敗しました。' });
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
