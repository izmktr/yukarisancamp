"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const router = (0, express_1.Router)();
const DATA_DIR = path_1.default.join(__dirname, '../../data/board');
const CHARA_INDEX_PATH = path_1.default.join(__dirname, '../../chara/charaindex.json');
function isTimelinePartyMember(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const member = value;
    return typeof member.name === 'string'
        && Number.isInteger(member.star)
        && Number.isInteger(member.level)
        && Number.isInteger(member.rank);
}
function isTimelineUbEvent(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const event = value;
    return typeof event.time === 'string' && typeof event.character === 'string';
}
function isTimelineInfo(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const article = value;
    return typeof article.uniqueId === 'string'
        && /^\d{6}$/.test(article.yearmonth)
        && typeof article.bossname === 'string'
        && typeof article.mode === 'string'
        && Number.isInteger(article.damage)
        && /^\d{2}:\d{2}$/.test(article.battleTime)
        && /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/.test(article.battleDate)
        && Array.isArray(article.party) && article.party.every(isTimelinePartyMember)
        && Array.isArray(article.ubTimeline) && article.ubTimeline.every(isTimelineUbEvent);
}
function loadCharaIndex() {
    try {
        const raw = fs_1.default.readFileSync(CHARA_INDEX_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.filter((entry) => {
            return entry
                && typeof entry === 'object'
                && typeof entry.fileName === 'string'
                && typeof entry.name === 'string';
        });
    }
    catch (error) {
        console.error('Failed to load chara index:', error);
        return [];
    }
}
const charaIndex = loadCharaIndex();
const charaImageByName = new Map(charaIndex.map((entry) => [entry.name, entry.fileName]));
function normalizeCharacterName(name) {
    const trimmed = name.trim();
    const swimsuitMatch = trimmed.match(/^水着(.+)$/);
    if (swimsuitMatch && !trimmed.includes('（')) {
        return `${swimsuitMatch[1].trim()}（サマー）`;
    }
    return trimmed;
}
function getSwimsuitAliasName(name) {
    const match = normalizeCharacterName(name).match(/^(.*)（サマー）$/);
    if (!match) {
        return null;
    }
    return `水着${match[1].trim()}`;
}
function splitCharacterName(name) {
    const trimmed = normalizeCharacterName(name);
    const match = trimmed.match(/^(.*?)(?:（(.+)）)?$/);
    if (!match) {
        return { base: trimmed, suffix: null };
    }
    return {
        base: match[1].trim(),
        suffix: match[2] ? match[2].trim() : null
    };
}
function resolveCharacterImagePath(name) {
    const normalizedName = normalizeCharacterName(name);
    const swimsuitAliasName = getSwimsuitAliasName(normalizedName);
    const exact = charaImageByName.get(normalizedName)
        || charaImageByName.get(name)
        || (swimsuitAliasName ? charaImageByName.get(swimsuitAliasName) : undefined);
    if (exact) {
        return `/chara-images/${exact}`;
    }
    const target = splitCharacterName(normalizedName);
    const fallback = charaIndex.find((entry) => {
        const candidate = splitCharacterName(entry.name);
        if (candidate.suffix !== target.suffix) {
            return false;
        }
        return candidate.base.includes(target.base) || target.base.includes(candidate.base);
    });
    return fallback ? `/chara-images/${fallback.fileName}` : null;
}
function parseLegacyPartyMember(value) {
    const match = value.match(/^(.*?)\s+★(\d+)\s+Lv(\d+)\s+RANK(\d+)$/i);
    if (!match) {
        return {
            name: value,
            star: null,
            level: null,
            rank: null,
            imagePath: resolveCharacterImagePath(value)
        };
    }
    const name = match[1].trim();
    return {
        name: normalizeCharacterName(name),
        star: Number(match[2]),
        level: Number(match[3]),
        rank: Number(match[4]),
        imagePath: resolveCharacterImagePath(name)
    };
}
function resolveBoardDetailPartyMembers(party) {
    if (!Array.isArray(party)) {
        return [];
    }
    return party.flatMap((member) => {
        if (isTimelinePartyMember(member)) {
            return [{
                    name: normalizeCharacterName(member.name),
                    star: member.star,
                    level: member.level,
                    rank: member.rank,
                    imagePath: resolveCharacterImagePath(member.name)
                }];
        }
        if (typeof member === 'string' && member.trim().length > 0) {
            return [parseLegacyPartyMember(member.trim())];
        }
        return [];
    });
}
function resolveBoardDetailUbRows(article) {
    const rows = [];
    if (Array.isArray(article?.ubTimeline)) {
        for (const ub of article.ubTimeline) {
            if (!ub || typeof ub !== 'object') {
                continue;
            }
            const event = ub;
            const time = typeof event.time === 'string' ? event.time : '';
            const ubText = typeof event.character === 'string' ? event.character.trim() : '';
            if (!time && !ubText) {
                continue;
            }
            const ubImagePath = ubText ? resolveCharacterImagePath(ubText) : null;
            const activeIcons = Array.isArray(event.activeIcons)
                ? event.activeIcons.filter((value) => Number.isInteger(value) && value >= 0 && value <= 4)
                : [];
            const autoActive = typeof event.autoActive === 'boolean' ? event.autoActive : false;
            const comment = typeof event.comment === 'string' ? event.comment : '';
            const isAddedRow = typeof event.isAddedRow === 'boolean' ? event.isAddedRow : false;
            rows.push({
                time,
                ubText,
                ubImagePath,
                activeIcons,
                autoActive,
                comment,
                isAddedRow
            });
        }
        return rows;
    }
    if (Array.isArray(article?.ubTimes)) {
        for (const line of article.ubTimes) {
            if (typeof line !== 'string') {
                continue;
            }
            const trimmed = line.trim();
            if (!trimmed) {
                continue;
            }
            const match = trimmed.match(/^([0-9]{1,2}:[0-9]{2})\s+(.+)$/);
            const time = match ? match[1] : '';
            const ubText = match ? match[2].trim() : trimmed;
            const ubImagePath = ubText ? resolveCharacterImagePath(ubText) : null;
            rows.push({
                time,
                ubText,
                ubImagePath,
                activeIcons: [],
                autoActive: false,
                comment: '',
                isAddedRow: false
            });
        }
    }
    return rows;
}
function parseTimelog(text) {
    const lines = text.split(/\r?\n/);
    const result = {
        mode: '', damage: '', battleTime: '', battleDate: '', party: [], ubTimes: []
    };
    let section = '';
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line)
            continue;
        if (line.startsWith('クランモード'))
            result.mode = line;
        else if (line.match(/\d+ダメージ/))
            result.damage = line;
        else if (line.startsWith('バトル時間'))
            result.battleTime = line.replace('バトル時間', '').trim();
        else if (line.startsWith('バトル日時'))
            result.battleDate = line.replace('バトル日時', '').trim();
        else if (line.startsWith('◆パーティ編成'))
            section = 'party';
        else if (line.startsWith('◆ユニオンバースト発動時間'))
            section = 'ub';
        else if (line.startsWith('----'))
            section = '';
        else if (section === 'party')
            result.party.push(line);
        else if (section === 'ub')
            result.ubTimes.push(line);
    }
    return result;
}
function getAuthViewData(req) {
    const userSession = req.session.user;
    return {
        isLoggedIn: !!userSession,
        userName: userSession?.displayName || '',
        isAdmin: userSession?.role === 'admin'
    };
}
// 記事一覧
router.get('/', (req, res) => {
    const auth = getAuthViewData(req);
    const files = fs_1.default.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
    const articles = files.map(file => {
        const data = JSON.parse(fs_1.default.readFileSync(path_1.default.join(DATA_DIR, file), 'utf-8'));
        return {
            id: file.replace('.json', ''),
            mode: data.mode,
            damage: data.damage,
            battleTime: data.battleTime,
            battleDate: data.battleDate
        };
    });
    res.render('board', {
        title: 'ゆかりさん△',
        currentPage: 'board',
        ...auth,
        articles
    });
});
// 新規投稿画面（競合回避のため /:id より前に記述）
router.get('/post', (req, res) => {
    const auth = getAuthViewData(req);
    res.render('board-post', {
        title: 'ゆかりさん△',
        currentPage: 'board',
        ...auth
    });
});
// 個別記事
router.get('/:id', (req, res) => {
    const auth = getAuthViewData(req);
    const file = path_1.default.join(DATA_DIR, req.params.id + '.json');
    if (!fs_1.default.existsSync(file))
        return res.status(404).send('記事がありません');
    const data = JSON.parse(fs_1.default.readFileSync(file, 'utf-8'));
    const partyMembers = resolveBoardDetailPartyMembers(data.party);
    const ubRows = resolveBoardDetailUbRows(data);
    res.render('board-detail', {
        title: 'ゆかりさん△',
        currentPage: 'board',
        ...auth,
        article: data,
        partyMembers,
        ubRows,
        id: req.params.id
    });
});
// 投稿処理（timelogテキスト→編集画面）
router.post('/edit', (req, res) => {
    const auth = getAuthViewData(req);
    const rawText = req.body.timelog;
    const parsed = parseTimelog(rawText);
    req.session.editingArticle = parsed;
    const partyMembers = resolveBoardDetailPartyMembers(parsed.party);
    const ubRows = resolveBoardDetailUbRows(parsed);
    res.render('board-edit', {
        title: 'ゆかりさん△',
        currentPage: 'board',
        ...auth,
        article: parsed,
        partyMembers,
        ubRows,
        timelog: rawText,
        isNew: true
    });
});
// 編集画面（既存記事）
router.get('/:id/edit', (req, res) => {
    const auth = getAuthViewData(req);
    const file = path_1.default.join(DATA_DIR, req.params.id + '.json');
    if (!fs_1.default.existsSync(file))
        return res.status(404).send('記事がありません');
    const data = JSON.parse(fs_1.default.readFileSync(file, 'utf-8'));
    const partyMembers = resolveBoardDetailPartyMembers(data.party);
    const ubRows = resolveBoardDetailUbRows(data);
    res.render('board-edit', {
        title: 'ゆかりさん△',
        currentPage: 'board',
        ...auth,
        article: data,
        partyMembers,
        ubRows,
        id: req.params.id,
        isNew: false
    });
});
// 編集保存（新規・既存）
router.post('/save', (req, res) => {
    const nowId = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const timelineInfoRaw = req.body.timelineInfo;
    if (typeof timelineInfoRaw === 'string' && timelineInfoRaw.trim().length > 0) {
        try {
            const parsedTimelineInfo = JSON.parse(timelineInfoRaw);
            if (!isTimelineInfo(parsedTimelineInfo)) {
                return res.status(400).send('timelineInfo の形式が不正です');
            }
            const id = parsedTimelineInfo.uniqueId || req.body.id || nowId;
            const timelineInfo = {
                ...parsedTimelineInfo,
                uniqueId: id
            };
            const file = path_1.default.join(DATA_DIR, id + '.json');
            fs_1.default.writeFileSync(file, JSON.stringify(timelineInfo, null, 2), 'utf-8');
            return res.redirect('/board/' + id);
        }
        catch {
            return res.status(400).send('timelineInfo の読み込みに失敗しました');
        }
    }
    const article = {
        mode: req.body.mode || '',
        damage: req.body.damage || '',
        battleTime: req.body.battleTime || '',
        battleDate: req.body.battleDate || '',
        party: [],
        ubTimes: []
    };
    if (typeof req.body.party === 'string') {
        article.party = req.body.party.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0);
    }
    if (typeof req.body.ubTimes === 'string') {
        article.ubTimes = req.body.ubTimes.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0);
    }
    if ((!article.mode && !article.damage) && typeof req.body.timelog === 'string') {
        const parsed = parseTimelog(req.body.timelog);
        article.mode = parsed.mode;
        article.damage = parsed.damage;
        article.battleTime = parsed.battleTime;
        article.battleDate = parsed.battleDate;
        article.party = parsed.party;
        article.ubTimes = parsed.ubTimes;
    }
    const id = req.body.id || nowId;
    const file = path_1.default.join(DATA_DIR, id + '.json');
    fs_1.default.writeFileSync(file, JSON.stringify(article, null, 2), 'utf-8');
    res.redirect('/board/' + id);
});
exports.default = router;
//# sourceMappingURL=board.js.map