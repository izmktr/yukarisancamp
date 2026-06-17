"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const BoardPost = () => {
    const [timelog, setTimelog] = (0, react_1.useState)('');
    const [error, setError] = (0, react_1.useState)('');
    const handleSubmit = async (e) => {
        e.preventDefault();
        const res = await fetch('/api/board/post', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timelog })
        });
        if (res.ok) {
            const { id } = await res.json();
            window.location.href = `/board/${id}/edit`;
        }
        else {
            setError('投稿失敗');
        }
    };
    return ((0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("h2", { children: "\u8A18\u4E8B\u6295\u7A3F" }), (0, jsx_runtime_1.jsxs)("form", { onSubmit: handleSubmit, children: [(0, jsx_runtime_1.jsx)("textarea", { value: timelog, onChange: e => setTimelog(e.target.value), rows: 20, cols: 80 }), (0, jsx_runtime_1.jsx)("br", {}), (0, jsx_runtime_1.jsx)("button", { type: "submit", children: "\u6295\u7A3F" })] }), error && (0, jsx_runtime_1.jsx)("div", { style: { color: 'red' }, children: error })] }));
};
exports.default = BoardPost;
//# sourceMappingURL=BoardPost.js.map