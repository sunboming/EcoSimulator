import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { World } from '../server/world.js';
import { spawnSync } from 'node:child_process';
test('SQLite atomically replaces and restores the complete world', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wildhaven-')), path = join(dir, 'world.sqlite');
  try {
    let store = new Store(path); assert.equal(store.load(), null);
    const world = new World(32, 24, 7, 100); for (let i = 0; i < 100; i++) world.step();
    world.configure({ rain: .4, paused: true }); store.save(world); store.close();
    store = new Store(path); assert.deepEqual(store.load()!.export(), world.export());
    world.configure({ paused: false }); world.step(); store.save(world);
    assert.equal(store.load()!.tick, 101);
    const backupPath = join(dir, 'backup.sqlite');
    const result = spawnSync(process.execPath, ['dist/server/backup.js', path, backupPath], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const restored = new Store(backupPath); assert.deepEqual(restored.load()!.export(), world.export()); restored.close();
    store.close();
  } finally { rmSync(dir, { recursive: true }); }
});
