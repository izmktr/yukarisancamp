"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const BoardEdit = ({ article, id, isNew }) => {
    const [editData, setEditData] = (0, react_1.useState)(article);
    const [error, setError] = (0, react_1.useState)('');
    const handleChange = (e) => {
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
        }
        else {
            setError('保存失敗');
        }
    };
    return ((0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("h2", { children: "\u8A18\u4E8B\u7DE8\u96C6" }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsxs)("label", { children: ["\u30E2\u30FC\u30C9: ", (0, jsx_runtime_1.jsx)("input", { name: "mode", value: editData.mode, onChange: handleChange })] }), (0, jsx_runtime_1.jsx)("br", {}), (0, jsx_runtime_1.jsxs)("label", { children: ["\u30C0\u30E1\u30FC\u30B8: ", (0, jsx_runtime_1.jsx)("input", { name: "damage", value: editData.damage, onChange: handleChange })] }), (0, jsx_runtime_1.jsx)("br", {}), (0, jsx_runtime_1.jsxs)("label", { children: ["\u30D0\u30C8\u30EB\u30BF\u30A4\u30E0: ", (0, jsx_runtime_1.jsx)("input", { name: "battleTime", value: editData.battleTime, onChange: handleChange })] }), (0, jsx_runtime_1.jsx)("br", {}), (0, jsx_runtime_1.jsxs)("label", { children: ["\u6295\u7A3F\u65E5\u4ED8: ", (0, jsx_runtime_1.jsx)("input", { name: "battleDate", value: editData.battleDate, onChange: handleChange })] }), (0, jsx_runtime_1.jsx)("br", {})] }), (0, jsx_runtime_1.jsx)("button", { onClick: handleSave, children: "\u4FDD\u5B58" }), error && (0, jsx_runtime_1.jsx)("div", { style: { color: 'red' }, children: error })] }));
};
exports.default = BoardEdit;
//# sourceMappingURL=BoardEdit.js.map