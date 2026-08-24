require('ts-node/register');

const assert = require('node:assert/strict');
const test = require('node:test');
const { decrypt, encrypt, generateKey } = require('../src/utils/encrypt');

test('encrypt produces known ciphertext values', () => {
  assert.equal(encrypt('123', 'A'), 'Ej');
  assert.equal(encrypt('123456', 'ABC'), 'EkTW');
  assert.equal(encrypt('0, ', '/+'), 'Bp');
});

test('decrypt restores plaintext for supported characters', () => {
  const plaintext = '0123456789, 9876543210, ';
  const key = 'Ab9+/';

  assert.equal(decrypt(encrypt(plaintext, key), key), plaintext);
});

test('decrypt preserves the space padding added to partial blocks', () => {
  assert.equal(decrypt(encrypt('1', 'key'), 'key'), '1  ');
  assert.equal(decrypt(encrypt('12', 'key'), 'key'), '12 ');
});

test('encrypt and decrypt accept empty input', () => {
  assert.equal(encrypt('', 'key'), '');
  assert.equal(decrypt('', 'key'), '');
});

test('generateKey returns the requested number of Base64 characters', () => {
  const key = generateKey(128);

  assert.equal(key.length, 128);
  assert.match(key, /^[A-Za-z0-9+/]+$/);
  assert.equal(generateKey(0), '');
});

test('generateKey can select both ends of the character set', (context) => {
  let randomValue = 0;
  context.mock.method(Math, 'random', () => randomValue);

  assert.equal(generateKey(1), 'A');
  randomValue = 0.999999;
  assert.equal(generateKey(1), '/');
});