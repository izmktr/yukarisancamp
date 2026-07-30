let auth = null;
let googleProvider = null;
let isAuthInitialized = false;
let currentAuthUser = null;
let currentUserProfile = null;
let currentProfileLoadErrorMessage = '';
let currentAuthInitErrorMessage = '';
let hasTriggeredAuthSyncReload = false;

const CLAN_BATTLE_BOSS_COUNT = 5;

let currentClanBattleDocId = '';
let currentClanBattleState = null;
let currentClanBattleOriginalState = null;

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getDefaultDisplayName(user) {
    return user.displayName || user.email || 'ユーザー';
}

function normalizeUserProfile(user, rawProfile) {
    const safeProfile = rawProfile || {};
    const ownedCharacters = Array.isArray(safeProfile.ownedCharacters)
        ? safeProfile.ownedCharacters
            .filter((item) => item && typeof item === 'object')
            .map((item) => ({
                officialName: typeof item.officialName === 'string' ? item.officialName : '',
                nickname: typeof item.nickname === 'string' ? item.nickname : '',
                owned: Boolean(item.owned),
                connectRank: Number.isFinite(Number(item.connectRank)) ? Math.trunc(Number(item.connectRank)) : 0
            }))
        : [];

    return {
        googleUserId: user.uid,
        displayName: typeof safeProfile.displayName === 'string' && safeProfile.displayName.trim().length > 0
            ? safeProfile.displayName.trim()
            : getDefaultDisplayName(user),
        discordId: safeProfile.discordId ?? null,
        discordServer: safeProfile.discordServer ?? null,
        createdAt: typeof safeProfile.createdAt === 'number' ? safeProfile.createdAt : Date.now(),
        ownedCharacters
    };
}

async function getAuthIdToken(user) {
    if (!user || typeof user.getIdToken !== 'function') {
        throw new Error('ログイン情報を取得できませんでした。');
    }
    return user.getIdToken();
}

async function getErrorMessageFromResponse(response, fallbackMessage) {
    try {
        const rawBody = await response.text();
        if (!rawBody) {
            return fallbackMessage;
        }

        try {
            const payload = JSON.parse(rawBody);
            if (payload && typeof payload.error === 'string' && payload.error.trim().length > 0) {
                return payload.error.trim();
            }
        } catch (parseError) {
            // 文字列本文のエラーでもそのまま返す
        }

        return rawBody.trim();
    } catch (readError) {
        return fallbackMessage;
    }
}

