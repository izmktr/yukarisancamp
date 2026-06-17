"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const BoardList = () => {
    const [articles, setArticles] = (0, react_1.useState)([]);
    (0, react_1.useEffect)(() => {
        fetch('/api/board')
            .then(res => res.json())
            .then(data => setArticles(data));
    }, []);
    return ((0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("h2", { children: "\u63B2\u793A\u677F\u8A18\u4E8B\u4E00\u89A7" }), (0, jsx_runtime_1.jsxs)("table", { children: [(0, jsx_runtime_1.jsx)("thead", { children: (0, jsx_runtime_1.jsxs)("tr", { children: [(0, jsx_runtime_1.jsx)("th", { children: "\u30E2\u30FC\u30C9" }), (0, jsx_runtime_1.jsx)("th", { children: "\u30C0\u30E1\u30FC\u30B8" }), (0, jsx_runtime_1.jsx)("th", { children: "\u30D0\u30C8\u30EB\u30BF\u30A4\u30E0" }), (0, jsx_runtime_1.jsx)("th", { children: "\u6295\u7A3F\u65E5\u4ED8" })] }) }), (0, jsx_runtime_1.jsx)("tbody", { children: articles.map(article => ((0, jsx_runtime_1.jsxs)("tr", { children: [(0, jsx_runtime_1.jsx)("td", { children: (0, jsx_runtime_1.jsx)("a", { href: `/board/${article.id}`, children: article.mode }) }), (0, jsx_runtime_1.jsx)("td", { children: article.damage }), (0, jsx_runtime_1.jsx)("td", { children: article.battleTime }), (0, jsx_runtime_1.jsx)("td", { children: article.battleDate })] }, article.id))) })] }), (0, jsx_runtime_1.jsx)("a", { href: "/board/post/new", children: "\u65B0\u898F\u6295\u7A3F" })] }));
};
exports.default = BoardList;
//# sourceMappingURL=BoardList.js.map