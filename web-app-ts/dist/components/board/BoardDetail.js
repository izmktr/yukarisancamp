"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const BoardDetail = ({ id }) => {
    const [article, setArticle] = (0, react_1.useState)(null);
    (0, react_1.useEffect)(() => {
        fetch(`/api/board/${id}`)
            .then(res => res.json())
            .then(data => setArticle(data));
    }, [id]);
    if (!article)
        return (0, jsx_runtime_1.jsx)("div", { children: "\u8AAD\u307F\u8FBC\u307F\u4E2D..." });
    return ((0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("h2", { children: "\u8A18\u4E8B\u8A73\u7D30" }), (0, jsx_runtime_1.jsxs)("div", { children: ["\u30E2\u30FC\u30C9: ", article.mode] }), (0, jsx_runtime_1.jsxs)("div", { children: ["\u30C0\u30E1\u30FC\u30B8: ", article.damage] }), (0, jsx_runtime_1.jsxs)("div", { children: ["\u30D0\u30C8\u30EB\u30BF\u30A4\u30E0: ", article.battleTime] }), (0, jsx_runtime_1.jsxs)("div", { children: ["\u6295\u7A3F\u65E5\u4ED8: ", article.battleDate] }), (0, jsx_runtime_1.jsx)("h3", { children: "\u30D1\u30FC\u30C6\u30A3\u7DE8\u6210" }), (0, jsx_runtime_1.jsx)("ul", { children: article.party.map((p, i) => ((0, jsx_runtime_1.jsxs)("li", { children: [p.name, " \u2605", p.star, " Lv", p.level, " RANK", p.rank] }, i))) }), (0, jsx_runtime_1.jsx)("a", { href: `/board/${id}/edit`, children: "\u7DE8\u96C6" })] }));
};
exports.default = BoardDetail;
//# sourceMappingURL=BoardDetail.js.map