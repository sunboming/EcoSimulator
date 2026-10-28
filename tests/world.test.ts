import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../server/world.js';

test('world allocation rejects unsafe dimensions and population limits before allocating', () => {
  for (const args of [[Infinity, 64, 42, 100], [96, 64, 42, Infinity], [2049, 64, 42, 100], [96, 64, 42, 5001]]) {
    assert.throws(() => new World(...args as [number, number, number, number]), /无效/);
  }
});

test('dense populations have bounded neighbour work even when all animals share a cell', () => {
  const w = new World(40, 30, 42, 1000), base = w.animals[0];
  let reads = 0;
  w.animals = Array.from({ length: 1000 }, (_, i) => {
    let x = base.x;
    return { ...base, id: i + 1, species: i % 2 ? 'hunter' as const : 'grazer' as const, energy: 130,
      get x() { reads++; return x; }, set x(value: number) { x = value; } };
  });
  w.nextId = 1001;
  w.step();
  assert.ok(reads < 100000, `neighbour work must stay bounded; coordinate reads: ${reads}`);
  assert.equal(w.animals.length, 1000);
});

test('restore rejects unexpected root keys that can overwrite world methods or prototype', () => {
  const w = new World(40, 30, 42, 100);
  for (const extra of ['"__proto__":{}', '"step":0']) {
    const save = JSON.parse(JSON.stringify(w.export()).replace(/}$/, `,${extra}}`));
    assert.throws(() => World.restore(save), /无效/);
  }
});

test('seeded worlds and restored worlds evolve identically', () => {
  const a = new World(40, 30, 42, 300);
  const b = new World(40, 30, 42, 300);
  for (let i = 0; i < 500; i++) { a.step(); b.step(); }
  assert.deepEqual(a.export(), b.export());
  const restored = World.restore(JSON.parse(JSON.stringify(a.export())));
  for (let i = 0; i < 100; i++) { a.step(); restored.step(); }
  assert.deepEqual(a.export(), restored.export());
});
test('pause freezes simulation and parameters reject invalid values', () => {
  const w = new World(40, 30, 5, 100);
  w.configure({ paused: true });
  const before = w.export(); w.step(); assert.deepEqual(w.export(), before);
  assert.throws(() => w.configure({ rain: -1 }));
  assert.throws(() => w.configure({ speed: 100 }));
  assert.throws(() => w.configure({ surprise: 1 } as never));
});
test('population stays bounded and organisms remain on traversable land', () => {
  const w = new World(40, 30, 21, 100);
  for (let i = 0; i < 6000; i++) w.step();
  assert.ok(w.animals.length <= 100);
  assert.ok(w.tick > 0);
  for (const a of w.animals) {
    assert.ok(a.energy > 0 && Number.isFinite(a.energy));
    assert.notEqual(w.terrain[Math.floor(a.y) * w.width + Math.floor(a.x)], 0);
  }
});
test('starvation kills and plants regrow', () => {
  const w = new World(40, 30, 72, 100);
  w.animals = w.animals.slice(0, 1);
  w.animals[0].energy = -10; w.step(); assert.equal(w.animals.length, 0);
  const p = w.plants.findIndex((_, i) => w.terrain[i] === 1);
  w.plants.fill(0); w.configure({ rain: 2, fertility: 2 });
  for (let i = 0; i < 20; i++) w.step();
  assert.ok(w.plants[p] > 0);
});
test('old age creates detritus that later decomposes instead of instantly creating plants', () => {
  const w = new World(40, 30, 72, 100);
  const a = w.animals.find(a => a.species === 'grazer')!;
  w.animals = [a]; a.age = 801;
  const i = Math.floor(a.y) * w.width + Math.floor(a.x);
  w.plants[i] = 0; const soil = w.habitat.soilAt(a.x, a.y); w.step();
  assert.equal(w.animals.length, 0);
  assert.equal(w.plants[i], 0); assert.ok(w.habitat.soilAt(a.x, a.y).detritus > soil.detritus);
});
test('grazing removes plants and hunting removes prey and increases energy', () => {
  const w = new World(40, 30, 72, 100);
  const grazer = w.animals.find(a => a.species === 'grazer')!;
  w.animals = [grazer]; grazer.energy = 50;
  const i = Math.floor(grazer.y) * w.width + Math.floor(grazer.x);
  w.plants[i] = 60; w.step(); assert.ok(grazer.energy > 50); assert.ok(w.plants[i] < 60);
  const hunter = { ...grazer, id: 999, species: 'hunter' as const, energy: 40 };
  w.animals = [hunter, grazer]; w.step();
  assert.equal(w.animals.length, 1); assert.ok(hunter.energy > 40);
});
test('reproduction spends energy and offspring inherits bounded genes', () => {
  const w = new World(40, 30, 42, 100);
  const a = w.animals.find(a => a.species === 'grazer')!;
  a.age = 100; a.sex = 'female'; a.energy = 106; a.cooldown = 0; a.gestation = .1; a.mateGenes = a.genes; w.plants.fill(0);
  w.animals = [a]; w.step();
  assert.equal(w.animals.length, 2);
  assert.ok(w.animals.reduce((sum, a) => sum + a.energy, 0) < 130);
  assert.ok(Math.abs(w.animals[1].genes - a.genes) <= .05);
});
test('corrupt saves are rejected rather than silently restarting or propagating NaN', () => {
  const w = new World(40, 30, 42, 100);
  const save = w.export(); save.animals[0].x = Number.NaN;
  assert.throws(() => World.restore(save), /无效/);
  const invalid = w.export(); invalid.params.rain = -5;
  assert.throws(() => World.restore(invalid));
  assert.throws(() => World.restore({ version: 2 } as never), /无效/);
});
