import { World } from '../server/world.js';
import { packAnimal } from '../shared/protocol.js';
const world = new World(96, 64, 42, 1200);
const samples: number[] = [];
const start = performance.now();
for (let i = 0; i < 18000; i++) {
  const t = performance.now(); world.step(); samples.push(performance.now() - t);
}
samples.sort((a, b) => a - b);
console.log(JSON.stringify({ steps: samples.length, simulatedSeconds: world.tick / 5,
  elapsedMs: Math.round(performance.now() - start), p95StepMs: +samples[Math.floor(samples.length * .95)].toFixed(3),
  rssMB: Math.round(process.memoryUsage().rss / 1048576), saveKB: Math.round(JSON.stringify(world.export()).length / 1024), animalFrameKB: Math.round(JSON.stringify(world.animals.map(packAnimal)).length / 1024), stats: world.stats() }, null, 2));
