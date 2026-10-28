import test from 'node:test';
import assert from 'node:assert/strict';
import { Camera, EnvironmentDraft, PendingCommand } from '../client/interactions.js';

test('camera zoom keeps the point under the cursor and constrains dragging', () => {
  const c = new Camera();
  c.resize(900, 600, 96, 64);
  const point = c.toWorld(300, 200);
  c.zoomAt(2, 300, 200);
  assert.deepEqual(c.toWorld(300, 200), point);
  c.pan(99999, -99999);
  const t = c.transform();
  assert.ok(t.ox <= 0 && t.ox + 96 * t.scale >= 900);
  assert.ok(t.oy <= 0 && t.oy + 64 * t.scale >= 600);
  c.fit(); assert.equal(c.zoom, 1);
});
test('environment edits survive incoming updates, cancel and remove only confirmed changes', () => {
  const d = new EnvironmentDraft();
  const params = { rain: 1, fertility: 1, metabolism: 1 };
  d.edit('rain', .4, params);
  assert.equal(d.value('rain', { ...params, rain: .8 }), .4);
  assert.equal(d.value('fertility', { ...params, fertility: 1.5 }), 1.5);
  d.reconcile({ ...params, rain: .8 }); assert.equal(d.dirty, true);
  d.reconcile({ ...params, rain: .4 }); assert.equal(d.dirty, false);
  d.edit('rain', 0, params); d.clear(); assert.equal(d.value('rain', params), 1);
});
test('command gate rejects double submission and stale replies, releases on disconnect', () => {
  const gate = new PendingCommand();
  const id = gate.begin('pause')!; assert.ok(id);
  assert.equal(gate.begin('pause'), null);
  assert.equal(gate.finish('other'), null); assert.equal(gate.busy, true);
  assert.equal(gate.finish(id), 'pause'); assert.equal(gate.busy, false);
  gate.begin('reset'); gate.cancel(); assert.equal(gate.busy, false);
});