async function ensureUserProfile(user) {
    const idToken = await getAuthIdToken(user);
    const response = await fetch('/api/settings/profile/current', {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${idToken}`
        }
    });

    if (!response.ok) {
        const errorMessage = await getErrorMessageFromResponse(response, 'プロフィールの読み込みに失敗しました。');
        throw new Error(`プロフィールの読み込みに失敗しました。${errorMessage ? ` ${errorMessage}` : ''}`.trim());
    }

    const payload = await response.json();
    return normalizeUserProfile(user, payload && payload.profile ? payload.profile : null);
}

async function saveUserProfile(user, profilePatch) {
    const idToken = await getAuthIdToken(user);
    const response = await fetch('/api/settings/profile/save', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify(profilePatch || {})
    });

    if (!response.ok) {
        const errorMessage = await getErrorMessageFromResponse(response, 'プロフィールの保存に失敗しました。');
        throw new Error(`プロフィールの保存に失敗しました。${errorMessage ? ` ${errorMessage}` : ''}`.trim());
    }

    const payload = await response.json();
    return normalizeUserProfile(user, payload && payload.profile ? payload.profile : null);
}

function getLinkedDisplayValue(value) {
    if (value === null || value === undefined || value === '') {
        return '[未連携]';
    }
    return String(value);
}

function updateSettingsSaveButtonState() {
    const saveButton = document.getElementById('settings-save-button');
    const displayNameInput = document.getElementById('settings-display-name');
    if (!saveButton || !displayNameInput) {
        return;
    }

    const originalValue = displayNameInput.dataset.originalValue || '';
    const currentValue = displayNameInput.value.trim();
    const isChanged = currentValue !== originalValue;
    const canSave = isChanged && currentValue.length > 0;

    saveButton.disabled = !canSave;
}

function renderSettingsStatus(message, type) {
    const status = document.getElementById('settings-status');
    if (!status) {
        return;
    }

    status.textContent = message;
    status.classList.remove('success', 'error');
    if (type === 'success') {
        status.classList.add('success');
    }
    if (type === 'error') {
        status.classList.add('error');
    }
}

function renderSettings(user, profile) {
    const loginRequired = document.getElementById('settings-login-required');
    const firebaseError = document.getElementById('settings-firebase-error');
    const profileSection = document.getElementById('settings-profile');
    const displayNameInput = document.getElementById('settings-display-name');
    const emailValue = document.getElementById('settings-email');
    const discordServerValue = document.getElementById('settings-discord-server');
    const createdAtValue = document.getElementById('settings-created-at');

    if (!loginRequired || !firebaseError || !profileSection || !displayNameInput || !discordServerValue || !createdAtValue) {
        return;
    }

    if (!user) {
        loginRequired.style.display = 'block';
        firebaseError.style.display = 'none';
        profileSection.style.display = 'none';
        return;
    }

    if (!profile) {
        loginRequired.style.display = 'none';
        profileSection.style.display = 'none';
        firebaseError.textContent = currentProfileLoadErrorMessage || 'Supabaseからユーザー情報を取得できませんでした。';
        firebaseError.style.display = 'block';
        return;
    }

    loginRequired.style.display = 'none';
    firebaseError.style.display = 'none';
    profileSection.style.display = 'block';

    displayNameInput.value = profile.displayName;
    displayNameInput.dataset.originalValue = profile.displayName;
    if (emailValue) {
        emailValue.textContent = user.email || '（未設定）';
    }
    discordServerValue.textContent = getLinkedDisplayValue(profile.discordServer);
    createdAtValue.textContent = new Date(profile.createdAt).toLocaleString('ja-JP');
    renderSettingsStatus('', '');
    updateSettingsSaveButtonState();
}

async function saveSettingsDisplayName() {
    const displayNameInput = document.getElementById('settings-display-name');
    const saveButton = document.getElementById('settings-save-button');

    if (!displayNameInput || !saveButton || !currentAuthUser || !currentUserProfile) {
        return;
    }

    const newDisplayName = displayNameInput.value.trim();
    if (newDisplayName.length === 0) {
        renderSettingsStatus('表示名を入力してください。', 'error');
        return;
    }

    try {
        saveButton.disabled = true;
        currentUserProfile = await saveUserProfile(currentAuthUser, {
            displayName: newDisplayName
        });

        displayNameInput.dataset.originalValue = newDisplayName;
        renderAuthState(currentAuthUser, currentUserProfile);
        renderSettingsStatus('表示名を保存しました。', 'success');
        updateSettingsSaveButtonState();
    } catch (error) {
        console.error('表示名の保存に失敗しました:', error);
        renderSettingsStatus('保存に失敗しました。時間をおいて再試行してください。', 'error');
    }
}

function initializeSettingsPage() {
    const displayNameInput = document.getElementById('settings-display-name');
    const saveButton = document.getElementById('settings-save-button');

    if (!displayNameInput || !saveButton) {
        return;
    }

    displayNameInput.addEventListener('input', () => {
        updateSettingsSaveButtonState();
        renderSettingsStatus('', '');
    });

    saveButton.addEventListener('click', async () => {
        await saveSettingsDisplayName();
    });

    renderSettings(currentAuthUser, currentUserProfile);
}

function getBaseYearMonth(referenceDate = new Date()) {
    const year = referenceDate.getFullYear();
    const month = referenceDate.getMonth();
    const monthEndDate = new Date(year, month + 1, 0).getDate();
    const currentMonthThreshold = monthEndDate - 9;
    const baseDate = referenceDate.getDate() > currentMonthThreshold
        ? referenceDate
        : new Date(year, month, 0);

    const baseYear = baseDate.getFullYear();
    const baseMonth = String(baseDate.getMonth() + 1).padStart(2, '0');
    return `${baseYear}${baseMonth}`;
}

function getCurrentTimestampId() {
    return new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
}

function getTimelineErrorMessage(error) {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return '投稿内容の変換に失敗しました。';
}

async function loadCurrentClanBattleBossNamesForPosting() {
    const response = await fetch('/api/clanbattle-settings/current');
    if (!response.ok) {
        throw new Error('クラバト設定を取得できませんでした。');
    }

    const payload = await response.json();
    const state = payload && payload.state ? payload.state : null;
    if (!state || !state.yearmonth) {
        throw new Error('クラバト設定のレスポンス形式が不正です。');
    }

    const normalizedState = normalizeClanBattleState(String(state.yearmonth), state);
    const bossNames = normalizedState.bossname.map((value) => value.trim()).filter((value) => value.length > 0);
    if (bossNames.length === 0) {
        throw new Error(`クラバト設定の boss 名が未設定です。対象年月: ${normalizedState.yearmonth}`);
    }

    return { yearmonth: normalizedState.yearmonth, bossNames };
}

function parseTimelinePartyMember(line) {
    const match = line.match(/^(.*?)\s+★(\d+)\s+Lv(\d+)\s+RANK(\d+)$/);
    if (!match) {
        throw new Error(`パーティ編成の形式が不正です: ${line}`);
    }

    return {
        name: match[1].trim(),
        star: Number(match[2]),
        level: Number(match[3]),
        rank: Number(match[4])
    };
}

function parseTimelineUbEvent(line) {
    const match = line.match(/^([0-9]{2}:[0-9]{2})\s+(.+)$/);
    if (!match) {
        throw new Error(`ユニオンバースト発動時間の形式が不正です: ${line}`);
    }

    return {
        time: match[1],
        character: match[2].trim()
    };
}

function resolveTimelineMode(modeLine, battleTime) {
    const stageMatch = modeLine.match(/(\d+)段階目/);
    const stageNumber = stageMatch ? Number(stageMatch[1]) : NaN;

    if (stageNumber === 2) {
        return 'rank2';
    }
    if (stageNumber === 3) {
        return 'rank3';
    }

    return 'full';
}

function convertTimelogToTimelineInfo(rawText, yearmonth, bossNames, authorInfo) {
    const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
    if (lines.length < 4) {
        throw new Error('投稿内容が不足しています。');
    }

    const mode = lines[0];
    const matchedBossname = [...bossNames].sort((left, right) => right.length - left.length).find((bossname) => mode.includes(bossname));
    if (!matchedBossname) {
        throw new Error('1行目にクラバト設定の boss 名が見つかりませんでした。');
    }

    const damageMatch = lines[1].match(/(\d+)/);
    if (!damageMatch) {
        throw new Error('ダメージ行の形式が不正です。');
    }

    const battleTime = lines[2].replace(/^バトル時間\s*/, '').trim();
    if (!/^\d{2}:\d{2}$/.test(battleTime)) {
        throw new Error('バトル時間の形式が不正です。');
    }

    const battleDate = lines[3].replace(/^バトル日時\s*/, '').trim();
    if (!/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/.test(battleDate)) {
        throw new Error('バトル日時の形式が不正です。');
    }

    const party = [];
    const ubTimeline = [];
    let section = '';

    for (let index = 4; index < lines.length; index += 1) {
        const line = lines[index];

        if (line === '----') {
            section = '';
            continue;
        }
        if (line.startsWith('◆パーティ編成')) {
            section = 'party';
            continue;
        }
        if (line.startsWith('◆ユニオンバースト発動時間')) {
            section = 'ub';
            continue;
        }

        if (section === 'party') {
            party.push(parseTimelinePartyMember(line));
            continue;
        }

        if (section === 'ub') {
            ubTimeline.push(parseTimelineUbEvent(line));
        }
    }

    if (party.length === 0) {
        throw new Error('パーティ編成が見つかりませんでした。');
    }
    if (ubTimeline.length === 0) {
        throw new Error('ユニオンバースト発動時間が見つかりませんでした。');
    }

    const normalizedAuthorInfo = authorInfo || {};
    const convertedMode = resolveTimelineMode(mode, battleTime);

    return {
        uniqueId: getCurrentTimestampId(),
        yearmonth,
        bossname: matchedBossname,
        mode: convertedMode,
        authorid: String(normalizedAuthorInfo.authorid || ''),
        authorname: String(normalizedAuthorInfo.authorname || ''),
        authorclanid: String(normalizedAuthorInfo.authorclanid || ''),
        damage: Number(damageMatch[1]),
        battleTime,
        battleDate,
        party,
        ubTimeline
    };
}

function renderBoardPostError(message) {
    const errorElement = document.getElementById('board-post-error');
    if (!errorElement) {
        return;
    }

    errorElement.textContent = message;
    errorElement.style.display = message ? 'block' : 'none';
}

function initializeBoardPostPage() {
    const form = document.getElementById('board-post-form');
    const timelogInput = document.getElementById('timelog');
    const timelineInfoInput = document.getElementById('timelineInfo');

    if (!form || !timelogInput || !timelineInfoInput) {
        return;
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        renderBoardPostError('');

        const rawText = timelogInput.value.trim();
        if (!rawText) {
            renderBoardPostError('投稿内容を入力してください。');
            return;
        }

        try {
            if (!initializeFirebaseAuth()) {
                throw new Error(currentAuthInitErrorMessage || 'Firebase の初期化に失敗しました。');
            }

            let profile = currentUserProfile;
            if (!profile && currentAuthUser) {
                profile = await ensureUserProfile(currentAuthUser);
                currentUserProfile = profile;
            }

            const authorInfo = {
                authorid: profile && profile.googleUserId ? String(profile.googleUserId) : '',
                authorname: profile && profile.displayName ? String(profile.displayName) : '',
                authorclanid: profile && profile.discordServer ? String(profile.discordServer) : ''
            };

            const { yearmonth, bossNames } = await loadCurrentClanBattleBossNamesForPosting();
            const timelineInfo = convertTimelogToTimelineInfo(rawText, yearmonth, bossNames, authorInfo);
            timelineInfoInput.value = JSON.stringify(timelineInfo);
            form.submit();
        } catch (error) {
            console.error('投稿内容の変換に失敗しました:', error);
            renderBoardPostError(getTimelineErrorMessage(error));
        }
    });
}

function initializeBoardHelpToggle() {
    const toggleButton = document.getElementById('board-help-toggle');
    const helpPanel = document.getElementById('board-help-panel');

    if (!toggleButton || !helpPanel) {
        return;
    }

    let isOpen = false;

    const render = () => {
        helpPanel.hidden = !isOpen;
        toggleButton.textContent = isOpen ? '閉じる' : '使い方';
        toggleButton.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    };

    render();

    toggleButton.addEventListener('click', () => {
        isOpen = !isOpen;
        render();
    });
}

function getPreviousYearMonth(yearmonth) {
    if (!/^\d{6}$/.test(yearmonth)) {
        return '';
    }

    const year = Number(yearmonth.slice(0, 4));
    const month = Number(yearmonth.slice(4, 6));
    const date = new Date(year, month - 2, 1);
    const prevYear = date.getFullYear();
    const prevMonth = String(date.getMonth() + 1).padStart(2, '0');
    return `${prevYear}${prevMonth}`;
}

function formatDateAsIsoLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getClanBattleDefaultDates(baseDate = new Date()) {
    const year = baseDate.getFullYear();
    const month = baseDate.getMonth();
    const lastDay = new Date(year, month + 1, 0);

    const startDate = new Date(lastDay);
    startDate.setDate(lastDay.getDate() - 5);

    const endDate = new Date(lastDay);
    endDate.setDate(lastDay.getDate() - 1);

    return {
        startDate: formatDateAsIsoLocal(startDate),
        endDate: formatDateAsIsoLocal(endDate)
    };
}

function applyClanBattleDateDefaults(state) {
    const defaults = getClanBattleDefaultDates();
    return {
        ...state,
        startDate: state.startDate && state.startDate.trim() ? state.startDate : defaults.startDate,
        endDate: state.endDate && state.endDate.trim() ? state.endDate : defaults.endDate
    };
}

function getEmptyClanBattleState(yearmonth) {
    const defaults = getClanBattleDefaultDates();
    return {
        yearmonth,
        bossname: Array.from({ length: CLAN_BATTLE_BOSS_COUNT }, () => ''),
        bossHp: Array.from({ length: CLAN_BATTLE_BOSS_COUNT }, () => ''),
        startDate: defaults.startDate,
        endDate: defaults.endDate
    };
}

function normalizeClanBattleState(yearmonth, rawValue) {
    const source = rawValue || {};
    const bossname = Array.isArray(source.bossname) ? source.bossname : [];
    const bossHp = Array.isArray(source.bossHp) ? source.bossHp : [];

    return {
        yearmonth,
        bossname: Array.from({ length: CLAN_BATTLE_BOSS_COUNT }, (_, index) => {
            const value = bossname[index];
            return value === null || value === undefined ? '' : String(value);
        }),
        bossHp: Array.from({ length: CLAN_BATTLE_BOSS_COUNT }, (_, index) => {
            const value = bossHp[index];
            if (value === null || value === undefined || value === '') {
                return '';
            }
            const numericValue = Number(value);
            if (!Number.isFinite(numericValue)) {
                return '';
            }
            return String(Math.trunc(numericValue));
        }),
        startDate: typeof source.startDate === 'string' ? source.startDate : '',
        endDate: typeof source.endDate === 'string' ? source.endDate : ''
    };
}

function cloneClanBattleState(state) {
    return {
        yearmonth: state.yearmonth,
        bossname: [...state.bossname],
        bossHp: [...state.bossHp],
        startDate: state.startDate,
        endDate: state.endDate
    };
}

function isClanBattleStateSame(left, right) {
    if (!left || !right) {
        return false;
    }

    if (left.yearmonth !== right.yearmonth || left.startDate !== right.startDate || left.endDate !== right.endDate) {
        return false;
    }

    for (let i = 0; i < CLAN_BATTLE_BOSS_COUNT; i += 1) {
        if (left.bossname[i] !== right.bossname[i]) {
            return false;
        }
        if (left.bossHp[i] !== right.bossHp[i]) {
            return false;
        }
    }

    return true;
}

function renderClanBattleStatus(message, type) {
    const status = document.getElementById('cb-status');
    if (!status) {
        return;
    }

    status.textContent = message;
    status.classList.remove('success', 'error');
    if (type === 'success') {
        status.classList.add('success');
    }
    if (type === 'error') {
        status.classList.add('error');
    }
}

function collectClanBattleStateFromForm() {
    const yearmonthElement = document.getElementById('cb-yearmonth');
    const startDateInput = document.getElementById('cb-start-date');
    const endDateInput = document.getElementById('cb-end-date');

    if (!yearmonthElement || !startDateInput || !endDateInput) {
        return null;
    }

    const bossname = [];
    const bossHp = [];
    for (let i = 1; i <= CLAN_BATTLE_BOSS_COUNT; i += 1) {
        const bossnameInput = document.getElementById(`cb-bossname-${i}`);
        const bosshpInput = document.getElementById(`cb-bosshp-${i}`);
        if (!bossnameInput || !bosshpInput) {
            return null;
        }

        bossname.push(bossnameInput.value.trim());
        bossHp.push(bosshpInput.value.trim());
    }

    return {
        yearmonth: yearmonthElement.textContent || '',
        bossname,
        bossHp,
        startDate: startDateInput.value,
        endDate: endDateInput.value
    };
}

function updateClanBattleSaveButtonState() {
    const saveButton = document.getElementById('cb-save-button');
    if (!saveButton) {
        return;
    }

    const currentState = collectClanBattleStateFromForm();
    const hasChanged = currentState && currentClanBattleOriginalState
        ? !isClanBattleStateSame(currentState, currentClanBattleOriginalState)
        : false;

    saveButton.disabled = !hasChanged;
}

function renderClanBattleState(state) {
    const yearmonthElement = document.getElementById('cb-yearmonth');
    const startDateInput = document.getElementById('cb-start-date');
    const endDateInput = document.getElementById('cb-end-date');

    if (!yearmonthElement || !startDateInput || !endDateInput) {
        return;
    }

    yearmonthElement.textContent = state.yearmonth;
    startDateInput.value = state.startDate;
    endDateInput.value = state.endDate;

    for (let i = 1; i <= CLAN_BATTLE_BOSS_COUNT; i += 1) {
        const bossnameInput = document.getElementById(`cb-bossname-${i}`);
        const bosshpInput = document.getElementById(`cb-bosshp-${i}`);
        if (!bossnameInput || !bosshpInput) {
            continue;
        }
        bossnameInput.value = state.bossname[i - 1] || '';
        bosshpInput.value = state.bossHp[i - 1] || '';
    }

    currentClanBattleState = cloneClanBattleState(state);
    currentClanBattleOriginalState = cloneClanBattleState(state);
    updateClanBattleSaveButtonState();
    renderClanBattleStatus('', '');
}

async function ensureClanBattleStateForCurrentMonth() {
    const response = await fetch('/api/clanbattle-settings/current');
    if (!response.ok) {
        throw new Error('Supabase からクラバト設定を取得できませんでした。');
    }

    const payload = await response.json();
    const state = payload && payload.state ? payload.state : null;
    const yearmonth = state && typeof state.yearmonth === 'string' ? state.yearmonth : getBaseYearMonth();
    const normalizedState = normalizeClanBattleState(yearmonth, state);
    const withDefaultsCurrent = applyClanBattleDateDefaults(normalizedState);

    currentClanBattleDocId = '0';
    return withDefaultsCurrent;
}

async function saveClanBattleSettings() {
    if (!currentAuthUser || !currentClanBattleDocId) {
        return;
    }

    const saveButton = document.getElementById('cb-save-button');
    const formState = collectClanBattleStateFromForm();
    if (!saveButton || !formState) {
        return;
    }

    if (!/^\d{6}$/.test(formState.yearmonth)) {
        renderClanBattleStatus('対象年月が不正です。画面を再読み込みしてください。', 'error');
        return;
    }

    try {
        saveButton.disabled = true;

        const payload = {
            yearmonth: formState.yearmonth,
            bossname: formState.bossname.map((value) => value.trim()),
            bossHp: formState.bossHp.map((value) => {
                const trimmed = value.trim();
                if (trimmed === '') {
                    return null;
                }
                const numericValue = Number(trimmed);
                return Number.isFinite(numericValue) ? Math.trunc(numericValue) : null;
            }),
            startDate: formState.startDate,
            endDate: formState.endDate
        };

        const payloadWithDefaults = applyClanBattleDateDefaults(payload);

        const response = await fetch('/api/clanbattle-settings/save', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payloadWithDefaults)
        });

        if (!response.ok) {
            throw new Error('Supabase save failed');
        }

        const normalized = normalizeClanBattleState(formState.yearmonth, payloadWithDefaults);
        currentClanBattleState = cloneClanBattleState(normalized);
        currentClanBattleOriginalState = cloneClanBattleState(normalized);
        renderClanBattleState(normalized);

        renderClanBattleStatus('クラバト設定を保存しました。', 'success');
        updateClanBattleSaveButtonState();
    } catch (error) {
        console.error('クラバト設定の保存に失敗しました:', error);
        renderClanBattleStatus('保存に失敗しました。時間をおいて再試行してください。', 'error');
        updateClanBattleSaveButtonState();
    }
}

async function renderClanBattleSettings(user) {
    const loginRequired = document.getElementById('cb-login-required');
    const firebaseError = document.getElementById('cb-firebase-error');
    const settingsSection = document.getElementById('cb-settings');

    if (!loginRequired || !firebaseError || !settingsSection) {
        return;
    }

    if (!user) {
        loginRequired.style.display = 'block';
        firebaseError.style.display = 'none';
        settingsSection.style.display = 'none';
        currentClanBattleState = null;
        currentClanBattleOriginalState = null;
        currentClanBattleDocId = '';
        return;
    }

    try {
        const state = await ensureClanBattleStateForCurrentMonth();
        renderClanBattleState(state);
        loginRequired.style.display = 'none';
        firebaseError.style.display = 'none';
        settingsSection.style.display = 'block';
    } catch (error) {
        console.error('クラバト設定の読み込みに失敗しました:', error);
        loginRequired.style.display = 'none';
        settingsSection.style.display = 'none';
        firebaseError.textContent = 'Supabase からクラバト設定を読み込めませんでした。サーバ設定またはネットワーク状態を確認してください。';
        firebaseError.style.display = 'block';
    }
}

function initializeClanBattleSettingsPage() {
    const saveButton = document.getElementById('cb-save-button');
    if (!saveButton) {
        return;
    }

    const onInputChanged = () => {
        renderClanBattleStatus('', '');
        updateClanBattleSaveButtonState();
    };

    for (let i = 1; i <= CLAN_BATTLE_BOSS_COUNT; i += 1) {
        const bossnameInput = document.getElementById(`cb-bossname-${i}`);
        const bosshpInput = document.getElementById(`cb-bosshp-${i}`);
        if (bossnameInput) {
            bossnameInput.addEventListener('input', onInputChanged);
        }
        if (bosshpInput) {
            bosshpInput.addEventListener('input', onInputChanged);
        }
    }

    const startDateInput = document.getElementById('cb-start-date');
    const endDateInput = document.getElementById('cb-end-date');
    if (startDateInput) {
        startDateInput.addEventListener('input', onInputChanged);
    }
    if (endDateInput) {
        endDateInput.addEventListener('input', onInputChanged);
    }

    saveButton.addEventListener('click', async () => {
        await saveClanBattleSettings();
    });

    renderClanBattleSettings(currentAuthUser);
}

function getFirebaseConfig() {
    return window.__FIREBASE_CONFIG__ || {};
}

function hasRequiredFirebaseConfig(config) {
    return Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);
}

function getMissingFirebaseConfigKeys(config) {
    const requiredKeys = ['apiKey', 'authDomain', 'projectId', 'appId'];
    return requiredKeys.filter((key) => !config || !config[key]);
}

function getServerSessionState() {
    const defaultState = { isLoggedIn: false, isAdmin: false };
    if (!window.__SERVER_SESSION__) {
        return defaultState;
    }
    return {
        isLoggedIn: Boolean(window.__SERVER_SESSION__.isLoggedIn),
        isAdmin: Boolean(window.__SERVER_SESSION__.isAdmin)
    };
}

function shouldReloadAfterSessionSync(role) {
    const serverState = getServerSessionState();
    const latestIsAdmin = role === 'admin';
    return !serverState.isLoggedIn || serverState.isAdmin !== latestIsAdmin;
}

function renderAuthState(user, profile = null) {
    const authButtons = document.querySelector('.auth-buttons');
    if (!authButtons) {
        return;
    }

    if (user) {
        const displayName = profile && profile.displayName ? profile.displayName : getDefaultDisplayName(user);
        authButtons.innerHTML = `
            <span class="user-name">こんにちは、${escapeHtml(displayName)}さん</span>
            <button class="btn btn-logout" onclick="logout()">ログアウト</button>
        `;
        return;
    }

    authButtons.innerHTML = `
        <button class="btn btn-login" onclick="loginWithGoogle()">Googleでログイン</button>
    `;
}

function initializeFirebaseAuth() {
    if (isAuthInitialized) {
        currentAuthInitErrorMessage = '';
        return true;
    }

    if (!window.firebase || typeof window.firebase.initializeApp !== 'function') {
        currentAuthInitErrorMessage = 'Firebase SDK の読み込みに失敗しました。CSP または外部 CDN 接続設定を確認してください。';
        console.error('Firebase SDK が読み込まれていません。');
        return false;
    }

    const firebaseConfig = getFirebaseConfig();
    const missingKeys = getMissingFirebaseConfigKeys(firebaseConfig);
    if (!hasRequiredFirebaseConfig(firebaseConfig)) {
        currentAuthInitErrorMessage = `Firebase 設定が不足しています。未設定: ${missingKeys.join(', ')}`;
        console.error('Firebase 設定が不足しています。', firebaseConfig);
        return false;
    }

    try {
        if (!window.firebase.apps.length) {
            window.firebase.initializeApp(firebaseConfig);
        }

        auth = window.firebase.auth();
        googleProvider = new window.firebase.auth.GoogleAuthProvider();
    } catch (error) {
        currentAuthInitErrorMessage = 'Firebase 初期化時に例外が発生しました。ブラウザコンソールを確認してください。';
        console.error('Firebase 初期化例外:', error);
        return false;
    }

    auth.onAuthStateChanged(async (user) => {
        currentAuthUser = user;
        currentProfileLoadErrorMessage = '';

        if (user) {
            try {
                currentUserProfile = await ensureUserProfile(user);
                
                // サーバーにユーザー情報を送信してセッションを保存
                // セキュリティ: Firebase ID トークンを Authorization ヘッダーで送信し、サーバー側で検証する
                if (currentUserProfile) {
                    try {
                        const idToken = await user.getIdToken();
                        const response = await fetch('/api/user/session', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${idToken}`
                            },
                            body: JSON.stringify({
                                displayName: currentUserProfile.displayName,
                                discordServer: currentUserProfile.discordServer
                            })
                        });

                        if (response.ok) {
                            const payload = await response.json();
                            if (!hasTriggeredAuthSyncReload && shouldReloadAfterSessionSync(payload.role)) {
                                hasTriggeredAuthSyncReload = true;
                                location.reload();
                                return;
                            }
                        }
                    } catch (err) {
                        console.error('Failed to save user session:', err);
                    }
                }
            } catch (error) {
                console.error('userProfile の取得または作成に失敗しました:', error);
                currentProfileLoadErrorMessage = error instanceof Error && error.message
                    ? error.message
                    : '設定情報を取得できませんでした。サーバ設定またはネットワーク状態を確認してください。';
                currentUserProfile = null;
            }
        } else {
            currentUserProfile = null;
        }

        renderAuthState(user, currentUserProfile);
        renderSettings(user, currentUserProfile);
        await renderClanBattleSettings(user);
    });

    isAuthInitialized = true;
    currentAuthInitErrorMessage = '';
    return true;
}

