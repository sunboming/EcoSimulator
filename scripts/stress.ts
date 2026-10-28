import assert from 'node:assert/strict';
import { World } from '../server/world.js';
import { packAnimal } from '../shared/protocol.js';

// Keep the population at capacity: extinction must not make a load test look fast.
for (const population of [1200, 5000]) for (const layout of ['distributed', 'crowded', 'foraging']) {
  const world = new World(96, 64, 42, population);
  world.configure({ vision: 1.5 });
  const land = Array.from(world.terrain).flatMap((t, i) => t === 1 ? [i] : []);
  const base = world.animals[0];
  world.animals = Array.from({ length: population }, (_, i) => {
    const cell = land[layout === 'crowded' ? 0 : (i * 37) % land.length];
    return { ...base, id: i + 1, species: layout !== 'foraging' && i % 2 ? 'hunter' as const : 'grazer' as const,
      x: cell % world.width + .5, y: Math.floor(cell / world.width) + .5 };
  });
  world.nextId = population + 1;
  const samples: number[] = [];
  for (let step = 0; step < 140; step++) {
    // No deaths/births during timing; include expensive grazing and maximum vision.
    for (const a of world.animals) { a.energy = a.species === 'hunter' ? 130 : 70; a.age = 0; a.cooldown = 80; }
    const start = performance.now(); world.step(); const elapsed = performance.now() - start;
    if (step >= 20) samples.push(elapsed);
    assert.equal(world.animals.length, population);
  }
  samples.sort((a, b) => a - b);
  assert.doesNotThrow(() => World.restore(world.export()));
  console.log(JSON.stringify({ population, layout, steps: samples.length,
    p95StepMs: +samples[Math.floor(samples.length * .95)].toFixed(2),
    maxStepMs: +samples.at(-1)!.toFixed(2), rssMB: Math.round(process.memoryUsage().rss / 1048576),
    frameKB: Math.round(Buffer.byteLength(JSON.stringify(world.animals.map(packAnimal))) / 1024) }));
}
