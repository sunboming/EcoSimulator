import test from 'node:test';
import assert from 'node:assert/strict';
import { controlKind, displayNumber, ParameterSensitivity, formatTimecode, parseTimecode } from '../shared/parameter-presentation.js';
import { World } from '../server/world.js';

test('display precision is compact without changing underlying parameter values', () => {
  assert.equal(displayNumber(1.37219000000001), '1.37');
  assert.equal(displayNumber(.007654321123), '0.00765');
  assert.equal(displayNumber(86.643397569993), '86.64');
  const w = new World(40, 32, 42, 100); w.configure({ rain: 1.37219000001 });
  displayNumber(w.params.rain); assert.equal(w.params.rain, 1.37219000001);
});
test('fine mode is isolated for each parameter and retained on unrelated toggles', () => {
  const sensitivity = new ParameterSensitivity();
  sensitivity.toggle('rain'); assert.equal(sensitivity.factor('rain'), .1); assert.equal(sensitivity.factor('temperature'), 1);
  sensitivity.toggle('temperature'); sensitivity.toggle('rain'); assert.equal(sensitivity.factor('rain'), 1); assert.equal(sensitivity.factor('temperature'), .1);
});
test('control mapping distinguishes multipliers, temperatures, thresholds, times and rates', () => {
  assert.equal(controlKind('rain'), 'rotary'); assert.equal(controlKind('temperature'), 'temperature');
  assert.equal(controlKind('moistureThreshold'), 'fader'); assert.equal(controlKind('grazerMaturity'), 'time');
  assert.equal(controlKind('decayRate'), 'rate');
  assert.equal(controlKind('mateRadius'), 'distance'); assert.equal(controlKind('grazerAssimilation'), 'coefficient');
});
test('timecodes support fractional seconds and carry display rounding into minutes', () => {
  assert.equal(formatTimecode(59.9999), '01:00.00'); assert.equal(formatTimecode(74.125), '01:14.13');
  assert.equal(parseTimecode('01:14.125'), 74.125); assert.equal(parseTimecode('74.125'), 74.125);
  assert.throws(() => parseTimecode('1:65')); assert.throws(() => parseTimecode('bad'));
});
