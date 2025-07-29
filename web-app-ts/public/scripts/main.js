// 時計の更新機能
function updateTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('ja-JP', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    
    const timeElement = document.querySelector('.time');
    if (timeElement) {
        timeElement.textContent = timeString;
    }
}

// 認証関連の機能
function handleLogin() {
    // プレースホルダー: 実際の認証システムと連携
    alert('ログイン機能は準備中です');
}

function handleLogout() {
    // プレースホルダー: 実際の認証システムと連携
    alert('ログアウト機能は準備中です');
}

// ナビゲーションのアクティブ状態管理
function setActiveTab() {
    const currentPath = window.location.pathname;
    const navLinks = document.querySelectorAll('.nav-tabs a');
    
    navLinks.forEach(link => {
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
        const timeElement = document.querySelector('.time');
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
    // ナビゲーションのアクティブ状態を設定
    setActiveTab();
    
    // 時計の初期化と定期更新
    updateTime();
    setInterval(updateTime, 1000);
    
    // ログインボタンのイベントリスナー
    const loginBtn = document.querySelector('.login-btn');
    if (loginBtn) {
        loginBtn.addEventListener('click', handleLogin);
    }
    
    // ログアウトボタンのイベントリスナー（将来用）
    const logoutBtn = document.querySelector('.logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
    
    // 現在のページに応じた初期化処理
    const currentPath = window.location.pathname;
    switch (currentPath) {
        case '/users':
            loadUserData();
            break;
        case '/board':
            // 掲示板データの読み込み
            console.log('掲示板ページが読み込まれました');
            break;
        case '/settings':
            // 設定データの読み込み
            console.log('設定ページが読み込まれました');
            break;
        default:
            // ホームページ
            console.log('ホームページが読み込まれました');
    }
});

// モバイル対応: タッチイベントの処理
document.addEventListener('touchstart', function() {
    // タッチデバイス用の追加処理があればここに実装
});

// エラーハンドリング
window.addEventListener('error', function(event) {
    console.error('JavaScript エラー:', event.error);
});

// 未処理のPromise拒否をキャッチ
window.addEventListener('unhandledrejection', function(event) {
    console.error('未処理のPromise拒否:', event.reason);
});

// デバッグ用の関数（開発時のみ使用）
function debugInfo() {
    console.log('デバッグ情報:');
    console.log('- 現在のページ:', window.location.pathname);
    console.log('- ユーザーエージェント:', navigator.userAgent);
    console.log('- 画面サイズ:', window.innerWidth + 'x' + window.innerHeight);
}
