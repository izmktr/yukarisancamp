let auth = null;
let googleProvider = null;
let db = null;
let isAuthInitialized = false;
let currentAuthUser = null;
let currentUserProfile = null;
let currentProfileLoadErrorMessage = '';

const USER_PROFILE_COLLECTION = 'userProfiles';

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getDefaultDisplayName(user) {
    return user.displayName || user.email || 'ユーザー';
}

function normalizeUserProfile(user, rawProfile) {
    const safeProfile = rawProfile || {};
    return {
        googleUserId: user.uid,
        displayName: typeof safeProfile.displayName === 'string' && safeProfile.displayName.trim().length > 0
            ? safeProfile.displayName.trim()
            : getDefaultDisplayName(user),
        discordId: safeProfile.discordId ?? null,
        discordServer: safeProfile.discordServer ?? null,
        createdAt: typeof safeProfile.createdAt === 'number' ? safeProfile.createdAt : Date.now()
    };
}

function getUserProfileDocRef(user) {
    if (!db || !user) {
        return null;
    }
    return db.collection(USER_PROFILE_COLLECTION).doc(user.uid);
}

async function ensureUserProfile(user) {
    const docRef = getUserProfileDocRef(user);
    if (!docRef) {
        return null;
    }

    const snap = await docRef.get();
    if (snap.exists) {
        const normalized = normalizeUserProfile(user, snap.data());
        return normalized;
    }

    const createdProfile = normalizeUserProfile(user, null);
    await docRef.set(createdProfile);
    return createdProfile;
}

function getLinkedDisplayValue(value) {
    if (value === null || value === undefined || value === '') {
        return '[未連携]';
    }
    return String(value);
}

function updateSettingsSaveButtonState() {
    const saveButton = document.getElementById('settings-save-button');
    const displayNameInput = document.getElementById('settings-display-name');
    if (!saveButton || !displayNameInput) {
        return;
    }

    const originalValue = displayNameInput.dataset.originalValue || '';
    const currentValue = displayNameInput.value.trim();
    const isChanged = currentValue !== originalValue;
    const canSave = isChanged && currentValue.length > 0;

    saveButton.disabled = !canSave;
}

function renderSettingsStatus(message, type) {
    const status = document.getElementById('settings-status');
    if (!status) {
        return;
    }

    status.textContent = message;
    status.classList.remove('success', 'error');
    if (type === 'success') {
        status.classList.add('success');
    }
    if (type === 'error') {
        status.classList.add('error');
    }
}

function renderSettings(user, profile) {
    const loginRequired = document.getElementById('settings-login-required');
    const firebaseError = document.getElementById('settings-firebase-error');
    const profileSection = document.getElementById('settings-profile');
    const displayNameInput = document.getElementById('settings-display-name');
    const googleIdValue = document.getElementById('settings-google-id');
    const discordIdValue = document.getElementById('settings-discord-id');
    const discordServerValue = document.getElementById('settings-discord-server');
    const createdAtValue = document.getElementById('settings-created-at');

    if (!loginRequired || !firebaseError || !profileSection || !displayNameInput || !googleIdValue || !discordIdValue || !discordServerValue || !createdAtValue) {
        return;
    }

    if (!user) {
        loginRequired.style.display = 'block';
        firebaseError.style.display = 'none';
        profileSection.style.display = 'none';
        return;
    }

    if (!profile) {
        loginRequired.style.display = 'none';
        profileSection.style.display = 'none';
        firebaseError.textContent = currentProfileLoadErrorMessage || 'Firebaseからユーザー情報を取得できませんでした。';
        firebaseError.style.display = 'block';
        return;
    }

    loginRequired.style.display = 'none';
    firebaseError.style.display = 'none';
    profileSection.style.display = 'block';

    displayNameInput.value = profile.displayName;
    displayNameInput.dataset.originalValue = profile.displayName;
    googleIdValue.textContent = profile.googleUserId;
    discordIdValue.textContent = getLinkedDisplayValue(profile.discordId);
    discordServerValue.textContent = getLinkedDisplayValue(profile.discordServer);
    createdAtValue.textContent = new Date(profile.createdAt).toLocaleString('ja-JP');
    renderSettingsStatus('', '');
    updateSettingsSaveButtonState();
}

