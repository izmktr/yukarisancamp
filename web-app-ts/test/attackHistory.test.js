const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const ejs = require('ejs');

// Load the actual helpers without starting the application or its database clients.
const source = ts.createSourceFile('index.ts',
  fs.readFileSync(path.join(__dirname, '../src/index.ts'), 'utf8'),
  ts.ScriptTarget.Latest, true);
const helperNames = [
  'getSupabaseTableEndpoint', 'normalizeAttackHistoryRow',
  'normalizeAttackHistoryEditInput', 'supabaseSelectAttackHistories', 'supabaseUpdateAttackHistory'
];
const helpers = source.statements
  .filter(node => ts.isFunctionDeclaration(node) && helperNames.includes(node.name?.text))
  .map(node => node.getText(source)).join('\n');

function loadHelpers(fetch) {
  const context = {
    module: { exports: {} }, URLSearchParams, fetch,
    SUPABASE_ATTACK_HISTORIES_TABLE: 'attack_histories'
  };
  vm.runInNewContext(ts.transpileModule(
    `${helpers}\nmodule.exports = { ${helperNames.join(', ')} };`,
    { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }
  ).outputText, context);
  return context.module.exports;
}

const config = { url: 'https://example.invalid', secretKey: 'test-key' };
const member = { clanid: '100', memberid: '200' };
const history = { id: 1, memberid: '200', sortie: 1, attacklap: 23, boss: 1, defeat: false, overtime: 0, damage: 123456 };

test('history edits accept nonnegative integer damage and null without imposing a six-digit limit', () => {
  const { normalizeAttackHistoryEditInput: normalize } = loadHelpers();
  for (const damage of [null, 0, 123456, 999999, 1000000]) {
    assert.equal(normalize({ ...history, damage }).damage, damage);
  }
  for (const damage of [undefined, '', '123,456', -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, true]) {
    assert.equal(normalize({ ...history, damage }), null);
  }
  assert.equal(normalize({ ...history, defeat: true, overtime: 19 }), null);
  assert.equal(normalize({ ...history, defeat: true, overtime: 20 }).overtime, 20);
});

test('history reads request and preserve recorded damage, including zero and null', async () => {
  const { supabaseSelectAttackHistories } = loadHelpers(async url => {
    const query = new URL(url).searchParams;
    assert.ok(query.get('select').split(',').includes('damage'));
    assert.equal(query.get('clanid'), 'eq.100');
    assert.equal(query.get('memberid'), 'eq.200');
    return { ok: true, json: async () => [history, { ...history, id: 2, damage: 0 }, { ...history, id: 3, damage: null }] };
  });
  const rows = await supabaseSelectAttackHistories(config, member, '2026-10-26');
  assert.deepEqual(Array.from(rows, row => row.damage), [123456, 0, null]);
});

test('history saves persist damage and keep the existing record filters', async () => {
  for (const damage of [123456, 0, null]) {
    const { supabaseUpdateAttackHistory } = loadHelpers(async (url, options) => {
      const query = new URL(url).searchParams;
      assert.equal(query.get('id'), 'eq.1');
      assert.equal(query.get('memberid'), 'eq.200');
      assert.equal(query.get('day'), 'eq.2026-10-26');
      assert.equal(options.method, 'PATCH');
      const payload = JSON.parse(options.body);
      assert.equal(payload.damage, damage);
      assert.equal(payload.boss, 1);
      assert.equal(payload.attacklap, 23);
      assert.equal(payload.sortiecount, 2);
      return { ok: true, json: async () => [{ ...history, damage }] };
    });
    await supabaseUpdateAttackHistory(config, member, '2026-10-26', { ...history, damage });
  }
});

test('history saves report missing records and database failures', async () => {
  for (const response of [
    { ok: true, json: async () => [] },
    { ok: false, status: 500, text: async () => 'database unavailable' }
  ]) {
    const { supabaseUpdateAttackHistory } = loadHelpers(async () => response);
    await assert.rejects(supabaseUpdateAttackHistory(config, member, '2026-10-26', history));
  }
});

test('history tables group self and proxy members, with damage between boss and state', async () => {
  const html = await ejs.renderFile(path.join(__dirname, '../views/clan.ejs'), {
    sortClanAttackMembers: members => members,
    clanPageData: {
      clan: { name: 'Test clan', bosslaps: [] }, members: [],
      operableMembers: [{ memberid: '200', name: 'Self', isSelf: true }, { memberid: '300', name: 'Proxy', isSelf: false }],
      attackHistories: [history, { ...history, id: 2, damage: 0 }, { ...history, id: 3, memberid: '300', damage: null }],
      bossNames: ['Boss'], loadError: ''
    }
  });
  const tables = html.match(/<table class="clan-attack-history-table">[\s\S]*?<\/table>/g);
  assert.equal(tables.length, 2);
  assert.match(tables[0], /<caption>Self<\/caption>/);
  assert.match(tables[1], /<caption>Proxy（代理）<\/caption>/);
  assert.doesNotMatch(tables.join(''), /<th>メンバー<\/th>/);
  assert.match(tables[0], /<th>ボス<\/th>\s*<th>ダメージ<\/th>\s*<th>状態<\/th>/);
  assert.equal((tables[0].match(/data-history-id=/g) || []).length, 2);
  assert.match(tables[0], /clan-history-display">123,456<\/span>/);
  assert.match(tables[0], /clan-history-display">0<\/span>/);
  assert.match(tables[1], /clan-history-display">-<\/span>/);
  assert.match(tables[0], /data-original-damage="123456"/);
});
