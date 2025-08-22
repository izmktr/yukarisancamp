import React, { useState } from 'react';
import { BoardDetailType } from './BoardDetail';

const BoardEdit: React.FC<{ article: BoardDetailType, id?: string, isNew?: boolean }> = ({ article, id, isNew }) => {
  const [editData, setEditData] = useState(article);
  const [error, setError] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setEditData(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    const res = await fetch(`/api/board/${id || 'new'}/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ article: editData })
    });
    if (res.ok) {
      window.location.href = `/board/${id || 'new'}`;
    } else {
      setError('保存失敗');
    }
  };

  return (
    <div>
      <h2>記事編集</h2>
      <div>
        <label>モード: <input name="mode" value={editData.mode} onChange={handleChange} /></label><br />
        <label>ダメージ: <input name="damage" value={editData.damage} onChange={handleChange} /></label><br />
        <label>バトルタイム: <input name="battleTime" value={editData.battleTime} onChange={handleChange} /></label><br />
        <label>投稿日付: <input name="battleDate" value={editData.battleDate} onChange={handleChange} /></label><br />
      </div>
      <button onClick={handleSave}>保存</button>
      {error && <div style={{color:'red'}}>{error}</div>}
    </div>
  );
};

export default BoardEdit;