async function saveSettingsDisplayName() {
    const displayNameInput = document.getElementById('settings-display-name');
    const saveButton = document.getElementById('settings-save-button');

    if (!displayNameInput || !saveButton || !currentAuthUser || !currentUserProfile) {
        return;
    }

    const newDisplayName = displayNameInput.value.trim();
    if (newDisplayName.length === 0) {
        renderSettingsStatus('表示名を入力してください。', 'error');
        return;
    }

    const docRef = getUserProfileDocRef(currentAuthUser);
    if (!docRef) {
        renderSettingsStatus('保存先に接続できませんでした。', 'error');
        return;
    }

    try {
        saveButton.disabled = true;
        await docRef.update({ displayName: newDisplayName });

        currentUserProfile = {
            ...currentUserProfile,
            displayName: newDisplayName
        };

        displayNameInput.dataset.originalValue = newDisplayName;
        renderAuthState(currentAuthUser, currentUserProfile);
        renderSettingsStatus('表示名を保存しました。', 'success');
        updateSettingsSaveButtonState();
    } catch (error) {
        console.error('表示名の保存に失敗しました:', error);
        renderSettingsStatus('保存に失敗しました。時間をおいて再試行してください。', 'error');
    }
}

function initializeSettingsPage() {
    const displayNameInput = document.getElementById('settings-display-name');
    const saveButton = document.getElementById('settings-save-button');

    if (!displayNameInput || !saveButton) {
        return;
    }

    displayNameInput.addEventListener('input', () => {
        updateSettingsSaveButtonState();
        renderSettingsStatus('', '');
    });

    saveButton.addEventListener('click', async () => {
        await saveSettingsDisplayName();
    });

    renderSettings(currentAuthUser, currentUserProfile);
}

function getFirebaseConfig() {
    return window.__FIREBASE_CONFIG__ || {};
}

function hasRequiredFirebaseConfig(config) {
    return Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);
}

function renderAuthState(user, profile = null) {
    const authButtons = document.querySelector('.auth-buttons');
    if (!authButtons) {
        return;
    }

    if (user) {
        const displayName = profile && profile.displayName ? profile.displayName : getDefaultDisplayName(user);
        authButtons.innerHTML = `
            <span class="user-name">こんにちは、${escapeHtml(displayName)}さん</span>
            <button class="btn btn-logout" onclick="logout()">ログアウト</button>
        `;
        return;
    }

    authButtons.innerHTML = `
        <button class="btn btn-login" onclick="loginWithGoogle()">Googleでログイン</button>
    `;
}

function initializeFirebaseAuth() {
    if (isAuthInitialized) {
        return true;
    }

    if (!window.firebase) {
        console.error('Firebase SDK が読み込まれていません。');
        return false;
    }

    const firebaseConfig = getFirebaseConfig();
    if (!hasRequiredFirebaseConfig(firebaseConfig)) {
        console.error('Firebase 設定が不足しています。', firebaseConfig);
        return false;
    }

    if (!window.firebase.apps.length) {
        window.firebase.initializeApp(firebaseConfig);
    }

    auth = window.firebase.auth();
    googleProvider = new window.firebase.auth.GoogleAuthProvider();
    db = typeof window.firebase.firestore === 'function' ? window.firebase.firestore() : null;

    if (!db) {
        console.error('Firestore SDK が読み込まれていません。');
    }

    auth.onAuthStateChanged(async (user) => {
        currentAuthUser = user;
        currentProfileLoadErrorMessage = '';

        if (user && db) {
            try {
                currentUserProfile = await ensureUserProfile(user);
            } catch (error) {
                console.error('userProfile の取得または作成に失敗しました:', error);
                currentProfileLoadErrorMessage = 'Firebaseからユーザー情報を取得できませんでした。権限設定またはネットワーク状態を確認してください。';
                currentUserProfile = null;
            }
        } else if (user && !db) {
            currentProfileLoadErrorMessage = 'Firestore SDKの初期化に失敗したため、ユーザー情報を取得できません。';
            currentUserProfile = null;
        } else {
            currentUserProfile = null;
        }

        renderAuthState(user, currentUserProfile);
        renderSettings(user, currentUserProfile);
    });

    isAuthInitialized = true;
    return true;
}

