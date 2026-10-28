import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../server/world.js';
import { populationRates, historyCSV } from '../shared/analysis.js';
import { allParameterSpecs } from '../shared/environment.js';

test('professional growth and water parameters change actual habitat dynamics', () => {
  const dry = new World(40, 32, 42, 100), wet = new World(40, 32, 42, 100);
  for (const w of [dry, wet]) { w.animals = []; w.plants.fill(0); }
  dry.configure({ growthRate: 0, rainInfiltration: 0 });
  wet.configure({ growthRate: 1.5, rainInfiltration: .5 });
  for (let i = 0; i < 100; i++) { dry.step(); wet.step(); }
  assert.equal(dry.stats().plants, 0); assert.ok(wet.stats().plants > 0);
  assert.ok(wet.ecology().moisture > dry.ecology().moisture);
});

test('life-history parameters affect adulthood, pregnancy and mortality and survive saves', () => {
  const w = new World(40, 32, 42, 100); w.animals = [w.animals.find(a => a.species === 'grazer')!];
  w.configure({ grazerMaturity: 300, grazerLifespan: 100 });
  assert.equal(w.stats().juveniles, 1);
  w.animals[0].age = 101; w.step(); assert.equal(w.animals.length, 0);
  const restored = World.restore(w.export()); assert.equal(restored.params.grazerLifespan, 100);
});

test('all process parameters validate atomically and complete batches fit command limits', () => {
  const w = new World(40, 32, 42, 100), before = w.export();
  for (const [key, spec] of Object.entries(allParameterSpecs)) assert.throws(() => w.configure({ [key]: spec.max + 1 }));
  assert.throws(() => w.configure({ growthRate: 1, decayRate: -1 })); assert.deepEqual(w.export(), before);
  const patch = { ...w.params }; delete (patch as Partial<typeof patch>).paused; delete (patch as Partial<typeof patch>).speed;
  assert.ok(Buffer.byteLength(JSON.stringify({ type: 'configure', token: 'a'.repeat(256), requestId: 'command-1000', params: patch, expected: patch })) < 4096);
});

test('decomposer temperature response is independent of the plant optimum', () => {
  const a = new World(40, 32, 42, 100), b = new World(40, 32, 42, 100);
  for (const w of [a, b]) { w.animals = []; w.plants.fill(100); w.habitat.addDetritus(5, 5, 20); }
  b.configure({ growthOptimum: 0 });
  for (let i = 0; i < 50; i++) { a.step(); b.step(); }
  assert.equal(a.habitat.soilAt(5, 5).detritus, b.habitat.soilAt(5, 5).detritus);
  const initial = a.export(); a.configure({ decayRate: .04 }); b.configure({ decayRate: 0 });
  for (let i = 0; i < 50; i++) { a.step(); b.step(); }
  assert.ok(a.habitat.soilAt(5, 5).detritus < b.habitat.soilAt(5, 5).detritus);
  assert.doesNotThrow(() => World.restore(initial));
});

test('demographic flux uses simulated time and CSV leaves unrecorded measurements empty', () => {
  const w = new World(40, 32, 42, 100), before = w.stats(), after = { ...before, tick: before.tick + 25, births: before.births + 2, deaths: before.deaths + 1 };
  assert.deepEqual(populationRates(before, after), { births: 24, deaths: 12, growth: 0 });
  assert.equal(populationRates(before, before).births, null);
  const old = { tick: 0, grazers: 0, hunters: 0, plants: 0, births: 0, deaths: 0, diversity: 0 };
  const lines = historyCSV([old, after]).split('\n'), moisture = lines[0].split(',').indexOf('moisture');
  assert.equal(lines[1].split(',')[moisture], ''); assert.equal(Number(lines[2].split(',')[moisture]), after.moisture);
  assert.equal(populationRates(old, { ...old, tick: 25 }).growth, null);
});

test('analytical samples are global, bounded and old histories retain missing measurements', () => {
  const w = new World(40, 32, 42, 100);
  for (let i = 0; i < 25; i++) w.step();
  const s = w.history.at(-1)! as any;
  for (const key of ['moisture', 'nutrients', 'meanHydration', 'meanEnergy', 'juveniles', 'pregnancies', 'geneSD']) assert.ok(Number.isFinite(s[key]), key);
  assert.ok(s.meanHydration >= 0 && s.meanHydration <= 100);
  assert.doesNotThrow(() => World.restore(w.export()));
});
