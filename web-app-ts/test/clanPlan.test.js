require('ts-node/register');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const ejs = require('ejs');
const { selectMainAttacks, buildClanPlan } = require('../src/utils/clanPlan');
const row = (extra = {}) => ({ id: 1, clanid: 'c', memberid: 'm', day: '2026-10-24', sortie: 1, sortiecount: 2, boss: 1, attacklap: 23, overtime: 0, ...extra });

test('main attack selection handles 50-second boundary and incomplete carry-over', () => {
  for (const overtime of [20, 50, 60, 90]) {
    const first = row({ sortiecount: 1, overtime, boss: 1 });
    const second = row({ id: 2, sortiecount: 1, overtime: 0, boss: 2 });
    assert.equal(selectMainAttacks([second, first])[0].boss, overtime <= 50 ? 1 : 2);
    assert.equal(selectMainAttacks([first]).length, overtime <= 50 ? 1 : 0);
  }
});

test('lap filtering happens after selection; groups separate members and dates', () => {
  assert.deepEqual(selectMainAttacks([
    row({ sortiecount: 1, overtime: 20, attacklap: 22 }),
    row({ id: 2, sortiecount: 1, overtime: 0, attacklap: 23 })
  ]), []);
  assert.equal(selectMainAttacks([row(), row({ memberid: 'other' }), row({ day: '2026-10-25' })]).length, 3);
});

test('member plans preserve counts but exclude all pending attacks of members with excess', () => {
  const histories = [row(), row({ id: 2, sortie: 2 }), row({ id: 3, sortie: 3, boss: 5 }),
    row({ id: 4, day: '2026-10-25' }), row({ id: 5, day: '2026-10-25', sortie: 2, boss: 3 })];
  const result = buildClanPlan(histories, [{ memberid: 'm', name: 'Member' }], [24, 24, 24, 24, 24], '2026-10-25', '2026-10-24', '2026-10-29');
  assert.deepEqual(result.memberPlans[0], {
    memberid: 'm', name: 'Member', planned: [2, 0, 0, 0, 1], done: [1, 0, 1, 0, 0], maxDamage: Array(5).fill(null)
  });
  assert.deepEqual(result.bosses.map(b => b.remaining), Array(5).fill(0));
  assert.equal(result.bosses[2].landing, null);
});

test('remaining sums only predictable members and landing uses the revised remaining', () => {
  const plans = [
    { memberid: 'steady', planned: [3, 0, 0, 0, 0], done: [1, 0, 0, 0, 0] },
    { memberid: 'moved', planned: [0, 2, 1, 0, 0], done: [1, 0, 0, 0, 0] },
    { memberid: 'finished', planned: [0, 0, 0, 0, 1], done: [0, 0, 0, 0, 1] },
    { memberid: 'idle', planned: [0, 0, 0, 0, 0], done: [0, 0, 0, 0, 0] }
  ];
  const histories = [];
  for (const m of plans) {
    for (const [day, counts] of [['2026-10-24', m.planned], ['2026-10-25', m.done]]) {
      let sortie = 0;
      counts.forEach((n, i) => {
        for (let j = 0; j < n; j++) {
          histories.push(row({ id: histories.length + 1, memberid: m.memberid, day, boss: i + 1,
            sortie: ++sortie, attacklap: day === '2026-10-24' ? 23 : 24 }));
        }
      });
    }
  }
  const result = buildClanPlan(histories, plans.map(m => ({ memberid: m.memberid, name: m.memberid })),
    [24, 24, 24, 24, 24], '2026-10-25', '2026-10-24', '2026-10-29');
  assert.deepEqual(result.bosses.map(b => b.remaining), [2, 0, 0, 0, 0]);
  // Both actual attacks still count, including the member excluded from the prediction.
  assert.equal(result.bosses[0].done, 2);
  assert.deepEqual(result.bosses[0].landing, { lap: 25, attacks: 1 });
  assert.equal(result.bosses[1].landing, null);
  const total = key => result.bosses.reduce((sum, b) => sum + b[key], 0);
  assert.equal(total('planned') - total('done') - total('remaining'), 2);
});

