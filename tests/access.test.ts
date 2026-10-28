import test from 'node:test';
import assert from 'node:assert/strict';
import { PrivateAccess } from '../server/access.js';

const secret = 'a'.repeat(64);
const basic = (password: string, username = 'admin') => `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

test('private access protects pages and upgrades and validates credentials', () => {
  const access = new PrivateAccess(true, secret);
  assert.equal(access.check(undefined), 401);
  assert.equal(access.check(basic(secret, 'other')), 401);
  assert.equal(access.check(basic('wrong')), 401);
  assert.equal(access.check(basic(secret)), 200);
  assert.equal(access.check('Basic !!!'), 401);
  assert.equal(access.check('Bearer ' + secret), 401);
});

test('private mode refuses missing, short and example passwords', () => {
  for (const value of ['', 'short', 'replace-with-a-long-random-secret']) {
    assert.throws(() => new PrivateAccess(true, value));
  }
  assert.doesNotThrow(() => new PrivateAccess(false, ''));
});

test('failed authentication is bounded across connections and recovers after cooldown', () => {
  let now = 0;
  const access = new PrivateAccess(true, secret, () => now);
  for (let i = 0; i < 6; i++) assert.equal(access.check(basic('wrong')), 401);
  assert.equal(access.check(basic('wrong')), 429);
  // Failed attempts must not lock out the owner with correct credentials.
  assert.equal(access.check(basic(secret)), 200);
  now = 10_000;
  assert.equal(access.check(basic('wrong')), 401);
});

test('request budget covers authenticated floods and resets over time', () => {
  let now = 0;
  const access = new PrivateAccess(true, secret, () => now);
  for (let i = 0; i < 60; i++) assert.equal(access.check(basic(secret)), 200);
  assert.equal(access.check(basic(secret)), 429);
  now = 100;
  assert.equal(access.check(basic(secret)), 200);
});

test('anonymous liveness probes share the global request budget', () => {
  const access = new PrivateAccess(true, secret, () => 0);
  for (let i = 0; i < 60; i++) assert.equal(access.probe(), true);
  assert.equal(access.probe(), false);
  assert.equal(access.check(basic(secret)), 429);
});
