import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../server/world.js';
import { climateAt } from '../shared/climate.js';

test('calendar drives day/night, seasonal temperature and breeding windows deterministically', () => {
  const w = new World(40, 30, 42, 100);
  const spring = climateAt(0, w.params), winter = climateAt(600 * 18, w.params);
  assert.notEqual(climateAt(0, w.params).daylight, climateAt(300, w.params).daylight);
  assert.equal(winter.season, '冬季'); assert.ok(winter.temperature < spring.temperature);
  assert.ok(winter.breeding < spring.breeding);
});
test('soil retains rain, drought dries it gradually, detritus decomposes into nutrients', () => {
  const w = new World(40, 30, 42, 100); w.animals = [];
  const a = w.habitat.soilAt(5, 5); w.configure({ rain: 0, temperature: 40 });
  for (let i = 0; i < 200; i++) w.step();
  assert.ok(w.habitat.soilAt(5, 5).moisture < a.moisture);
  const before = w.habitat.soilAt(5, 5); w.habitat.addDetritus(5, 5, 20);
  w.configure({ rain: 2, temperature: 20 });
  for (let i = 0; i < 150; i++) w.step();
  const after = w.habitat.soilAt(5, 5);
  assert.ok(after.detritus < before.detritus + 20); assert.ok(after.nutrients > before.nutrients);
});
test('dehydration kills, shoreline drinking restores hydration', () => {
  const w = new World(40, 30, 42, 100); const a = w.animals[0]; w.animals = [a]; a.hydration = 0; w.step(); assert.equal(w.animals.length, 0);
  const v = new World(40, 30, 42, 100), b = v.animals.find(a => a.species === 'grazer')!;
  let shore = -1, water = -1;
  for (let i = 1; i < v.terrain.length; i++) if (v.terrain[i] === 1 && v.terrain[i - 1] === 0 && i % v.width) { shore = i; water = i - 1; break; }
  assert.ok(shore >= 0); v.animals = [b]; b.x = shore % v.width + .5; b.y = Math.floor(shore / v.width) + .5; b.hydration = 20; b.waterX = water % v.width + .5; b.waterY = Math.floor(water / v.width) + .5;
  v.step(); assert.ok(b.hydration > 20); assert.equal(b.action, '饮水');
});
test('a mate and gestation are required; juveniles are born with a mother link', () => {
  const w = new World(40, 30, 42, 100), mother = w.animals.find(a => a.species === 'grazer')!;
  w.animals = [mother]; mother.sex = 'female'; mother.age = 100; mother.cooldown = 0; mother.energy = 130;
  for (let i = 0; i < 100; i++) w.step(); assert.equal(w.births, 0);
  const father = { ...mother, id: w.nextId++, sex: 'male' as const, x: mother.x, y: mother.y, energy: 130 };
  w.animals.push(father); w.configure({ grazerBirthRate: 2.5 });
  for (let i = 0; i < 200 && !mother.gestation; i++) { mother.energy = 130; father.energy = 130; father.x = mother.x; father.y = mother.y; w.step(); }
  assert.ok(mother.gestation > 0); assert.equal(w.births, 0);
  mother.gestation = .1; w.step(); const baby = w.animals.find(a => a.motherId === mother.id);
  assert.ok(baby && baby.age < 1); assert.equal(w.births, 1);
});
test('large worlds use bounded region work and compressed, exact saves', () => {
  const w = new World(1024, 768, 42, 100);
  w.step(); assert.ok(w.habitat.updatedRegions <= 66);
  const save = w.export(); assert.equal(save.version, 2);
  assert.ok(JSON.stringify(save).length < 8_000_000);
  const restored = World.restore(JSON.parse(JSON.stringify(save)));
  w.step(); restored.step(); assert.deepEqual(w.export(), restored.export());
});

test('pregnancy energy exhaustion removes the mother before saving', () => {
  const w = new World(40, 30, 42, 100), mother = w.animals[0]; w.animals = [mother];
  w.configure({ metabolism: .5, temperature: 20 }); mother.sex = 'female'; mother.gestation = 10;
  mother.energy = .2; mother.hydration = 100;
  // Arrange a positive post-metabolic reserve smaller than the pregnancy cost.
  const probe = World.restore(w.export()); probe.animals[0].gestation = 0; probe.step();
  const metabolism = .2 - probe.animals[0].energy;
  mother.energy = metabolism + .005;
  w.step(); assert.equal(w.animals.length, 0); assert.doesNotThrow(() => World.restore(w.export()));
});
test('expanding the frontier preserves organisms and existing habitat cells', () => {
  const w = new World(40, 32, 42, 100); const a = structuredClone(w.animals), old = w.plants[12 * w.width + 10];
  w.expand(); assert.equal(w.width, 80); assert.equal(w.height, 64);
  assert.deepEqual(w.animals, a); assert.equal(w.plants[12 * w.width + 10], old);
});

test('legacy v1 arrays migrate without resetting the population or clock', () => {
  const w = new World(40, 32, 42, 100); w.step();
  const legacy: any = { ...w.export(), version: 1, terrain: Array.from(w.terrain), plants: Array.from(w.plants) };
  delete legacy.habitat; delete legacy.plantEncoding; delete legacy.focus;
  for (const animal of legacy.animals) { delete animal.hydration; delete animal.sex; delete animal.gestation; }
  const restored = World.restore(legacy);
  assert.equal(restored.tick, w.tick); assert.equal(restored.animals.length, w.animals.length);
  assert.equal(restored.animals[0].hydration, 80); assert.equal(restored.animals[0].gestation, 0);
  assert.doesNotThrow(() => { restored.step(); World.restore(restored.export()); });
});