test('average covers completed laps and projection includes current-lap attacks', () => {
  const histories = [row(), row({ id: 2, sortie: 2 }), row({ id: 3, sortie: 3 }),
    row({ id: 4, day: '2026-10-25', attacklap: 24 })];
  const result = buildClanPlan(histories, [], [24, 23, 23, 23, 23], '2026-10-25', '2026-10-24', '2026-10-29');
  assert.equal(result.bosses[0].average, 3);
  assert.deepEqual(result.bosses[0].landing, { lap: 25, attacks: 0 });
  assert.equal(result.bosses[1].average, null);
  const firstDay = buildClanPlan(histories, [], [24, 23, 23, 23, 23], '2026-10-24', '2026-10-24', '2026-10-29');
  assert.equal(firstDay.hasPrevious, false);
  assert.equal(firstDay.bosses[0].landing, null);
});

const planData = {
  clan: { name: 'Test Clan' },
  baseDate: '2026-10-25',
  startDate: '2026-10-24',
  endDate: '2026-10-29',
  bossNames: ['とても長いボス名'.repeat(8), 'Two', '', 'Four', '<Five>']
};
const planSummary = {
  previousAttacks: 30,
  completedAttacks: 25,
  inPeriod: true,
  hasPrevious: true,
  memberPlans: [{ memberid: 'm', name: 'Member', planned: [1, 0, 2, 3, 0], done: [1, 1, 1, 3, 0] }],
  bosses: Array.from({ length: 5 }, (_, i) => ({
    boss: i + 1, lap: 24 + i, current: i, average: i === 1 ? null : 3.25,
    landing: i === 1 ? null : { lap: 25 + i, attacks: i },
    planned: i + 3, done: i + 2, remaining: 1
  }))
};
const renderPlan = (summary = planSummary, loadError = '', bossImageUrls = [], data = planData) => ejs.renderFile(
  path.join(__dirname, '../views/clan-plan.ejs'),
  {
    data, summary: summary && {
      ...summary,
      memberPlans: summary.memberPlans.map(m => ({ maxDamage: Array(5).fill(null), ...m }))
    }, loadError, bossImageUrls
  }
);
const summaryRows = html => {
  const table = html.match(/<table class="plan-summary-table">[\s\S]*?<\/table>/)[0];
  return table.match(/<tbody>[\s\S]*?<\/tbody>/)[0].match(/<tr\b[\s\S]*?<\/tr>/g);
};
const cellText = rowHtml => [...rowHtml.matchAll(/<td>([\s\S]*?)<\/td>/g)]
  .map(match => match[1].replace(/<span class="plan-unknown is-empty"[^>]*>[^<]*<\/span>/g, '').replace(/<[^>]*>/g, '').trim());

test('plan target date shows the one-based battle day only during the battle period', async () => {
  for (const [baseDate, expectedDay] of [['2026-10-24', 1], ['2026-10-25', 2], ['2026-10-29', 6]]) {
    const html = await renderPlan(planSummary, '', [], { ...planData, baseDate });
    assert.ok(html.includes(`<p>対象日：${baseDate}（${expectedDay}日目）</p>`));
    assert.doesNotMatch(html, /基準日|日本時間5時切り替え/);
  }
  for (const data of [
    { ...planData, baseDate: '2026-10-23' },
    { ...planData, baseDate: '2026-10-30' },
    { ...planData, startDate: '', endDate: '' }
  ]) {
    const html = await renderPlan({ ...planSummary, inPeriod: false, hasPrevious: false }, '', [], data);
    assert.ok(html.includes(`<p>対象日：${data.baseDate}</p>`));
    assert.doesNotMatch(html, /（\d+日目）|基準日|日本時間5時切り替え/);
  }
});

