import { UserProfile } from './types';

console.log('Web app starting...');

// 型定義のテスト
const sampleUser: UserProfile = {
  userId: "123456789",
  displayName: "テストユーザー",
  createdAt: Date.now(),
  favoriteThings: ["プリコネ", "クラバト"]
};

console.log('Sample user:', sampleUser);

// Express.jsを使ったWebサーバーの例（必要に応じてコメントアウト解除）
/*
import express from 'express';

const app = express();
const port = 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'Hello World!', user: sampleUser });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
*/
