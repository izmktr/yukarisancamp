require('ts-node/register');

const assert = require('node:assert/strict');
const test = require('node:test');
const { remainTime } = require('../src/utils/damagecalc');
const { buildClanAttackMemberStatus } = require('../src/utils/attackStatus');

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
