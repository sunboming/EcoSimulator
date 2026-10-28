import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:net';
import WebSocket from 'ws';

test('private server requires login, a single connection and idle expiry despite watch traffic', { timeout: 20000 }, async () => {
  const probe = createServer();
  await new Promise<void>(r => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>(r => probe.close(() => r()));
  const dir = mkdtempSync(join(tmpdir(), 'wildhaven-private-'));
  const origin = `http://127.0.0.1:${port}`;
  const secret = 'b'.repeat(64), authorization = `Basic ${Buffer.from(`admin:${secret}`).toString('base64')}`;
  const sockets: WebSocket[] = [];
  let child: ChildProcess | undefined;
  const rejected = (credentials: string | undefined, status: number) => new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`${origin.replace('http:', 'ws:')}/ws`, { origin, headers: credentials ? { Authorization: credentials } : {} });
    sockets.push(ws);
    ws.on('error', () => {});
    ws.once('open', () => reject(new Error('unexpected successful connection')));
    ws.once('unexpected-response', (_, res) => {
      try { assert.equal(res.statusCode, status); resolve(); } catch (error) { reject(error); }
      finally { res.resume(); ws.terminate(); }
    });
  });
  try {
    child = spawn(process.execPath, ['dist/server/index.js'], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_PATH: join(dir, 'world.sqlite'), ADMIN_TOKEN: secret, PRIVATE_MODE: 'true', MAX_CLIENTS: '30', IDLE_TIMEOUT_SECONDS: '2', PUBLIC_ORIGIN: origin, WORLD_WIDTH: '32', WORLD_HEIGHT: '24' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout!.on('data', b => output += b); child.stderr!.on('data', b => output += b);
    for (let i = 0; !output.includes('"started"'); i++) {
      if (child.exitCode !== null || i > 100) throw new Error(`startup failed: ${output}`);
      await delay(30);
    }
    const denied = await fetch(origin);
    assert.equal(denied.status, 401);
    assert.match(denied.headers.get('www-authenticate')!, /^Basic /);
    assert.equal((await fetch(origin, { headers: { Authorization: authorization } })).status, 200);
    for (const path of ['/settings.html', '/appearance-init.js']) {
      assert.equal((await fetch(origin + path)).status, 401);
      assert.equal((await fetch(origin + path, { headers: { Authorization: authorization } })).status, 200);
    }
    assert.equal((await fetch(origin, { headers: { Authorization: `Basic ${Buffer.from('admin:wrong').toString('base64')}` } })).status, 401);
    assert.deepEqual(await (await fetch(origin + '/health')).json(), { ok: true });
    assert.equal((await fetch(origin + '/health/details')).status, 401);
    const health = await (await fetch(origin + '/health/details', { headers: { Authorization: authorization } })).json() as any;
    assert.equal(health.maxAnimals, 1200);
    assert.equal(health.clients, 0);
    await rejected(undefined, 401);
    const first = new WebSocket(`${origin.replace('http:', 'ws:')}/ws`, { origin, headers: { Authorization: authorization } });
    sockets.push(first);
    const snapshot = await new Promise<any>((resolve, reject) => { first.once('message', b => resolve(JSON.parse(b.toString()))); first.once('error', reject); });
    assert.equal(snapshot.type, 'snapshot');
    assert.equal(snapshot.idleTimeoutMs, 2000);
    assert.equal(snapshot.protected, true);
    await rejected(authorization, 403);
    const closed = new Promise<void>(r => first.once('close', () => r())); first.close(); await closed;
    await delay(100);
    const replacement = new WebSocket(`${origin.replace('http:', 'ws:')}/ws?mode=lab`, { origin, headers: { Authorization: authorization } });
    sockets.push(replacement);
    await new Promise<void>((resolve, reject) => { replacement.once('message', () => resolve()); replacement.once('error', reject); });
    let closedCode = 0;
    const expired = new Promise<void>(resolve => replacement.once('close', code => { closedCode = code; resolve(); }));
    const active = setInterval(() => replacement.send(JSON.stringify({ type: 'activity' })), 300);
    try { await delay(2500); assert.equal(replacement.readyState, WebSocket.OPEN); }
    finally { clearInterval(active); }
    const watching = setInterval(() => { if (replacement.readyState === WebSocket.OPEN) replacement.send(JSON.stringify({ type: 'watch', view: { x: 0, y: 0, width: 24, height: 24 } })); }, 500);
    try { await expired; assert.equal(closedCode, 4001); }
    finally { clearInterval(watching); }
    const afterIdle = await (await fetch(origin + '/health/details', { headers: { Authorization: authorization } })).json() as any;
    assert.equal(afterIdle.clients, 0);
    assert.ok(afterIdle.tick > health.tick, 'world continues evolving after viewer expiry');
  } finally {
    for (const ws of sockets) ws.terminate();
    if (child && child.exitCode === null) { const stopped = new Promise<void>(r => child!.once('exit', () => r())); child.kill(); await stopped; }
    rmSync(dir, { recursive: true });
  }
});