async function loginWithGoogle() {
    if (!initializeFirebaseAuth()) {
        alert('Googleログインの初期化に失敗しました。設定を確認してください。');
        return;
    }

    try {
        await auth.signInWithPopup(googleProvider);
    } catch (error) {
        console.error('Googleログイン失敗:', error);
        alert('Googleログインに失敗しました。設定またはブラウザのポップアップ制限を確認してください。');
    }
}

async function logout() {
    if (!initializeFirebaseAuth()) {
        alert('ログアウト処理を初期化できませんでした。');
        return;
    }

    try {
        await auth.signOut();
        currentAuthUser = null;
        currentUserProfile = null;
    } catch (error) {
        console.error('ログアウト失敗:', error);
        alert('ログアウトに失敗しました。');
    }
}

// グローバル参照（EJSのonclickから呼び出し）
window.loginWithGoogle = loginWithGoogle;
window.logout = logout;

// 時計の更新機能
function updateTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('ja-JP', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    const timeElement = document.getElementById('current-time');
    if (timeElement) {
        timeElement.textContent = timeString;
    }
}

// ナビゲーションのアクティブ状態管理
function setActiveTab() {
    const currentPath = window.location.pathname;
    const navLinks = document.querySelectorAll('.tab-content a');

    navLinks.forEach((link) => {
        link.classList.remove('active');
        const href = link.getAttribute('href');
        if (href === currentPath || (currentPath === '/' && href === '/')) {
            link.classList.add('active');
        }
    });
}

// API呼び出し用のヘルパー関数
async function fetchApi(endpoint) {
    try {
        const response = await fetch(`/api${endpoint}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('API fetch error:', error);
        return null;
    }
}

// 時刻データの取得と表示
async function updateTimeFromServer() {
    const data = await fetchApi('/time');
    if (data && data.time) {
        const timeElement = document.getElementById('current-time');
        if (timeElement) {
            timeElement.textContent = data.time;
        }
    }
}

// ユーザーデータの取得
async function loadUserData() {
    const data = await fetchApi('/users');
    if (data && data.users) {
        console.log('ユーザーデータ:', data.users);
        // 実際のデータ表示ロジックをここに実装
    }
}

// ページ初期化時の処理
document.addEventListener('DOMContentLoaded', function() {
    setActiveTab();

    updateTime();
    setInterval(updateTime, 1000);

    // Firebase初期化に失敗しても画面自体は利用可能にする
    initializeFirebaseAuth();
    initializeSettingsPage();

    const currentPath = window.location.pathname;
    switch (currentPath) {
        case '/users':
            loadUserData();
            break;
        case '/board':
            console.log('掲示板ページが読み込まれました');
            break;
        case '/settings':
            console.log('設定ページが読み込まれました');
            break;
        default:
            console.log('ホームページが読み込まれました');
    }
});

window.addEventListener('error', function(event) {
    console.error('JavaScript エラー:', event.error);
});

window.addEventListener('unhandledrejection', function(event) {
    console.error('未処理のPromise拒否:', event.reason);
});

function debugInfo() {
    console.log('デバッグ情報:');
    console.log('- 現在のページ:', window.location.pathname);
    console.log('- ユーザーエージェント:', navigator.userAgent);
    console.log('- 画面サイズ:', window.innerWidth + 'x' + window.innerHeight);
}