test('plan summary renders five boss columns, totals and all six metrics alongside members', async () => {
  const html = await renderPlan();
  const rows = summaryRows(html);
  const summaryTable = html.match(/<table class="plan-summary-table">[\s\S]*?<\/table>/)[0];
  assert.equal((summaryTable.match(/<th scope="col"(?=[ >])/g) || []).length, 7);
  assert.match(html, /<th scope="col">合計<\/th>\s*<\/tr>/);
  assert.equal(rows.length, 6);
  rows.forEach(rowHtml => assert.equal(cellText(rowHtml).length, 6));
  assert.match(html, new RegExp(planData.bossNames[0]));
  assert.doesNotMatch(html, /class="plan-boss-name">ボス3<\/span>/);
  assert.match(html, /&lt;Five&gt;/);
  assert.deepEqual(cellText(rows[0]), ['24周目 + 0凸', '25周目 + 1凸', '26周目 + 2凸', '27周目 + 3凸', '28周目 + 4凸', '—']);
  assert.deepEqual(cellText(rows[1]), ['3.3凸', '算出不可', '3.3凸', '3.3凸', '3.3凸', '算出不可']);
  assert.deepEqual(cellText(rows[2]), ['25周目 + 0凸', '—', '27周目 + 2凸', '28周目 + 3凸', '29周目 + 4凸', '—']);
  assert.deepEqual(cellText(rows[3]), ['3凸', '4凸', '5凸', '6凸', '7凸', '25凸']);
  assert.deepEqual(cellText(rows[4]), ['2凸', '3凸', '4凸', '5凸', '6凸', '20凸']);
  assert.deepEqual(cellText(rows[5]), [...Array(5).fill('1凸'), '5凸']);
  assert.match(html, /class="plan-members-table"/);
  assert.match(html, /class="plan-member-name">Member<\/span>/);
});

test('plan summary keeps unavailable values explicit on the first day and outside the period', async () => {
  for (const inPeriod of [true, false]) {
    const html = await renderPlan({
      ...planSummary, inPeriod, hasPrevious: false,
      bosses: planSummary.bosses.map(b => ({ ...b, landing: null }))
    });

    const rows = summaryRows(html);
    for (const index of [2, 3, 5]) {
      assert.deepEqual(cellText(rows[index]), Array(6).fill('—'));
    }
    assert.deepEqual(cellText(rows[4]), inPeriod ? ['2凸', '3凸', '4凸', '5凸', '6凸', '20凸'] : Array(6).fill('—'));
    assert.match(html, inPeriod ? /開催初日のため/ : /開催期間外/);
  }
});

test('member plans include idle and unchanged members, keep identities and match boss totals', () => {
  const members = [
    { memberid: 'm', name: 'Same' },
    { memberid: 'peer', name: 'Same' },
    { memberid: 'idle', name: 'Idle' }
  ];
  const histories = [row(), row({ id: 2, day: '2026-10-25' }),
    row({ id: 3, memberid: 'peer', boss: 2 }),
    row({ id: 4, memberid: 'peer', day: '2026-10-25', boss: 3 }),
    row({ id: 5, memberid: 'former', day: '2026-10-25', boss: 5 })];
  const result = buildClanPlan(histories, members, [24, 24, 24, 24, 24], '2026-10-25', '2026-10-24', '2026-10-29');
  assert.deepEqual(result.memberPlans.map(m => m.memberid), ['m', 'peer', 'idle', 'former']);
  assert.equal(result.memberPlans[3].name, 'former');
  assert.deepEqual(result.memberPlans[0].planned, result.memberPlans[0].done);
  assert.deepEqual(result.memberPlans[2].planned, Array(5).fill(0));
  assert.deepEqual(result.memberPlans[2].done, Array(5).fill(0));
  result.bosses.forEach((b, i) => {
    assert.equal(result.memberPlans.reduce((sum, m) => sum + m.planned[i], 0), b.planned);
    assert.equal(result.memberPlans.reduce((sum, m) => sum + m.done[i], 0), b.done);
  });
});

