import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../server/world.js';
import { buildView, normalizeView, overview } from '../server/viewport.js';
test('large-world view data is bounded and does not advance the simulation', () => {
  const w = new World(2048, 1536, 42, 100), before = w.tick;
  const view = normalizeView({ x: 900, y: 700, width: 128, height: 96 }, w);
  const packet = buildView(w, view);
  assert.ok(packet.tiles.length <= 25);
  assert.ok(JSON.stringify({ ...packet, overview: overview(w) }).length < 200000);
  assert.equal(w.tick, before);
  const tile = packet.tiles[0], terrain = Buffer.from(tile.terrain, 'base64');
  assert.equal(terrain[0], w.terrain[tile.y * w.width + tile.x]);
});
test('overview mode aggregates animals and malformed viewports are rejected', () => {
  const w = new World(512, 384, 42, 100);
  const packet = buildView(w, normalizeView({ x: 0, y: 0, width: 512, height: 384 }, w));
  assert.equal(packet.tiles.length, 0); assert.ok(packet.density.length <= 2048);
  assert.throws(() => normalizeView({ x: NaN, y: 0, width: 100, height: 100 }, w));
  const clipped = normalizeView({ x: -50, y: -50, width: 128, height: 96 }, w); assert.equal(clipped.x, 0);
});
