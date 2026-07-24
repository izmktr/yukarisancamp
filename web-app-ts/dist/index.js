"use strict";
/// <reference path="./types/session.d.ts" />
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
const multer_1 = __importDefault(require("multer"));
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
function getAuthViewData(req) {
    const userSession = req.session.user;
    return {
        isLoggedIn: !!userSession,
        userName: userSession?.displayName || '',
        isAdmin: userSession?.role === 'admin'
    };
}
async function ensureAdmin(req, res, next) {
    const { isAdmin } = getAuthViewData(req);
    if (isAdmin) {
        next();
        return;
    }
    const userSession = req.session.user;
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
const board_2 = __importStar(require("./routes/board"));
app.use('/board', board_2.default);
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
const SUPABASE_CLAN_BATTLE_TABLE = 'setting_clanbattle';
const SUPABASE_USER_PROFILE_TABLE = 'setting_userprofile';
const SUPABASE_USER_OWNED_CHARACTER_TABLE = 'setting_user_owned_character';
const SUPABASE_CLAN_BATTLE_SINGLETON_ID = 0;
function getSupabaseConfig() {
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
function getSupabaseTableEndpoint(config, table) {
    return `${config.url.replace(/\/$/, '')}/rest/v1/${encodeURIComponent(table)}`;
}
function normalizeUserOwnedCharacters(rawValue) {
    if (rawValue === undefined || rawValue === null) {
        return [];
    }
    if (!Array.isArray(rawValue)) {
        return null;
    }
    const normalized = [];
    for (const entry of rawValue) {
        if (!entry || typeof entry !== 'object') {
            return null;
        }
        const item = entry;
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
function normalizeUserProfileSettingsPayload(rawValue, defaults) {
    const source = rawValue && typeof rawValue === 'object' ? rawValue : {};
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
function toUserOwnedCharacterRecords(googleUserId, characters) {
    return characters.map((character) => ({
        googleUserId,
        officialName: character.officialName,
        nickname: character.nickname,
        owned: character.owned,
        connectRank: character.connectRank
    }));
}
function buildUserProfileResponsePayload(profile, ownedCharacters) {
    return {
        ...profile,
        ownedCharacters
    };
}
async function verifyFirebaseIdTokenFromRequest(req) {
    if (!adminDb) {
        throw new Error('Authentication service is not available');
    }
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error('Authorization header with Bearer token is required');
    }
    const idToken = authHeader.slice(7);
    const decodedToken = await (0, auth_1.getAuth)().verifyIdToken(idToken);
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
async function supabaseSelectUserProfileByGoogleUserId(config, googleUserId) {
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
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) {
        return null;
    }
    return normalizeUserProfileSettingsPayload(rows[0], {
        googleUserId,
        displayName: 'ユーザー'
    });
}
async function supabaseUpsertUserProfile(config, payload) {
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
async function supabaseSelectUserOwnedCharactersByGoogleUserId(config, googleUserId) {
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
    const rows = await response.json();
    const normalized = normalizeUserOwnedCharacters(rows);
    if (!normalized) {
        throw new Error('Supabase returned invalid ownedCharacters payload');
    }
    return normalized;
}
async function supabaseReplaceUserOwnedCharacters(config, googleUserId, ownedCharacters) {
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
async function ensureUserProfileSettingsFromSupabase(config, defaults) {
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
function getBaseYearMonth(referenceDate = new Date()) {
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
function formatDateAsIsoLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
function getClanBattleDefaultDates(baseDate = new Date()) {
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
function getEmptyClanBattleState(yearmonth) {
    const defaults = getClanBattleDefaultDates();
    return {
        yearmonth,
        bossname: Array.from({ length: 5 }, () => ''),
        bossHp: Array.from({ length: 5 }, () => null),
        startDate: defaults.startDate,
        endDate: defaults.endDate
    };
}
function applyClanBattleDateDefaults(state) {
    const defaults = getClanBattleDefaultDates();
    return {
        ...state,
        startDate: state.startDate && state.startDate.trim().length > 0 ? state.startDate : defaults.startDate,
        endDate: state.endDate && state.endDate.trim().length > 0 ? state.endDate : defaults.endDate
    };
}
function isIsoDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
function normalizeClanBattleSettingsSavePayload(rawValue) {
    if (!rawValue || typeof rawValue !== 'object') {
        return null;
    }
    const source = rawValue;
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
    const bossHp = [];
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
async function supabaseSelectClanBattleState(config) {
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
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) {
        return null;
    }
    return normalizeClanBattleSettingsSavePayload(rows[0]);
}
async function supabaseUpsertClanBattleState(config, payload) {
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
async function ensureClanBattleStateFromSupabase(config) {
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
    }
    catch (error) {
        console.error('Failed to load current clanbattle settings from Supabase:', error);
        return res.status(502).json({ error: 'Failed to load clanbattle settings from Supabase' });
    }
});
app.post('/api/clanbattle-settings/save', ensureAdmin, express_1.default.json(), async (req, res) => {
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
    }
    catch (error) {
        console.error('Failed to save clanbattle settings to Supabase:', error);
        return res.status(502).json({ error: 'Failed to connect to Supabase' });
    }
});
const charaIndexPath = path_1.default.join(__dirname, '../chara/charaindex.json');
const charaDirPath = path_1.default.join(__dirname, '../chara');
function sanitizeUploadFileName(originalName) {
    const baseName = path_1.default.basename(originalName);
    // Keep common readable characters (including Japanese) and replace forbidden path/file characters.
    return baseName.replace(/[\\/:*?"<>|]/g, '_');
}
function getUploadFlashFromQuery(req) {
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
function redirectCharaAddStatus(res, status, fileName) {
    const encodedFileName = fileName ? encodeURIComponent(fileName) : '';
    const suffix = encodedFileName ? `&addedFileName=${encodedFileName}` : '';
    res.redirect(`/chara-check?addStatus=${status}${suffix}`);
}
function redirectCharaEditStatus(res, status, fileName) {
    const encodedFileName = fileName ? encodeURIComponent(fileName) : '';
    const suffix = encodedFileName ? `&editedFileName=${encodedFileName}` : '';
    res.redirect(`/chara-check?editStatus=${status}${suffix}`);
}
function loadCharaCheckData() {
    const charaIndexPath = path_1.default.join(__dirname, '../chara/charaindex.json');
    const charaDirPath = path_1.default.join(__dirname, '../chara');
    let characters = [];
    let unindexedImages = [];
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
    try {
        const indexedFileNames = new Set(characters.map((character) => character.fileName));
        unindexedImages = fs_1.default.readdirSync(charaDirPath)
            .filter((fileName) => fileName.toLowerCase().endsWith('.png'))
            .filter((fileName) => !indexedFileNames.has(fileName))
            .sort((left, right) => left.localeCompare(right, 'ja'));
    }
    catch (error) {
        console.error('Failed to scan character image directory:', error);
    }
    return {
        characters,
        unindexedImages
    };
}
function renderCharaCheckPage(req, res) {
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
const charaUpload = (0, multer_1.default)({
    storage: multer_1.default.diskStorage({
        destination: (_req, _file, callback) => {
            callback(null, charaDirPath);
        },
        filename: (_req, file, callback) => {
            callback(null, sanitizeUploadFileName(file.originalname));
        }
    }),
    fileFilter: (_req, file, callback) => {
        const extensionIsPng = path_1.default.extname(file.originalname).toLowerCase() === '.png';
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
    charaUpload.single('charaPng')(req, res, (error) => {
        if (error) {
            console.error('Character image upload failed:', error);
            const status = error instanceof multer_1.default.MulterError ? 'failed' : 'invalid-type';
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
    const safeFileName = path_1.default.basename(fileName);
    const imagePath = path_1.default.join(charaDirPath, safeFileName);
    if (!safeFileName.toLowerCase().endsWith('.png') || !fs_1.default.existsSync(imagePath)) {
        redirectCharaAddStatus(res, 'invalid-file');
        return;
    }
    try {
        const raw = fs_1.default.readFileSync(charaIndexPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const entries = Array.isArray(parsed) ? parsed.filter((item) => {
            return item && typeof item.fileName === 'string' && typeof item.name === 'string';
        }) : [];
        if (entries.some((entry) => entry.fileName === safeFileName)) {
            redirectCharaAddStatus(res, 'already-exists', safeFileName);
            return;
        }
        entries.push({
            fileName: safeFileName,
            name
        });
        fs_1.default.writeFileSync(charaIndexPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf-8');
        redirectCharaAddStatus(res, 'success', safeFileName);
    }
    catch (error) {
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
    const safeFileName = path_1.default.basename(fileName);
    try {
        const raw = fs_1.default.readFileSync(charaIndexPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const entries = Array.isArray(parsed) ? parsed.filter((item) => {
            return item && typeof item.fileName === 'string' && typeof item.name === 'string';
        }) : [];
        const target = entries.find((entry) => entry.fileName === safeFileName);
        if (!target) {
            redirectCharaEditStatus(res, 'not-found', safeFileName);
            return;
        }
        target.name = name;
        fs_1.default.writeFileSync(charaIndexPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf-8');
        redirectCharaEditStatus(res, 'success', safeFileName);
    }
    catch (error) {
        console.error('Failed to update chara index entry:', error);
        redirectCharaEditStatus(res, 'failed');
    }
});
app.post('/chara-check/refresh-cache', ensureAdmin, (_req, res) => {
    try {
        const cacheCount = (0, board_2.refreshBoardCharaImageCache)();
        res.redirect(`/chara-check?cacheStatus=success&cacheCount=${cacheCount}`);
    }
    catch (error) {
        console.error('Failed to refresh board chara image cache:', error);
        res.redirect('/chara-check?cacheStatus=failed');
    }
});
app.get('/clanlist', ensureAdmin, (req, res) => {
    const clanDataDirPath = path_1.default.join(__dirname, '../clandata');
    let clans = [];
    try {
        const files = fs_1.default.readdirSync(clanDataDirPath)
            .filter((fileName) => fileName.toLowerCase().endsWith('.json'));
        clans = files.map((fileName) => {
            const clanId = fileName.replace(/\.json$/i, '');
            const filePath = path_1.default.join(clanDataDirPath, fileName);
            let parsed = {};
            try {
                parsed = parseClanDataJson(fs_1.default.readFileSync(filePath, 'utf-8'));
            }
            catch (error) {
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
                        .map((value) => Number(value))
                        .filter((value) => Number.isFinite(value));
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
    }
    catch (error) {
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
    }
    catch (error) {
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
app.post('/api/settings/profile/save', express_1.default.json(), async (req, res) => {
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
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const hasOwnedCharactersPatch = Object.prototype.hasOwnProperty.call(body, 'ownedCharacters');
        let normalizedOwnedCharactersPatch = [];
        if (hasOwnedCharactersPatch) {
            const normalizedOwnedCharacters = normalizeUserOwnedCharacters(body.ownedCharacters);
            if (!normalizedOwnedCharacters) {
                return res.status(400).json({ error: 'Invalid payload' });
            }
            normalizedOwnedCharactersPatch = normalizedOwnedCharacters;
        }
        const patch = {
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
    }
    catch (error) {
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