async function loginWithGoogle() {
    if (!initializeFirebaseAuth()) {
        alert(`Googleログインの初期化に失敗しました。\n${currentAuthInitErrorMessage || '設定を確認してください。'}`);
        return;
    }

    try {
        await auth.signInWithPopup(googleProvider);
    } catch (error) {
        console.error('Googleログイン失敗:', error);
        alert('Googleログインに失敗しました。設定またはブラウザのポップアップ制限を確認してください。');
    }
}

async function logout() {
    if (!initializeFirebaseAuth()) {
        alert('ログアウト処理を初期化できませんでした。');
        return;
    }

    try {
        await auth.signOut();
        await fetch('/api/user/logout', { method: 'POST' });
        currentAuthUser = null;
        currentUserProfile = null;
        hasTriggeredAuthSyncReload = false;
        location.reload();
    } catch (error) {
        console.error('ログアウト失敗:', error);
        alert('ログアウトに失敗しました。');
    }
}

// グローバル参照（EJSのonclickから呼び出し）
window.loginWithGoogle = loginWithGoogle;
window.logout = logout;

// 時計の更新機能
function updateTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('ja-JP', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    const timeElement = document.getElementById('current-time');
    if (timeElement) {
        timeElement.textContent = timeString;
    }
}

// ナビゲーションのアクティブ状態管理
function setActiveTab() {
    const currentPath = window.location.pathname;
    const navLinks = document.querySelectorAll('.tab-content a');

    navLinks.forEach((link) => {
        link.classList.remove('active');
        const href = link.getAttribute('href');
        if (href === currentPath || (currentPath === '/' && href === '/')) {
            link.classList.add('active');
        }
    });
}

