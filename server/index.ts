import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from './config.js';
import { Store } from './store.js';
import { World } from './world.js';
import { FixedClock } from './clock.js';
import type { Intervention, ViewRect } from '../shared/types.js';
import { buildView, initialView, normalizeView, overview } from './viewport.js';

const store = new Store(config.dbPath);
let world = store.load() ?? new World(config.width, config.height, config.seed, config.maxAnimals);
// Limits are operational settings and apply to restored worlds too.
world.maxAnimals = config.maxAnimals;
if (world.animals.length > world.maxAnimals) world.animals = world.animals.slice(0, world.maxAnimals);
let epoch = randomUUID(), lastStepMs = 0, saveError = false;
const viewers = new Map<WebSocket, { view: ViewRect; seen: Map<number, number>; analysis: boolean }>();
let overviewCache = overview(world), overviewTime = performance.now();
let lastSampleTick = world.history.at(-1)?.tick ?? -1;
const root = fileURLToPath(new URL('../public/', import.meta.url));
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf' };
const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'");
  if (req.url === '/health') { res.writeHead(saveError ? 503 : 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: !saveError, tick: world.tick, world: [world.width, world.height], regions: world.habitat.updated.length, activeRegions: world.habitat.activeRegions, updatedRegions: world.habitat.updatedRegions, animals: world.animals.length, maxAnimals: world.maxAnimals, clients: wss.clients.size, stepMs: +lastStepMs.toFixed(2), droppedSteps: clock.droppedSteps, memoryMB: Math.round(process.memoryUsage().rss / 1048576) })); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  try {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://local').pathname);
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    const rel = relative(root, file);
    if (rel.startsWith('..') || isAbsolute(rel)) { res.writeHead(403); res.end(); return; }
    const info = await stat(file); if (!info.isFile()) throw new Error('not file');
    res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : await readFile(file));
  } catch { res.writeHead(404); res.end('Not found'); }
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin;
  const validOrigin = origin && (config.publicOrigin ? origin === config.publicOrigin : (() => { try { return new URL(origin).host === req.headers.host; } catch { return false; } })());
  const path = new URL(req.url ?? '/', 'http://local');
  if (path.pathname !== '/ws' || (path.search && path.search !== '?mode=lab') || !validOrigin || wss.clients.size >= config.maxClients) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
