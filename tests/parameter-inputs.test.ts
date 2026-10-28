import test from 'node:test';
import assert from 'node:assert/strict';
import { formatParameter, environmentDefaults } from '../shared/environment.js';
import { World } from '../server/world.js';
import { auxiliaryFor, fromAuxiliary, toAuxiliary, thermalPatch, nudgeValue, validatePatch } from '../client/parameter-inputs.js';

test('parameter review displays compact percentages and small coefficients', () => {
  assert.equal(formatParameter('rain', 1.372), '137.2%');
  assert.equal(formatParameter('growthRate', .918273645), '0.918 VU/(格·s)');
  assert.equal(formatParameter('decayRate', .000000008), '8e-9 s⁻¹');
});

test('contextual unit editors round-trip decimal values without selecting fixed levels', () => {
  for (const [kind, value] of [['percent', .673219], ['minuteRate', .007654321], ['minutes', 47.125], ['halfLife', .007654321], ['degreeGain', 1.87321], ['mealEnergy', .673219]] as const) {
    assert.ok(Math.abs(fromAuxiliary(kind, toAuxiliary(kind, value)!) - value) < 1e-12, kind);
  }
  assert.equal(toAuxiliary('halfLife', 0), null);
  assert.throws(() => fromAuxiliary('halfLife', 0)); assert.throws(() => fromAuxiliary('minutes', Infinity));
  assert.equal(auxiliaryFor('grazerAssimilation'), 'mealEnergy', 'EU/VU is not a dimensionless percentage');
});

test('temperature endpoints update center and width together with atomic validation', () => {
  const before = { ...environmentDefaults };
  assert.deepEqual(thermalPatch('thermalWidth', 'high', 59.625, before), { growthOptimum: 24.8125, thermalWidth: 34.8125 });
  assert.throws(() => thermalPatch('thermalWidth', 'low', 70, before), /下限/);
  assert.throws(() => thermalPatch('thermalWidth', 'high', 1000, before), /范围/);
  assert.deepEqual(before, environmentDefaults);
  assert.throws(() => validatePatch({ growthOptimum: 24, thermalWidth: 99 }));
});

test('custom nudge amounts support fine absolute and relative adjustment and bounded edges', () => {
  assert.equal(nudgeValue('growthRate', .918273645, .000037, 1), .918310645);
  assert.equal(nudgeValue('temperature', -.3, .1, 1), -.2);
  assert.equal(nudgeValue('rain', 1, 2.375, 1, true), 1.02375);
  assert.equal(nudgeValue('rain', 1.99, .1, 1), 2);
  assert.throws(() => nudgeValue('rain', 1, -1, 1));
});

test('custom decimal values are not snapped to UI step sizes on server or restore', () => {
  const w = new World(40, 32, 42, 100);
  const patch = { rain: .83721, growthRate: .918273645, grazerMaturity: 47.125, decayRate: .007654321 };
  w.configure(patch);
  const restored = World.restore(w.export());
  for (const [key, value] of Object.entries(patch)) assert.equal(restored.params[key as keyof typeof patch], value);
});