// API呼び出し用のヘルパー関数
async function fetchApi(endpoint) {
    try {
        const response = await fetch(`/api${endpoint}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('API fetch error:', error);
        return null;
    }
}

// 時刻データの取得と表示
async function updateTimeFromServer() {
    const data = await fetchApi('/time');
    if (data && data.time) {
        const timeElement = document.getElementById('current-time');
        if (timeElement) {
            timeElement.textContent = data.time;
        }
    }
}

// ユーザーデータの取得
async function loadUserData() {
    const data = await fetchApi('/users');
    if (data && data.users) {
        console.log('ユーザーデータ:', data.users);
        // 実際のデータ表示ロジックをここに実装
    }
}

// ページ初期化時の処理
document.addEventListener('DOMContentLoaded', function() {
    setActiveTab();

    updateTime();
    setInterval(updateTime, 1000);

    // Firebase初期化に失敗しても画面自体は利用可能にする
    initializeFirebaseAuth();
    initializeSettingsPage();
    initializeClanBattleSettingsPage();
    initializeBoardPostPage();
    initializeBoardHelpToggle();

    const currentPath = window.location.pathname;
    switch (currentPath) {
        case '/users':
            loadUserData();
            break;
        case '/board':
            console.log('掲示板ページが読み込まれました');
            break;
        case '/settings':
            console.log('設定ページが読み込まれました');
            break;
        case '/clanbattle-settings':
            console.log('クラバト設定ページが読み込まれました');
            break;
        default:
            console.log('ホームページが読み込まれました');
    }
});

window.addEventListener('error', function(event) {
    console.error('JavaScript エラー:', event.error);
});

window.addEventListener('unhandledrejection', function(event) {
    console.error('未処理のPromise拒否:', event.reason);
});

function debugInfo() {
    console.log('デバッグ情報:');
    console.log('- 現在のページ:', window.location.pathname);
    console.log('- ユーザーエージェント:', navigator.userAgent);
    console.log('- 画面サイズ:', window.innerWidth + 'x' + window.innerHeight);
}