function send(ws: WebSocket, message: string) {
  if (ws.readyState !== WebSocket.OPEN) return;
  if (ws.bufferedAmount > 256 * 1024) ws.terminate(); else ws.send(message);
}
function snapshotMessage(ws: WebSocket) {
  const viewer = viewers.get(ws)!; viewer.seen.clear();
  return JSON.stringify({ type: 'snapshot', epoch, width: world.width, height: world.height, terrain: [], plants: [], ...(viewer.analysis ? {} : buildView(world, viewer.view, viewer.seen)),
    ...(!viewer.analysis ? { overview: overviewCache } : {}), ecology: world.ecology(), focus: world.focus, params: world.params, stats: world.stats(), history: world.history, protected: !!config.adminToken, events: world.events });
}
function authorized(token: unknown) {
  if (!config.adminToken) return true;
  if (typeof token !== 'string') return false;
  const a = Buffer.from(token), b = Buffer.from(config.adminToken);
  return a.length === b.length && timingSafeEqual(a, b);
}
const alive = new WeakSet<WebSocket>();
let lastIntervention = 0;
let lastReset = -Infinity;
wss.on('connection', (ws, req) => {
  ws.on('error', error => console.warn('websocket:', error.message));
  viewers.set(ws, { view: initialView(world), seen: new Map(), analysis: req.url === '/ws?mode=lab' });
  alive.add(ws); send(ws, snapshotMessage(ws));
  ws.on('close', () => viewers.delete(ws));
  let windowStart = Date.now(), count = 0, viewCount = 0, totalCount = 0;
  ws.on('pong', () => alive.add(ws));
  ws.on('message', raw => {
    if (Date.now() - windowStart > 10000) { windowStart = Date.now(); count = 0; viewCount = 0; totalCount = 0; }
    if (++totalCount > 60) { ws.close(1008, 'Too many messages'); return; }
    let requestId: string | undefined;
    try {
      const msg = JSON.parse(raw.toString());
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) throw new Error('命令必须是对象');
      if (msg.type === 'watch') {
        if (++viewCount > 40) { ws.close(1008, 'Too many viewport changes'); return; }
        const viewer = viewers.get(ws)!; viewer.view = normalizeView(msg.view, world); viewer.seen.clear();
        return;
      }
      if (++count > 20) { ws.close(1008, 'Too many commands'); return; }
      if (typeof msg.requestId === 'string' && msg.requestId.length <= 80) requestId = msg.requestId;
      if (!authorized(msg.token)) throw new Error('管理口令不正确');
      let message = '设置已应用';
      if (msg.type === 'configure') {
        if (msg.expected !== undefined) {
          if (!msg.expected || typeof msg.expected !== 'object' || Array.isArray(msg.expected) || !msg.params || typeof msg.params !== 'object' || Array.isArray(msg.params) || Object.keys(msg.params).length !== Object.keys(msg.expected).length || Object.keys(msg.params).some(key => !Object.hasOwn(msg.expected, key))) throw new Error('参数基线格式无效');
          if (Object.entries(msg.expected).some(([key, value]) => !Object.hasOwn(world.params, key) || world.params[key as keyof typeof world.params] !== value)) throw new Error('参数已被其他访客修改，请核对当前值后重新应用');
        }
        world.configure(msg.params);
      }
      else if (msg.type === 'nature') {
        world.configureNature(msg.nature); message = '自然演变设置已应用';
      }
      else if (msg.type === 'intervene') {
        if (Date.now() - lastIntervention < 1500) throw new Error('请稍候，生态干预间隔至少 1.5 秒');
        const view = viewers.get(ws)!.view;
        const event = world.intervene(msg.intervention as Intervention, { x: Math.min(world.width - .01, view.x + view.width / 2), y: Math.min(world.height - .01, view.y + view.height / 2) }); message = event.message; lastIntervention = Date.now();
      }
      else if (msg.type === 'reset' || msg.type === 'expand') {
        // Shared cooldown prevents reconnects/multiple clients from flooding synchronous saves.
        if (performance.now() - lastReset < 10000) throw new Error('请稍候，重置或扩图间隔至少 10 秒');
        lastReset = performance.now();
        const replacement = msg.type === 'expand' ? World.restore(world.export()) : new World(config.width, config.height, config.seed, config.maxAnimals);
        if (msg.type === 'expand') replacement.expand();
        store.save(replacement); world = replacement; epoch = randomUUID(); overviewCache = overview(world); overviewTime = performance.now();
        lastSampleTick = -1;
        message = msg.type === 'expand' ? `疆域已扩展至 ${world.width} × ${world.height}，原有进度已保留` : '世界已重置';
        for (const client of wss.clients) { const viewer = viewers.get(client); if (!viewer) continue; viewer.view = initialView(world); send(client, snapshotMessage(client)); }
      } else throw new Error('未知操作');
      send(ws, JSON.stringify({ type: 'ack', requestId, params: world.params, message }));
    } catch (e) { send(ws, JSON.stringify({ type: 'error', requestId, message: e instanceof Error ? e.message : '操作失败' })); }
  });
});
let last = performance.now(); const clock = new FixedClock();
const simulation = setInterval(() => {
  const now = performance.now();
  const elapsed = now - last; last = now;
  const start = performance.now();
  // Biological steps are always 0.2 seconds; TICK_HZ only controls scheduler wakeups.
  clock.advance(elapsed, world.params.speed, world.params.paused, () => world.step());
  lastStepMs = performance.now() - start;
}, 1000 / config.tickHz);
const push = setInterval(() => {
  if (!wss.clients.size) return;
  const samples = world.history.filter(s => s.tick > lastSampleTick);
  if (samples.length) lastSampleTick = samples.at(-1)!.tick;
  const refreshOverview = performance.now() - overviewTime >= 2000;
  if (refreshOverview) { overviewCache = overview(world); overviewTime = performance.now(); }
  const common = { type: 'delta', epoch, plants: [], params: world.params, stats: world.stats(), samples, events: world.events, ecology: world.ecology(), ...(refreshOverview ? { overview: overviewCache } : {}) };
  for (const [ws, viewer] of viewers) if (ws.readyState === WebSocket.OPEN) {
    // A slow viewer reconnects to a full snapshot, so no skipped delta can corrupt its view.
    if (ws.bufferedAmount > 256 * 1024) ws.terminate();
    else if (viewer.analysis) { const { overview: _overview, ...analysis } = common; ws.send(JSON.stringify(analysis)); }
    else ws.send(JSON.stringify({ ...common, ...buildView(world, viewer.view, viewer.seen) }));
  }
}, 1000 / config.pushHz);
function save() { try { store.save(world); saveError = false; } catch (e) { saveError = true; console.error('save failed', e); } }
const saving = setInterval(save, config.saveSeconds * 1000);
const heartbeat = setInterval(() => { for (const ws of wss.clients) { if (!alive.has(ws)) ws.terminate(); else { alive.delete(ws); ws.ping(); } } }, 30000);
let closing = false;
function shutdown() { if (closing) return; closing = true; for (const timer of [simulation, push, saving, heartbeat]) clearInterval(timer); save(); for (const ws of wss.clients) ws.terminate(); wss.close(); server.close(() => { store.close(); process.exit(saveError ? 1 : 0); }); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
server.listen(config.port, config.host, () => console.log(JSON.stringify({ event: 'started', port: config.port, tick: world.tick, protected: !!config.adminToken })));
