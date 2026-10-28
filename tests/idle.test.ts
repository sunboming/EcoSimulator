import test from 'node:test';
import assert from 'node:assert/strict';
import { IdleDeadline } from '../shared/idle.js';

test('idle time uses real elapsed time and only explicit activity extends it', () => {
  let now = 0;
  const idle = new IdleDeadline(1000, () => now);
  now = 600; assert.equal(idle.expired(), false);
  assert.equal(idle.touch(), true);
  now = 1599; assert.equal(idle.expired(), false);
  now = 1600; assert.equal(idle.expired(), true);
});

test('expired sessions cannot be revived by activity or automatic reconnect', () => {
  let now = 0;
  const idle = new IdleDeadline(1000, () => now);
  now = 2000;
  assert.equal(idle.touch(), false);
  assert.equal(idle.expired(), true);
  idle.resume();
  assert.equal(idle.expired(), false);
  now = 3000; assert.equal(idle.expired(), true);
});

test('server expiry is sticky and configuring the timeout does not reset activity', () => {
  let now = 0;
  const idle = new IdleDeadline(1000, () => now);
  now = 600; idle.configure(500);
  assert.equal(idle.expired(), true);
  idle.configure(10000);
  assert.equal(idle.expired(), true);
  idle.resume(); idle.stop();
  assert.equal(idle.touch(), false);
});
