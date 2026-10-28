import test from 'node:test';
import assert from 'node:assert/strict';
import { FixedClock } from '../server/clock.js';

test('expensive catchup yields within a wall-time budget and discards excess debt', () => {
  let now = 0, count = 0;
  const clock = new FixedClock(12, () => now);
  assert.equal(clock.advance(8000, 1, false, () => { now += 7; count++; }), 2);
  assert.equal(count, 2);
  assert.equal(clock.droppedSteps, 38);
  assert.equal(clock.advance(0, 1, false, () => assert.fail('no stale backlog')), 0);
});
test('simulation speed is independent of timer frequency, including 8x at 1Hz', () => {
  for (const hz of [1, 5, 20]) for (const speed of [.25, .5, 1, 2, 8]) {
    let count = 0; const clock = new FixedClock();
    for (let i = 0; i < hz * 4; i++) clock.advance(1000 / hz, speed, false, () => count++);
    assert.equal(count, 20 * speed);
  }
});
test('pause discards backlog and long server stalls have a bounded catchup', () => {
  const clock = new FixedClock();
  clock.advance(100, 1, false, () => {});
  assert.equal(clock.advance(60000, 8, true, () => assert.fail()), 0);
  assert.equal(clock.advance(100, 1, false, () => assert.fail()), 0);
  assert.equal(clock.advance(60000, 8, false, () => {}), 40);
});
