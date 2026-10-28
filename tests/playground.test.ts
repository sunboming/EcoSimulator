import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../server/world.js';
import { environmentDefaults, parameterSpecs } from '../shared/environment.js';

test('all playground parameters validate atomically and old saves gain defaults', () => {
  const w = new World(40, 30, 42, 100);
  assert.equal(Object.keys(parameterSpecs).length, 13);
  w.configure({ temperature: -5, sunlight: .5, grazerBirthRate: 0, mutation: 3 });
  assert.equal(w.params.temperature, -5);
  const before = { ...w.params };
  assert.throws(() => w.configure({ rain: 2, vision: 99 })); assert.deepEqual(w.params, before);
  const legacy = w.export(); legacy.params = { paused: true, speed: 1, rain: 1, fertility: 1, metabolism: 1 } as never;
  const restored = World.restore(legacy); assert.equal(restored.params.temperature, environmentDefaults.temperature); assert.equal(restored.params.paused, true);
});
test('sunlight and temperature affect plant growth, nutrition affects grazing energy', () => {
  const make = () => { const w = new World(40, 30, 42, 100); w.animals = []; w.plants.fill(0); return w; };
  const normal = make(), dark = make(), frozen = make();
  dark.configure({ sunlight: 0 }); frozen.configure({ temperature: -10 });
  for (let i = 0; i < 25; i++) { normal.step(); dark.step(); frozen.step(); }
  assert.ok(normal.stats().plants > dark.stats().plants); assert.ok(normal.stats().plants > frozen.stats().plants);
  const low = new World(40, 30, 8, 100), high = new World(40, 30, 8, 100);
  for (const w of [low, high]) { w.animals = [w.animals.find(a => a.species === 'grazer')!]; w.animals[0].energy = 50; w.plants.fill(80); }
  high.configure({ plantNutrition: 2 }); low.step(); high.step(); assert.ok(high.animals[0].energy > low.animals[0].energy);
});
test('species speed and lifespan change movement and survival; reproduction can be disabled', () => {
  const a = new World(40, 30, 8, 100), b = new World(40, 30, 8, 100);
  for (const w of [a, b]) { w.animals = [w.animals.find(a => a.species === 'grazer')!]; w.animals[0].energy = 130; w.animals[0].age = 100; w.animals[0].cooldown = 0; }
  b.configure({ grazerSpeed: 1.8, grazerBirthRate: 0, lifespan: .5 });
  const origin = { x: a.animals[0].x, y: a.animals[0].y }; a.step(); b.step();
  assert.ok(Math.hypot(b.animals[0].x - origin.x, b.animals[0].y - origin.y) > Math.hypot(a.animals[0].x - origin.x, a.animals[0].y - origin.y));
  b.animals[0].age = 401; b.step(); assert.equal(b.animals.length, 0);
  a.configure({ grazerBirthRate: 0 }); for (let i = 0; i < 500; i++) a.step(); assert.equal(a.births, 0);
});
test('interventions can revive extinct species, respect the cap and persist their log', () => {
  const w = new World(40, 30, 42, 100); w.animals = []; w.plants.fill(0);
  w.intervene('seed'); assert.ok(w.stats().plants > 0);
  w.intervene('grazers'); assert.equal(w.stats().grazers, 20);
  w.intervene('hunters'); assert.equal(w.stats().hunters, 5);
  for (let i = 0; i < 10; i++) w.intervene('grazers'); assert.equal(w.animals.length, 100);
  const biomass = w.stats().plants; w.intervene('fire'); assert.ok(w.stats().plants < biomass);
  assert.throws(() => w.intervene('unknown' as never));
  assert.deepEqual(World.restore(w.export()).events, w.events); assert.ok(w.events.length <= 12);
});
test('interventions update the shared history while paused without advancing time', () => {
  const w = new World(40, 30, 42, 100); w.animals = [];
  for (let i = 0; i < 7; i++) w.step();
  w.configure({ paused: true }); const tick = w.tick;
  w.intervene('grazers');
  assert.equal(w.tick, tick); assert.equal(w.history.at(-1)!.tick, tick); assert.equal(w.history.at(-1)!.grazers, 20);
  const length = w.history.length;
  w.intervene('hunters');
  assert.equal(w.history.length, length); assert.equal(w.history.at(-1)!.hunters, 5);
  const restored = World.restore(w.export()); restored.step();
  assert.equal(restored.tick, tick); assert.equal(restored.params.paused, true); assert.equal(restored.events.length, 2);
});