const memberTable = html => html.match(/<table class="plan-members-table"[\s\S]*?<\/table>/)[0];

test('maximum damage is scoped to member, boss, current event and selected main attacks from lap 23', async () => {
  const histories = [
    row({ damage: 10000000 }),
    row({ id: 2, sortie: 2, damage: 23456789 }),
    row({ id: 3, sortie: 3, damage: null }),
    row({ id: 4, day: '2026-10-25', attacklap: 22, damage: 999999999 }),
    row({ id: 5, day: '2026-10-25', sortie: 2, boss: 2, damage: 0 }),
    row({ id: 6, day: '2026-10-25', sortie: 3, boss: 3, sortiecount: 1, overtime: 60, damage: 999999999 }),
    row({ id: 7, day: '2026-10-25', sortie: 3, boss: 4, sortiecount: 1, overtime: 0, damage: 34567890 }),
    row({ id: 8, day: '2026-10-23', damage: 999999999 }),
    row({ id: 9, day: '2026-10-26', damage: 999999999 }),
    row({ id: 10, memberid: 'peer', damage: 76543210 })
  ];
  const members = [{ memberid: 'm', name: 'Member' }, { memberid: 'peer', name: 'Peer' }, { memberid: 'idle', name: 'Idle' }];
  const result = buildClanPlan(histories, members, [24, 24, 24, 24, 24], '2026-10-25', '2026-10-24', '2026-10-29');
  assert.deepEqual(result.memberPlans[0].maxDamage, [23456789, 0, null, 34567890, null]);
  assert.deepEqual(result.memberPlans[1].maxDamage, [76543210, null, null, null, null]);
  assert.deepEqual(result.memberPlans[2].maxDamage, Array(5).fill(null));
  const table = memberTable(await renderPlan(result));
  const member = table.match(/<tbody aria-label="Member">[\s\S]*?<\/tbody>/)[0];
  assert.deepEqual([...member.matchAll(/class="plan-member-damage" aria-hidden="true">([^<]+)</g)].map(m => m[1]),
    ['23,456,789', '0', '-', '34,567,890', '-']);
  assert.match(member, /最大ダメージ 23,456,789/);
  assert.match(member, /class="plan-member-status"[\s\S]*?class="plan-member-damage"/);
});

test('boss buttons sort pending members first, keep completed members last and reset ties to initial order', async () => {
  const html = await renderPlan();
  const tableHtml = memberTable(html);
  assert.equal((tableHtml.match(/class="plan-member-boss-sort"/g) || []).length, 5);
  assert.doesNotMatch(tableHtml, /plan-boss-name/);
  assert.match(tableHtml, /data-pending="true"/);
  const createMember = (name, pending, complete = false) => ({
    name,
    rows: [{
      classList: { contains: cls => cls === 'is-complete' && complete },
      cells: [{}, ...pending.map(value => ({ dataset: { pending: String(value) } }))]
    }]
  });
  const members = [
    createMember('A', [true, false]),
    createMember('B', [false, true]),
    createMember('C', [true, true]),
    createMember('Complete', [true, true], true)
  ];
  const order = members.slice();
  const buttons = Array.from({ length: 2 }, (_, index) => {
    const header = { setAttribute(key, value) { this[key] = value; } };
    return {
      dataset: { bossIndex: String(index) },
      addEventListener(event, callback) { this.click = callback; },
      setAttribute(key, value) { this[key] = value; },
      closest: () => header
    };
  });
  const table = {
    tBodies: members,
    querySelectorAll: () => buttons,
    appendChild(body) { order.splice(order.indexOf(body), 1); order.push(body); }
  };
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(script, { document: { querySelector: () => table } });
  buttons[1].click();
  assert.deepEqual(order.map(m => m.name), ['B', 'C', 'A', 'Complete']);
  assert.equal(buttons[1]['aria-pressed'], 'true');
  assert.equal(buttons[1].closest()['aria-sort'], 'other');
  buttons[0].click();
  assert.deepEqual(order.map(m => m.name), ['A', 'C', 'B', 'Complete']);
  assert.equal(buttons[1]['aria-pressed'], 'false');
  buttons[0].click();
  assert.deepEqual(order.map(m => m.name), ['A', 'C', 'B', 'Complete']);
});

