import express from 'express';
import path from 'path';
import expressLayouts from 'express-ejs-layouts';
import { UserProfile } from './types';

const app = express();
const port = 3000;

// EJSレイアウトの設定
app.use(expressLayouts);
app.set('layout', 'layout');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// 静的ファイルの設定
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

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

app.get('/board', (req, res) => {
  res.render('board', { 
    title: 'ゆかりさん△',
    currentPage: 'board',
    isLoggedIn: false,
    userName: ''
  });
});

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
