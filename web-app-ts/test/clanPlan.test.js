require('ts-node/register');
const test = require('node:test');
const assert = require('node:assert/strict');
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

test('movement offsets counts by member and boss, preserves negative remaining', () => {
  const histories = [row(), row({ id: 2, sortie: 2 }), row({ id: 3, sortie: 3, boss: 5 }),
    row({ id: 4, day: '2026-10-25' }), row({ id: 5, day: '2026-10-25', sortie: 2, boss: 3 })];
  const result = buildClanPlan(histories, [{ memberid: 'm', name: 'Member' }], [24, 24, 24, 24, 24], '2026-10-25', '2026-10-24', '2026-10-29');
  assert.deepEqual(result.movement[0].from, [1, 0, 0, 0, 1]);
  assert.deepEqual(result.movement[0].to, [0, 0, 1, 0, 0]);
  assert.equal(result.bosses[2].remaining, -1);
  assert.equal(result.bosses[2].landing, null);
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