test('completed members sort last stably and get gray rows based on all actual checks', async () => {
  const memberPlans = [
    { memberid: 'green', name: 'Green', planned: [1, 1, 1, 0, 0], done: [1, 1, 1, 0, 0] },
    { memberid: 'partial', name: 'Partial', planned: [3, 0, 0, 0, 0], done: [2, 0, 0, 0, 0] },
    { memberid: 'mixed', name: 'Mixed', planned: [2, 1, 0, 0, 0], done: [1, 1, 1, 0, 0] },
    { memberid: 'idle', name: 'Idle', planned: [3, 0, 0, 0, 0], done: [0, 0, 0, 0, 0] },
    { memberid: 'red', name: 'Red', planned: [0, 0, 0, 0, 0], done: [0, 0, 0, 0, 3] }
  ];
  const summary = { ...planSummary, memberPlans };
  const table = memberTable(await renderPlan(summary));
  assert.deepEqual([...table.matchAll(/<tbody aria-label="([^"]+)"/g)].map(m => m[1]),
    ['Partial', 'Idle', 'Green', 'Mixed', 'Red']);
  assert.equal((table.match(/class="plan-member-row is-complete"/g) || []).length, 3);
  assert.deepEqual(memberPlans.map(m => m.name), ['Green', 'Partial', 'Mixed', 'Idle', 'Red']);
  const firstDay = memberTable(await renderPlan({ ...summary, hasPrevious: false }));
  assert.equal((firstDay.match(/class="plan-member-row is-complete"/g) || []).length, 3);
  const outsidePeriod = memberTable(await renderPlan({ ...summary, inPeriod: false, hasPrevious: false }));
  assert.doesNotMatch(outsidePeriod, /is-complete/);
  assert.deepEqual([...outsidePeriod.matchAll(/<tbody aria-label="([^"]+)"/g)].map(m => m[1]),
    memberPlans.map(m => m.name));
});

test('remaining total puts unknown on a separate line and hides only zero or unavailable unknown', async () => {
  const summary = {
    ...planSummary,
    previousAttacks: 60,
    completedAttacks: 14,
    bosses: planSummary.bosses.map((b, i) => ({
      ...b, planned: i === 0 ? 60 : 0, done: i === 0 ? 14 : 0, remaining: i === 0 ? 34 : 0
    }))
  };
  const rows = summaryRows(await renderPlan(summary));
  assert.match(rows[5], /<td>34凸<span class="plan-unknown">\(不明:12凸\)<\/span><\/td>/);
  assert.match(await renderPlan(), /class="plan-unknown is-empty" aria-hidden="true">\(不明:0凸\)/);
  assert.doesNotMatch(await renderPlan({ ...summary, hasPrevious: false }), /class="plan-unknown"/);
  const negative = summaryRows(await renderPlan({
    ...summary, previousAttacks: 0, completedAttacks: 5,
    bosses: summary.bosses.map(b => ({ ...b, planned: 0, done: 1, remaining: 0 }))
  }));
  assert.match(negative[5], /\(不明:-5凸\)/);
});

