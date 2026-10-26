const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const ejs = require('ejs');

const templatePath = path.join(__dirname, '../views/clan.ejs');
const source = ts.createSourceFile('index.ts',
  fs.readFileSync(path.join(__dirname, '../src/index.ts'), 'utf8'),
  ts.ScriptTarget.Latest, true);
const route = source.statements.find(node => ts.isExpressionStatement(node)
  && ts.isCallExpression(node.expression)
  && node.expression.arguments[0]?.text === '/api/clan/active-boss-hp/save');
const handlerSource = route.expression.arguments.at(-1).getText(source);
const helperSource = source.statements.filter(node => ts.isFunctionDeclaration(node)
  && ['resolveActingClanMember', 'isNonEmptyTrimmedString'].includes(node.name?.text))
  .map(node => node.getText(source)).join('\n');

const self = { memberid: '200', name: 'Self', attackboss: 0, isSelf: true };
const baseData = {
  clan: { clanid: '100', name: 'Clan', bosslaps: [] },
  members: [self], operableMembers: [self], attackHistories: [],
  bossNames: ['One', 'Two', 'Three', 'Four', 'Five'],
  bossHp: [1000, 2000, null, 4000, 5000], loadError: ''
};
const render = overrides => ejs.renderFile(templatePath, {
  sortClanAttackMembers: members => members,
  clanPageData: { ...baseData, ...overrides }
});

test('idle clan still renders the toggle and all five editable boss panels', async () => {
  const html = await render();
  assert.match(html, /id="clan-show-all-active-checkbox"/);
  assert.equal((html.match(/<section class="clan-attack-active-panel /g) || []).length, 5);
  assert.equal((html.match(/clan-attack-active-panel-other"/g) || []).length, 5);
  assert.equal((html.match(/<button[^>]*clan-active-boss-hp-edit-button/g) || []).length, 5);
  assert.equal((html.match(/攻撃中のメンバーはいません。/g) || []).length, 5);
  assert.match(html, /data-boss-index="3">未設定<\/span>/);
  assert.doesNotMatch(html, /<div class="clan-operate-panel"/);
});

test('self attacks stay visible; other and idle bosses use the toggle without duplicate panels', async () => {
  const attacker = { ...self, attackboss: 2, attacklap: 23, overattack: 0 };
  const peer = { memberid: '300', name: 'Peer', attackboss: 4, attacklap: 24 };
  const html = await render({ members: [attacker, peer], operableMembers: [attacker] });
  assert.equal((html.match(/<section class="clan-attack-active-panel /g) || []).length, 5);
  const ownPanel = html.match(/<section class="clan-attack-active-panel "[\s\S]*?<\/section>/)[0];
  assert.match(ownPanel, /data-boss-index="2"/);
  assert.doesNotMatch(ownPanel, /<section[^>]*style="display: none;"/);
  assert.match(ownPanel, /class="clan-operate-panel"/);
  assert.match(html, /data-name="Peer"/);
  assert.equal((html.match(/clan-attack-active-panel-other"/g) || []).length, 4);
});

test('view-only clan users see all boss information but no HP edit buttons', async () => {
  const html = await render({ members: [], operableMembers: [] });
  assert.match(html, /id="clan-show-all-active-checkbox"/);
  assert.equal((html.match(/<section class="clan-attack-active-panel /g) || []).length, 5);
  assert.doesNotMatch(html, /<button[^>]*clan-active-boss-hp-edit-button/);
});

function setup(overrides = {}) {
  const saved = [];
  const context = {
    Error,
    getSupabaseConfig: () => ({}),
    supabaseSelectUserProfileByGoogleUserId: async () => ({ discordId: '200' }),
    getSessionDiscordServer: () => '100',
    supabaseSelectClanByDiscordServer: async () => ({ clanid: '100' }),
    supabaseSelectClanMembersByDiscordServer: async () => [self],
    supabaseSelectDelegateIdsForOperator: async () => [],
    ensureClanBattleStateFromSupabase: async () => ({ yearmonth: '202610', bossHp: [1000, 2000, 3000, 4000, 5000] }),
    supabaseSelectClanBossStates: async () => [{ boss_index: 5, max_hp: 6000 }],
    supabaseUpsertClanBossStateCurrentHp: async (...args) => saved.push(args),
    console: { error() {} }, ...overrides
  };
  vm.runInNewContext(ts.transpileModule(`${helperSource}\nthis.handler = ${handlerSource};`,
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  return {
    saved,
    async request(body, user = { googleUserId: 'user' }) {
      const result = { status: 200 };
      const res = {
        status(status) { result.status = status; return this; },
        json(body) { result.body = body; return this; }
      };
      await context.handler({ body, session: { user } }, res);
      return result;
    }
  };
}

test('idle members can save HP for every boss, preserving configured or recorded max HP', async () => {
  const h = setup();
  for (let bossIndex = 1; bossIndex <= 5; bossIndex++) {
    assert.equal((await h.request({ hp: 0, bossIndex, actingMemberId: '200' })).status, 200);
    const args = h.saved.at(-1);
    assert.equal(args[1], '100');
    assert.equal(args[2], '202610');
    assert.equal(args[3], bossIndex);
    assert.equal(args[4], 0);
    assert.equal(args[5], bossIndex === 5 ? 6000 : bossIndex * 1000);
    assert.equal(args[6], '200');
  }
});

test('active members may change another boss and older active requests keep their target', async () => {
  const h = setup({ supabaseSelectClanMembersByDiscordServer: async () => [{ ...self, attackboss: 2 }] });
  assert.equal((await h.request({ hp: 123, bossIndex: 4 })).status, 200);
  assert.equal(h.saved.at(-1)[3], 4);
  assert.equal((await h.request({ hp: 234 })).status, 200);
  assert.equal(h.saved.at(-1)[3], 2);
});

test('HP saves reject invalid targets, invalid HP and unauthorized members without writes', async () => {
  const h = setup();
  for (const bossIndex of [0, 6, -1, 1.5, null, '2']) {
    assert.equal((await h.request({ hp: 100, bossIndex })).status, 400);
  }
  for (const hp of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await h.request({ hp, bossIndex: 1 })).status, 400);
  }
  assert.equal((await h.request({ hp: 100 })).status, 400);
  assert.equal((await h.request({ hp: 100, bossIndex: 1 }, {})).status, 403);
  assert.equal((await h.request({ hp: 100, bossIndex: 1, actingMemberId: '999' })).status, 403);
  assert.equal(h.saved.length, 0);
  const nonMember = setup({ supabaseSelectClanMembersByDiscordServer: async () => [] });
  assert.equal((await nonMember.request({ hp: 100, bossIndex: 1 })).status, 404);
  assert.equal(nonMember.saved.length, 0);
});

test('delegated members retain HP editing access and database errors are surfaced', async () => {
  const delegated = setup({
    supabaseSelectClanMembersByDiscordServer: async () => [{ ...self, memberid: '300' }],
    supabaseSelectDelegateIdsForOperator: async () => ['300']
  });
  assert.equal((await delegated.request({ hp: 100, bossIndex: 3, actingMemberId: '300' })).status, 200);
  const failed = setup({ supabaseUpsertClanBossStateCurrentHp: async () => { throw new Error('Database unavailable'); } });
  const result = await failed.request({ hp: 100, bossIndex: 1 });
  assert.equal(result.status, 502);
  assert.equal(result.body.error, 'Database unavailable');
});
