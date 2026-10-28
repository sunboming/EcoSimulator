import test from 'node:test';
import assert from 'node:assert/strict';
import { weatherAt, naturalClimateAt, naturalHash } from '../shared/nature.js';
import { World } from '../server/world.js';

test('weather has reproducible forecasts and modifies actual climate without rewriting base parameters', () => {
  const w = new World(40, 32, 42, 100);
  const forecast = weatherAt(0, w.seed);
  const active = weatherAt(forecast.nextTick, w.seed);
  assert.notEqual(active.kind, 'clear'); assert.equal(active.kind, forecast.nextKind);
  assert.deepEqual(active, weatherAt(forecast.nextTick, w.seed));
  const base = { ...w.params };
  const actual = naturalClimateAt(forecast.nextTick, w.params, w.seed, true);
  const plain = naturalClimateAt(forecast.nextTick, w.params, w.seed, false);
  assert.ok(actual.rain !== plain.rain || actual.temperature !== plain.temperature || actual.daylight !== plain.daylight);
  assert.deepEqual(w.params, base);
});

test('natural processes continue without viewers, respect pause and survive exact restore', () => {
  const w = new World(40, 32, 42, 100);
  for (let i = 0; i < 470; i++) w.step();
  assert.ok(w.events.some(e => e.kind === 'weather'));
  const restored = World.restore(w.export());
  w.step(); restored.step(); assert.deepEqual(restored.export(), w.export());
  w.configure({ paused: true }); const before = w.export(); w.step(); assert.deepEqual(w.export(), before);
});

test('migration enters at traversable borders, obeys capacity and is distinct from births', () => {
  const w = new World(64, 48, 42, 30); w.animals = [];
  w.tick = 449; w.step();
  assert.ok(w.animals.length > 0); assert.equal(w.births, 0);
  assert.ok(w.animals.every(a => w.terrain[Math.floor(a.y) * w.width + Math.floor(a.x)] === 1 && Math.min(a.x, a.y, w.width - a.x, w.height - a.y) < 5));
  assert.ok(w.events.some(e => e.kind === 'migration'));
  assert.ok(w.animals.length <= w.maxAnimals);
});

test('nature switches validate atomically and legacy saves acquire defaults', () => {
  const w = new World(40, 32, 42, 100);
  assert.throws(() => w.configureNature({ weather: false, migration: 'yes' } as any));
  assert.equal(w.nature.weather, true);
  w.configureNature({ weather: false, migration: false, disasters: false });
  assert.equal(World.restore(w.export()).nature.weather, false);
  const legacy = w.export(); delete legacy.nature;
  assert.equal(World.restore(legacy).nature.weather, true);
  const corrupt = w.export(); corrupt.nature = { weather: true, migration: true, disasters: 'bad' } as any;
  assert.throws(() => World.restore(corrupt));
});

test('weather changes habitat water budgets and disabled weather preserves background climate', () => {
  const wet = new World(40, 32, 42, 100), plain = World.restore(wet.export());
  wet.animals = []; plain.animals = []; plain.configureNature({ weather: false, migration: false, disasters: false });
  wet.configureNature({ migration: false, disasters: false });
  for (let i = 0; i < 350; i++) { wet.step(); plain.step(); }
  assert.notEqual(wet.habitat.summary().moisture, plain.habitat.summary().moisture);
});

test('natural fire requires fuel and dry conditions and persists its actual damage', () => {
  const w = new World(64, 48, 42, 100); w.animals = [];
  w.configureNature({ weather: false, migration: false }); w.configure({ temperature: 45 });
  w.habitat.moisture.fill(2); w.plants.fill(80);
  let tick = 100; while (naturalHash(w.seed, tick, 981) >= .22) tick += 100;
  w.tick = tick - 1; w.habitat.updated.fill(w.tick);
  const before = w.habitat.totalPlants; w.step();
  const event = w.events.find(e => e.kind === 'wildfire');
  assert.ok(event && event.x !== undefined && event.radius! > 0);
  assert.ok(w.habitat.totalPlants < before);
  assert.ok(World.restore(w.export()).events.some(e => e.kind === 'wildfire'));
  const damp = new World(40, 32, 42, 100); damp.habitat.moisture.fill(100);
  assert.equal(damp.fireRisk(), 0);
});
