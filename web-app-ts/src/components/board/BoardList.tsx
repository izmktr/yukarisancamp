import React, { useEffect, useState } from 'react';

export type BoardArticle = {
  id: string;
  mode: string;
  damage: number;
  battleTime: string;
  battleDate: string;
};

const BoardList: React.FC = () => {
  const [articles, setArticles] = useState<BoardArticle[]>([]);

  useEffect(() => {
    fetch('/api/board')
      .then(res => res.json())
      .then(data => setArticles(data));
  }, []);

  return (
    <div>
      <h2>掲示板記事一覧</h2>
      <table>
        <thead>
          <tr>
            <th>モード</th>
            <th>ダメージ</th>
            <th>バトルタイム</th>
            <th>投稿日付</th>
          </tr>
        </thead>
        <tbody>
          {articles.map(article => (
            <tr key={article.id}>
              <td><a href={`/board/${article.id}`}>{article.mode}</a></td>
              <td>{article.damage}</td>
              <td>{article.battleTime}</td>
              <td>{article.battleDate}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <a href="/board/post/new">新規投稿</a>
    </div>
  );
};

export default BoardList;
