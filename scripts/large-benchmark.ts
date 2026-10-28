import { World } from '../server/world.js';
import { buildView, initialView, overview } from '../server/viewport.js';
import { Store } from '../server/store.js';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const width = Number(process.argv[2] ?? 1024), height = Number(process.argv[3] ?? 768);
const start = performance.now(), world = new World(width, height, 42, 1200), initializationMs = performance.now() - start;
const memory = () => Object.fromEntries(Object.entries(process.memoryUsage()).map(([k, v]) => [k, Math.round(v / 1048576)]));
const initializedMemoryMB = memory();
const samples: number[] = []; let maxRegions = 0;
for (let i = 0; i < 3000; i++) { const t = performance.now(); world.step(); samples.push(performance.now() - t); maxRegions = Math.max(maxRegions, world.habitat.updatedRegions); }
samples.sort((a, b) => a - b);
const view = initialView(world), seen = new Map<number, number>(), frame = buildView(world, view, seen);
const coldBytes = JSON.stringify({ ...frame, overview: overview(world) }).length;
const unchangedBytes = JSON.stringify(buildView(world, view, seen)).length;
const dir = mkdtempSync(join(tmpdir(), 'wildhaven-large-')); let store: Store | undefined;
try {
  store = new Store(join(dir, 'world.sqlite')); const saving = performance.now(); store.save(world); const saveMs = performance.now() - saving;
  const savedMemoryMB = memory();
  const restored = store.load()!;
  console.log(JSON.stringify({ dimensions: [width, height], cells: width * height, initializationMs: Math.round(initializationMs), steps: samples.length,
    p95StepMs: +samples[Math.floor(samples.length * .95)].toFixed(3), maxUpdatedRegions: maxRegions, snapshotKB: +(coldBytes / 1024).toFixed(1), unchangedFrameKB: +(unchangedBytes / 1024).toFixed(1),
    saveMs: Math.round(saveMs), sqliteKB: Math.round(statSync(join(dir, 'world.sqlite-wal')).size / 1024), rssMB: Math.round(process.memoryUsage().rss / 1048576),
    initializedMemoryMB, savedMemoryMB, restoredMemoryMB: memory(), restoredTick: restored.tick, stats: world.stats(), ecology: world.ecology() }, null, 2));
} finally { store?.close(); rmSync(dir, { recursive: true }); }
