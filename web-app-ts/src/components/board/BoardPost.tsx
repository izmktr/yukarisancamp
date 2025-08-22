import React, { useState } from 'react';

const BoardPost: React.FC = () => {
  const [timelog, setTimelog] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/board/post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timelog })
    });
    if (res.ok) {
      const { id } = await res.json();
      window.location.href = `/board/${id}/edit`;
    } else {
      setError('投稿失敗');
    }
  };

  return (
    <div>
      <h2>記事投稿</h2>
      <form onSubmit={handleSubmit}>
        <textarea value={timelog} onChange={e => setTimelog(e.target.value)} rows={20} cols={80} />
        <br />
        <button type="submit">投稿</button>
      </form>
      {error && <div style={{color:'red'}}>{error}</div>}
    </div>
  );
};

export default BoardPost;
