require('ts-node/register');

const assert = require('node:assert/strict');
const test = require('node:test');
const { remainTime } = require('../src/utils/damagecalc');
const { buildClanAttackMemberStatus, sortClanAttackMembers } = require('../src/utils/attackStatus');

test('attack members sort carry-over first, then shorter carry time, then larger damage', () => {
  const member = (name, overattack, sortie, attacktime, damage) => ({
    name, overattack, sortie, attacktime, damage
  });
  const members = [
    member('通常小', 0, 1, [null, null, null], 100),
    member('持越50', 1, 1, [50, null, null], 0),
    member('通常大', 0, 2, [0, null, null], 900),
    member('持越20小', 1, 2, [0, 20, null], 100),
    member('持越20大', 1, 1, [20, null, null], 500),
    member('通常未入力', 0, 1, [null, null, null], null)
  ];

  assert.deepEqual(
    sortClanAttackMembers(members).map((item) => item.name),
    ['持越20大', '持越20小', '持越50', '通常大', '通常小', '通常未入力']
  );
});

test('attack member sort keeps original order for ties', () => {
  const members = [
    { name: 'A', overattack: 0, sortie: 1, attacktime: [null], damage: 300 },
    { name: 'B', overattack: 0, sortie: 1, attacktime: [null], damage: 300 }
  ];

  assert.deepEqual(sortClanAttackMembers(members).map((item) => item.name), ['A', 'B']);
});

test('remainTime caps leftover at 90 seconds', () => {
  assert.equal(remainTime(100, 100), 20);
  assert.equal(remainTime(900, 100), 90);
});

test('solo kill shows leftover seconds', () => {
  const member = { memberid: '1', name: '自分', damage: 1200, overattack: 0 };
  assert.equal(
    buildClanAttackMemberStatus(member, [member], 1000),
    `→${remainTime(1200, 1000)}秒`
  );
});

test('solo kill on carry-over shows 持越', () => {
  const member = { memberid: '1', name: '自分', damage: 1200, overattack: 1 };
  assert.equal(buildClanAttackMemberStatus(member, [member], 1000), '[持越]');
});

test('combined kill shows top 3 other leftover times', () => {
  const self = { memberid: 'self', name: '自分', damage: 500, overattack: 0 };
  const a = { memberid: 'a', name: 'Alice', damage: 900, overattack: 0 };
  const b = { memberid: 'b', name: 'Bob', damage: 700, overattack: 0 };
  const c = { memberid: 'c', name: 'Carol', damage: 600, overattack: 0 };
  const d = { memberid: 'd', name: 'Dave', damage: 550, overattack: 0 };
  const remainHp = 1000 - 500;

  assert.equal(
    buildClanAttackMemberStatus(self, [self, a, b, c, d], 1000),
    `Alice→${remainTime(900, remainHp)}秒、Bob→${remainTime(700, remainHp)}秒、Carol→${remainTime(600, remainHp)}秒`
  );
});

test('combined kill hides members who cannot finish the remaining hp', () => {
  const self = { memberid: 'self', name: '自分', damage: 300, overattack: 0 };
  const a = { memberid: 'a', name: 'Alice', damage: 800, overattack: 0 };
  const b = { memberid: 'b', name: 'Bob', damage: 500, overattack: 0 };
  const c = { memberid: 'c', name: 'Carol', damage: 400, overattack: 0 };
  const remainHp = 1000 - 300;

  const status = buildClanAttackMemberStatus(self, [self, a, b, c], 1000);

  assert.equal(status, `Alice→${remainTime(800, remainHp)}秒`);
  assert.doesNotMatch(status, /-\d+秒/);
});

test('combined kill shows nothing when no one can finish alone', () => {
  const self = { memberid: 'self', name: '自分', damage: 300, overattack: 0 };
  const a = { memberid: 'a', name: 'Alice', damage: 400, overattack: 0 };
  const b = { memberid: 'b', name: 'Bob', damage: 400, overattack: 0 };

  assert.equal(buildClanAttackMemberStatus(self, [self, a, b], 1000), '');
});

test('does not show status when own damage is 0', () => {
  const self = { memberid: 'self', name: '自分', damage: 0, overattack: 0 };
  const other = { memberid: 'a', name: 'Alice', damage: 1200, overattack: 0 };
  assert.equal(buildClanAttackMemberStatus(self, [self, other], 1000), '');

  const unreported = { memberid: 'self', name: '自分', damage: null, overattack: 1 };
  assert.equal(buildClanAttackMemberStatus(unreported, [unreported, other], 1000), '');
});

test('does not show status when total damage does not exceed boss hp', () => {
  const self = { memberid: 'self', name: '自分', damage: 100, overattack: 0 };
  const other = { memberid: 'a', name: 'Alice', damage: 100, overattack: 0 };
  assert.equal(buildClanAttackMemberStatus(self, [self, other], 1000), '');
});
