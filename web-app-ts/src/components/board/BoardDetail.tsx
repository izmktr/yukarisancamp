import React, { useEffect, useState } from 'react';
import { BoardArticle } from './BoardList';

export type BoardDetailType = BoardArticle & {
  party: {
    name: string;
    star: number;
    level: number;
    rank: number;
  }[];
};

const BoardDetail: React.FC<{ id: string }> = ({ id }) => {
  const [article, setArticle] = useState<BoardDetailType | null>(null);

  useEffect(() => {
    fetch(`/api/board/${id}`)
      .then(res => res.json())
      .then(data => setArticle(data));
  }, [id]);

  if (!article) return <div>読み込み中...</div>;

  return (
    <div>
      <h2>記事詳細</h2>
      <div>モード: {article.mode}</div>
      <div>ダメージ: {article.damage}</div>
      <div>バトルタイム: {article.battleTime}</div>
      <div>投稿日付: {article.battleDate}</div>
      <h3>パーティ編成</h3>
      <ul>
        {article.party.map((p, i) => (
          <li key={i}>{p.name} ★{p.star} Lv{p.level} RANK{p.rank}</li>
        ))}
      </ul>
      <a href={`/board/${id}/edit`}>編集</a>
    </div>
  );
};

export default BoardDetail;
