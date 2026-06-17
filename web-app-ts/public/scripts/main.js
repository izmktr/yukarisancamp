let auth = null;
let googleProvider = null;
let isAuthInitialized = false;

function getFirebaseConfig() {
    return window.__FIREBASE_CONFIG__ || {};
}

function hasRequiredFirebaseConfig(config) {
    return Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);
}

function renderAuthState(user) {
    const authButtons = document.querySelector('.auth-buttons');
    if (!authButtons) {
        return;
    }

    if (user) {
        const userName = user.displayName || user.email || 'ユーザー';
        authButtons.innerHTML = `
            <span class="user-name">こんにちは、${userName}さん</span>
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

    auth.onAuthStateChanged((user) => {
        renderAuthState(user);
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