test('member table combines pending, completed and extra SVGs in one row per member', async () => {
  const table = memberTable(await renderPlan());
  assert.match(table, /<th scope="col">名前<\/th>/);
  for (let boss = 1; boss <= 5; boss++) {
    assert.ok(table.includes(`data-boss-index="${boss - 1}"`));
  }
  assert.equal((table.match(/<tr class="plan-member-row\b/g) || []).length, 1);
  assert.equal((table.match(/<td\b/g) || []).length, 5);
  const cells = table.match(/<td\b[\s\S]*?<\/td>/g);
  const states = cell => [...cell.matchAll(/src="\/images\/plan-(\w+)\.svg"/g)].map(m => m[1]);
  assert.deepEqual(cells.map(states), [
    ['completed'], ['extra'], ['completed', 'pending'], ['completed', 'completed', 'completed'], []
  ]);
  assert.match(cells[4], /aria-label="予定 0凸、実績 0凸、最大ダメージ -"/);
  assert.match(cells[4], />—<\/span>/);
  assert.match(cells[1], /aria-label="予定 0凸、実績 1凸、予定より1凸多い、最大ダメージ -"/);
  assert.match(cells[3], /--plan-icon-count: 3;/);
  assert.doesNotMatch(table, /plan-member-excess/);
  assert.doesNotMatch(table, /移動元|移動先/);
});

test('plan SVG assets use a shared 48px canvas with distinct frames and check colors', () => {
  const readIcon = state => fs.readFileSync(path.join(__dirname, `../public/images/plan-${state}.svg`), 'utf8');
  for (const state of ['pending', 'completed', 'extra']) {
    assert.match(readIcon(state), /width="48" height="48" viewBox="0 0 48 48"/);
  }
  assert.match(readIcon('pending'), /<rect[^>]*width="30" height="30"/);
  assert.doesNotMatch(readIcon('pending'), /<path/);
  assert.match(readIcon('completed'), /<rect/);
  assert.match(readIcon('completed'), /stroke="#16803c" stroke-width="6"/);
  assert.doesNotMatch(readIcon('extra'), /<rect/);
  assert.match(readIcon('extra'), /stroke="#c72d36" stroke-width="6"/);
});

test('SVG slots keep unconsumed plans and append only excess checks', async () => {
  for (const [planned, done, expected] of [
    [3, 0, ['pending', 'pending', 'pending']],
    [2, 1, ['completed', 'pending']],
    [1, 2, ['completed', 'extra']],
    [0, 3, ['extra', 'extra', 'extra']]
  ]) {
    const table = memberTable(await renderPlan({
      ...planSummary,
      memberPlans: [{ memberid: 'm', name: 'Member', planned: [planned, 0, 0, 0, 0], done: [done, 0, 0, 0, 0] }]
    }));
    assert.deepEqual([...table.matchAll(/src="\/images\/plan-(\w+)\.svg"/g)].map(m => m[1]), expected);
  }
});

test('member table shows idle members, escapes names and distinguishes unavailable counts from zero', async () => {
  const memberPlans = [
    ...planSummary.memberPlans,
    { memberid: 'idle', name: '<Idle>', planned: Array(5).fill(0), done: Array(5).fill(0) }
  ];
  const table = memberTable(await renderPlan({ ...planSummary, memberPlans }));
  assert.match(table, /class="plan-member-name">&lt;Idle&gt;<\/span>/);
  assert.equal((table.match(/<tbody /g) || []).length, 2);
  for (const inPeriod of [true, false]) {
    const unavailable = memberTable(await renderPlan({ ...planSummary, memberPlans, inPeriod, hasPrevious: false }));
    assert.equal((unavailable.match(/aria-label="予定 算出不可、/g) || []).length, 10);
    assert.doesNotMatch(unavailable, /src="\/images\/plan-/);
    if (!inPeriod) {
      assert.equal((unavailable.match(/aria-label="予定 算出不可、実績 算出不可、最大ダメージ -"/g) || []).length, 10);
    } else {
      assert.match(unavailable, /aria-label="予定 算出不可、実績 1凸、最大ダメージ -"/);
      assert.match(unavailable, /class="plan-member-unavailable">実績 1凸/);
    }
  }
  const empty = await renderPlan({ ...planSummary, memberPlans: [] });
  assert.match(empty, /メンバーがいません。/);
  assert.doesNotMatch(empty, /class="plan-members-table"/);
});

test('plan totals sum unrounded averages and preserve zero counts', async () => {
  const rows = summaryRows(await renderPlan({
    ...planSummary, previousAttacks: 0, completedAttacks: 0,
    bosses: planSummary.bosses.map(b => ({ ...b, average: 3.25, planned: 0, done: 0, remaining: 0 }))
  }));
  assert.deepEqual(cellText(rows[1]), [...Array(5).fill('3.3凸'), '16.3凸']);
  for (const index of [3, 4, 5]) {
    assert.deepEqual(cellText(rows[index]), Array(6).fill('0凸'));
  }
});

test('previous and current totals include early laps without counting carry-over twice', async () => {
  const members = [{ memberid: 'm', name: 'Member' }, { memberid: 'idle', name: 'Idle' }];
  const histories = [
    row({ attacklap: 22 }),
    row({ id: 2, day: '2026-10-25', attacklap: 22, sortiecount: 1, overtime: 60 }),
    row({ id: 3, day: '2026-10-25', attacklap: 23, sortiecount: 1, overtime: 0, boss: 2 }),
    row({ id: 4, day: '2026-10-25', attacklap: 22, sortie: 2 }),
    row({ id: 5, day: '2026-10-25', attacklap: 23, sortie: 3, sortiecount: 1, overtime: 60 })
  ];
  const result = buildClanPlan(histories, members, [24, 24, 24, 24, 24],
    '2026-10-25', '2026-10-24', '2026-10-29');
  assert.equal(result.previousAttacks, 1);
  assert.equal(result.completedAttacks, 2);
  assert.equal(result.bosses.reduce((sum, b) => sum + b.done, 0), 1);
  assert.equal(result.bosses.reduce((sum, b) => sum + b.planned, 0), 0);
  assert.equal(result.bosses.reduce((sum, b) => sum + b.remaining, 0), 0);
  assert.match(summaryRows(await renderPlan(result))[5], /\(不明:-1凸\)/);
  const empty = buildClanPlan([], [], [23, 23, 23, 23, 23], '2026-10-25', '2026-10-24', '2026-10-29');
  assert.equal(empty.previousAttacks, 0);
  assert.equal(empty.completedAttacks, 0);
});

test('plan load errors still show the retry link without a summary table', async () => {
  const html = await renderPlan(null, '集計を取得できませんでした');
  assert.match(html, /role="alert">集計を取得できませんでした/);
  assert.match(html, /href="\/clan-plan">再読み込み/);
  assert.doesNotMatch(html, /class="plan-summary-table"/);
});

test('plan boss portraits use registered URLs and numbered placeholders for missing images', async () => {
  const html = await renderPlan(planSummary, '', ['https://example.test/one.png', null, null, null, 'https://example.test/five.png']);
  assert.equal((html.match(/<img class="plan-boss-image"/g) || []).length, 4);
  assert.doesNotMatch(html, /plan-boss-number/);
  assert.match(html, /src="https:\/\/example.test\/one.png" alt=""/);
  assert.match(html, /src="https:\/\/example.test\/five.png" alt=""/);
  assert.equal((html.match(/class="plan-boss-image-missing" hidden/g) || []).length, 4);
  assert.match(html, /class="plan-boss-image-missing"\s+title="画像がありません">ボス2/);
  assert.match(html, /this.hidden = true; this.nextElementSibling.hidden = false;/);
  assert.match(html, new RegExp(planData.bossNames[0]));
  const withoutImages = await renderPlan();
  assert.doesNotMatch(withoutImages, /<img class="plan-boss-image"/);
  assert.equal((withoutImages.match(/class="plan-boss-image-missing"/g) || []).length, 10);
});
