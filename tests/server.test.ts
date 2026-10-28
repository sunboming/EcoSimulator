import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:net';
import WebSocket from 'ws';

test('server runs without viewers, shares controls, enforces auth and restores SQLite', { timeout: 30000 }, async () => {
  const probe = createServer(); await new Promise<void>(r => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as { port: number }).port; await new Promise<void>(r => probe.close(() => r()));
  const dir = mkdtempSync(join(tmpdir(), 'wildhaven-server-')); let child: ChildProcess | undefined;
  const sockets: WebSocket[] = [];
  const origin = `http://127.0.0.1:${port}`;
  const start = async () => {
    child = spawn(process.execPath, ['dist/server/index.js'], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_PATH: join(dir, 'world.sqlite'), ADMIN_TOKEN: 'test-secret', WORLD_WIDTH: '32', WORLD_HEIGHT: '24', MAX_ANIMALS: '100', SAVE_SECONDS: '5' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout!.on('data', b => { output += b; }); child.stderr!.on('data', b => { output += b; });
    for (let i = 0; i < 100; i++) { if (output.includes('"started"')) return; if (child.exitCode !== null) throw new Error(output); await delay(50); }
    throw new Error(`startup timeout: ${output}`);
  };
  const stop = async () => {
    if (!child || child.exitCode !== null) return;
    const stopped = new Promise<void>(r => child!.once('exit', () => r()));
    // Windows does not deliver POSIX SIGTERM; periodic save is tested before restart.
    child.kill(); await stopped;
  };
  const open = async (mode = '') => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${mode}`, { origin }); sockets.push(ws);
    const inbox: any[] = []; ws.on('message', b => inbox.push(JSON.parse(b.toString())));
    await new Promise<void>((r, reject) => { ws.once('open', r); ws.once('error', reject); });
    const next = async (type: string) => {
      for (let i = 0; i < 100; i++) { const n = inbox.findIndex(m => m.type === type); if (n >= 0) return inbox.splice(n, 1)[0]; await delay(30); }
      throw new Error(`no message: ${type}`);
    };
    return { ws, next, inbox };
  };
  try {
    await start();
    const before = await (await fetch(`${origin}/health`)).json() as any;
    await delay(500);
    const after = await (await fetch(`${origin}/health`)).json() as any;
    assert.ok(after.tick > before.tick, 'world advances without viewers');
    const a = await open(), b = await open();
    const sa = await a.next('snapshot'), sb = await b.next('snapshot'); assert.equal(sa.epoch, sb.epoch);
    const lab = await open('?mode=lab'), laboratory = await lab.next('snapshot');
    assert.equal(laboratory.epoch, sa.epoch); assert.equal(laboratory.animals, undefined); assert.equal(laboratory.tiles, undefined); assert.equal(laboratory.overview, undefined);
    lab.ws.send(JSON.stringify({ type: 'configure', requestId: 'advanced-test', token: 'test-secret', params: { growthRate: 1.2 }, expected: { growthRate: laboratory.params.growthRate } }));
    assert.equal((await lab.next('ack')).params.growthRate, 1.2);
    lab.ws.send(JSON.stringify({ type: 'configure', token: 'test-secret', params: { growthRate: 1.4 }, expected: { growthRate: laboratory.params.growthRate } }));
    assert.match((await lab.next('error')).message, /其他访客/);
    lab.inbox.length = 0; const analytical = await lab.next('delta'); assert.equal(analytical.stats.moisture >= 0, true); assert.equal(analytical.animals, undefined);
    b.inbox.length = 0;
    b.ws.send(JSON.stringify({ type: 'watch', view: { x: 0, y: 0, width: 24, height: 24 } }));
    const watched = await b.next('delta'); assert.equal(watched.view.width, 24); assert.equal(watched.view.x, 0);
    assert.ok(watched.tiles.length > 0, 'viewing tiles does not require an admin token');
    a.ws.send(JSON.stringify({ type: 'configure', params: { paused: true } })); assert.match((await a.next('error')).message, /口令/);
    a.ws.send(JSON.stringify({ type: 'nature', nature: { weather: false } })); assert.match((await a.next('error')).message, /口令/);
    a.ws.send(JSON.stringify({ type: 'nature', token: 'test-secret', nature: { weather: false } }));
    assert.equal((await a.next('ack')).message, '自然演变设置已应用');
    b.inbox.length = 0; assert.equal((await b.next('delta')).ecology.nature.weather, false);
    a.ws.send(JSON.stringify({ type: 'nature', token: 'test-secret', nature: { weather: 'bad' } })); assert.match((await a.next('error')).message, /无效/);
    a.ws.send(JSON.stringify({ type: 'configure', requestId: 'pause-test', token: 'test-secret', params: { paused: true } }));
    const ack = await a.next('ack'); assert.equal(ack.requestId, 'pause-test'); assert.equal(ack.params.paused, true);
    b.inbox.length = 0; const paused = await b.next('delta'); assert.equal(paused.params.paused, true);
    await delay(600); const health = await (await fetch(`${origin}/health`)).json() as any; assert.equal(health.tick, paused.stats.tick);
    a.ws.send(JSON.stringify({ type: 'configure', token: 'test-secret', params: { speed: 999 } })); assert.match((await a.next('error')).message, /无效/);
    a.ws.send(JSON.stringify({ type: 'intervene', intervention: 'seed' })); assert.match((await a.next('error')).message, /口令/);
    a.ws.send(JSON.stringify({ type: 'intervene', requestId: 'seed-test', token: 'test-secret', intervention: 'seed' }));
    const intervention = await a.next('ack'); assert.equal(intervention.requestId, 'seed-test'); assert.match(intervention.message, /补种/);
    b.inbox.length = 0; assert.equal((await b.next('delta')).events.at(-1).kind, 'seed');
    a.ws.send(JSON.stringify({ type: 'intervene', token: 'test-secret', intervention: 'hunters' })); assert.match((await a.next('error')).message, /间隔/);
    b.ws.send(JSON.stringify({ type: 'intervene', token: 'test-secret', intervention: 'grazers' })); assert.match((await b.next('error')).message, /间隔/);
    a.ws.send(JSON.stringify({ type: 'reset', token: 'test-secret' }));
    const reset = await a.next('snapshot'); assert.equal(reset.stats.tick, 0); assert.notEqual(reset.epoch, sa.epoch);
    await a.next('ack');
    b.ws.send(JSON.stringify({ type: 'reset', token: 'test-secret' }));
    assert.match((await b.next('error')).message, /10 秒/);
    b.ws.send('null'); assert.match((await b.next('error')).message, /对象/);
    a.ws.send(JSON.stringify({ type: 'configure', token: 'test-secret', params: { paused: true, rain: .3 } })); await a.next('ack');
    a.ws.send(JSON.stringify({ type: 'nature', token: 'test-secret', nature: { migration: false } })); await a.next('ack');
    await delay(10100);
    const preservedTick = (await (await fetch(`${origin}/health`)).json() as any).tick;
    a.ws.send(JSON.stringify({ type: 'expand', requestId: 'expand-test', token: 'test-secret' }));
    const expanded = await a.next('snapshot'); assert.equal(expanded.width, 64); assert.equal(expanded.height, 48);
    assert.equal(expanded.stats.tick, preservedTick); assert.equal(expanded.params.paused, true);
    assert.equal((await a.next('ack')).requestId, 'expand-test');
    const persistedTick = preservedTick;
    for (const ws of sockets) ws.terminate(); await stop(); await start();
    const c = await open(), restored = await c.next('snapshot'); assert.equal(restored.stats.tick, persistedTick); assert.equal(restored.params.rain, .3); assert.equal(restored.params.paused, true);
    assert.equal(restored.width, 64); assert.equal(restored.height, 48);
    assert.equal(restored.ecology.nature.migration, false);
    const bad = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: 'https://evil.example' });
    await new Promise<void>(r => { bad.on('error', () => r()); bad.on('unexpected-response', (_, res) => { assert.equal(res.statusCode, 403); res.resume(); bad.terminate(); r(); }); });
    assert.equal((await fetch(`${origin}/`)).status, 200);
    assert.equal((await fetch(`${origin}/settings.html`)).status, 200);
  } finally { for (const ws of sockets) ws.terminate(); await stop(); rmSync(dir, { recursive: true }); }
});
