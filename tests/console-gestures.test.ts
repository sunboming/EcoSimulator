import test from 'node:test';
import assert from 'node:assert/strict';
import { angleDelta, dragValue } from '../client/console-gestures.js';

test('rotary movement crosses the angle boundary continuously instead of jumping', () => {
  assert.equal(angleDelta(179, -179), 2);
  assert.equal(angleDelta(-179, 179), -2);
  assert.equal(angleDelta(90, 135), 45);
});
test('dial and scrub drags are continuous, bounded and support fine sensitivity', () => {
  assert.equal(dragValue('rain', 1, 24), 1.2);
  assert.equal(dragValue('rain', 1, 24, .1), 1.02);
  assert.ok(Math.abs(dragValue('rain', 1, 90, 1, true) - (1 + 2 / 3)) < 1e-13);
  assert.equal(dragValue('rain', 1.99, 24), 2);
  assert.equal(dragValue('temperature', -9, -240), -10);
  const fine = dragValue('decayRate', .007654321, .123456, .01);
  assert.ok(fine > .007654321 && fine < .007655321);
  assert.equal(dragValue('rain', 1, NaN), 1);
});
