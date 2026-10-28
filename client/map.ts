import type { Animal, Snapshot, TerrainTile, ViewRect, Overview } from '../shared/types';
import { Camera } from './interactions';
import { $ } from './dom';
import { animalSprite, spritePose } from './sprites';
import { speciesTraits } from '../shared/species';
import { maturity } from '../shared/model';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const bytes = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
interface CachedTile { data: TerrainTile; terrain: Uint8Array; plants: Uint8Array; moisture: Uint8Array; nutrients: Uint8Array; water: Uint8Array; canvas: HTMLCanvasElement }

export class WorldView {
  readonly camera = new Camera(); selected = 0; following = false; grid = false;
  readonly layers = { vegetation: true, grazer: true, hunter: true };
  overlay: 'natural' | 'moisture' | 'nutrients' = 'natural';
  private state?: Snapshot; private animals: Animal[] = []; private previous = new Map<number, { x: number; y: number }>();
  private received = 0; private interval = 500;
  private overviewCanvas = document.createElement('canvas'); private overviewSource?: Overview;
  private tiles = new Map<string, CachedTile>(); private ctx: CanvasRenderingContext2D;
  private pointers = new Map<number, { x: number; y: number }>(); private start = { x: 0, y: 0 }; private dragged = false;
  constructor(private canvas: HTMLCanvasElement, private onSelect: (id: number) => void, private onFollow: () => void, private onView: () => void) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => { this.resize(); this.draw(); this.onView(); }).observe(canvas.parentElement!);
    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0 && e.pointerType !== 'touch') return;
      canvas.focus({ preventScroll: true }); canvas.setPointerCapture(e.pointerId); this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) { this.start = { x: e.clientX, y: e.clientY }; this.dragged = false; } else this.dragged = true;
    });
    canvas.addEventListener('pointermove', e => this.pointerMove(e));
    canvas.addEventListener('pointerup', e => { if (!this.pointers.has(e.pointerId)) return; this.pointers.delete(e.pointerId); if (!this.dragged && this.state && e.isPrimary) this.pick(e.clientX, e.clientY); if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); });
    canvas.addEventListener('pointercancel', e => { this.pointers.delete(e.pointerId); this.dragged = true; });
    canvas.addEventListener('lostpointercapture', e => this.pointers.delete(e.pointerId));
    canvas.addEventListener('pointerleave', () => { $('coordinate').textContent = 'WILDHAVEN RESERVE / LIVE'; });
    canvas.addEventListener('wheel', e => { e.preventDefault(); this.resize(); const r = canvas.getBoundingClientRect(); this.stopFollowing(); this.camera.zoomAt(Math.exp(-Math.max(-200, Math.min(200, e.deltaY)) * .002), e.clientX - r.left, e.clientY - r.top); this.changedView(); }, { passive: false });
    $<HTMLCanvasElement>('minimap').addEventListener('pointerdown', e => {
      e.preventDefault(); if (!this.state) return; const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      this.stopFollowing(); this.nearby((e.clientX - r.left) / r.width * this.state.width, (e.clientY - r.top) / r.height * this.state.height);
    });
    const render = () => { const start = performance.now(); this.draw(); setTimeout(render, Math.max(0, (performance.now() - start > 12 ? 1000 / 15 : 1000 / 30) - (performance.now() - start))); }; render();
  }
  viewport(): ViewRect {
    const t = this.camera.transform(), a = this.camera.toWorld(0, 0), b = this.camera.toWorld(t.w, t.h), world = this.state;
    const x = Math.max(0, Math.floor(a.x - 8)), y = Math.max(0, Math.floor(a.y - 8));
    return { x, y, width: Math.max(1, Math.min(world?.width ?? 1, Math.ceil(b.x + 8)) - x), height: Math.max(1, Math.min(world?.height ?? 1, Math.ceil(b.y + 8)) - y), selected: this.selected };
  }
  update(state: Snapshot, incremental = false) {
    const newWorld = this.state?.epoch !== state.epoch, now = performance.now();
    this.interval = this.received ? Math.max(50, Math.min(1500, now - this.received)) : 500; this.received = now;
    this.previous = new Map(this.animals.map(a => [a.id, { x: a.x, y: a.y }])); if (!incremental) this.previous.clear();
    this.animals = state.animals; this.state = state;
    if (newWorld) { this.selected = 0; this.following = false; this.previous.clear(); this.tiles.clear(); this.camera.fit(); }
    this.resize();
    if (newWorld) this.nearby(state.focus.x, state.focus.y);
    if (state.overview !== this.overviewSource) this.paintOverview(state.overview);
    for (const tile of state.tiles) this.cacheTile(tile);
    if (this.selected && !this.animals.some(a => a.id === this.selected) && this.following) this.stopFollowing();
    this.updateCount(); this.zoomLabel();
  }
  nearby(x: number, y: number) {
    if (!this.state) return;
    const t = this.camera.transform(), targetScale = Math.min(t.w / Math.min(128, this.state.width), t.h / Math.min(96, this.state.height));
    if (t.scale < targetScale) this.camera.zoomAt(targetScale / t.scale);
    this.camera.focus(x, y); this.changedView();
  }
  setOverlay(overlay: WorldView['overlay']) { this.overlay = overlay; for (const tile of this.tiles.values()) this.paintTile(tile); }
  setLayer(key: keyof WorldView['layers'], enabled: boolean) { this.layers[key] = enabled; if (key === 'vegetation') { for (const tile of this.tiles.values()) this.paintTile(tile); if (this.state) this.paintOverview(this.state.overview); } const a = this.animals.find(a => a.id === this.selected); if (a && !this.layers[a.species]) this.stopFollowing(); this.updateCount(); }
  select(id: number) { this.selected = id; this.following = false; this.onSelect(id); this.onView(); }
  follow() {
    const a = this.animals.find(a => a.id === this.selected); if (!a) return;
    this.layers[a.species] = true; document.querySelector(`[data-layer="${a.species}"]`)?.setAttribute('aria-pressed', 'true');
    this.following = !this.following; if (this.following) { this.resize(); this.nearby(a.x, a.y); const t = this.camera.transform(); if (t.scale < 14) this.camera.zoomAt(14 / t.scale); this.camera.focus(a.x, a.y); }
    this.updateCount(); this.onFollow(); this.changedView();
  }
  stopFollowing() { if (this.following) { this.following = false; this.onFollow(); } }
  fit() { this.stopFollowing(); this.camera.fit(); this.changedView(); }
  zoom(factor: number) { this.resize(); this.camera.zoomAt(factor); this.changedView(); }
  private changedView() { this.zoomLabel(); this.onView(); }
  private resize() { const r = this.canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1), width = Math.round(r.width * dpr), height = Math.round(r.height * dpr); if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; } if (this.state) this.camera.resize(r.width, r.height, this.state.width, this.state.height); }
  private zoomLabel() { $('zoom-level').textContent = `${this.camera.zoom.toFixed(1)}×`; $<HTMLButtonElement>('zoom-out').disabled = this.camera.zoom <= 1; $<HTMLButtonElement>('zoom-in').disabled = this.camera.zoom >= this.camera.maxZoom; }
  private updateCount() { const total = this.state ? this.state.stats.grazers + this.state.stats.hunters : 0, distant = this.state?.density.length; const visible = distant ? this.state!.density.reduce((n, d) => n + (this.layers.grazer ? d[2] : 0) + (this.layers.hunter ? d[3] : 0), 0) : this.animals.filter(a => this.layers[a.species]).length; $('visible-count').textContent = `${distant ? '远景' : '视野'} ${visible} · 世界 ${total} 个体`; }
  private position(a: Animal) { const p = this.previous.get(a.id), alpha = Math.min(1, (performance.now() - this.received) / this.interval); return p ? { x: p.x + (a.x - p.x) * alpha, y: p.y + (a.y - p.y) * alpha } : a; }
  private pointerMove(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect(), p = this.camera.toWorld(e.clientX - r.left, e.clientY - r.top);
    if (this.state && p.x >= 0 && p.y >= 0 && p.x < this.state.width && p.y < this.state.height) {
      const tile = this.tiles.get(`${Math.floor(p.x / 32) * 32},${Math.floor(p.y / 32) * 32}`), s = Math.floor(p.y % 32 / 8) * 4 + Math.floor(p.x % 32 / 8);
      $('coordinate').textContent = `X ${Math.floor(p.x)} / Y ${Math.floor(p.y)}${tile ? ` · 水分 ${tile.moisture[s]}% · 养分 ${tile.nutrients[s]}%` : ' · 远景概览'}`;
    }
    const old = this.pointers.get(e.pointerId); if (!old || (!this.dragged && Math.hypot(e.clientX - this.start.x, e.clientY - this.start.y) < 5)) return;
    this.dragged = true; this.stopFollowing(); const before = [...this.pointers.values()]; this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) this.camera.pan(e.clientX - old.x, e.clientY - old.y);
    else { const after = [...this.pointers.values()], distance = (p: { x: number; y: number }[]) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), previousDistance = distance(before); if (previousDistance > 1) { const cx = (before[0].x + before[1].x) / 2, cy = (before[0].y + before[1].y) / 2; this.camera.zoomAt(distance(after) / previousDistance, cx - r.left, cy - r.top); this.camera.pan((after[0].x + after[1].x) / 2 - cx, (after[0].y + after[1].y) / 2 - cy); } }
    this.changedView();
  }
  private pick(clientX: number, clientY: number) {
    const r = this.canvas.getBoundingClientRect(), t = this.camera.transform(), p = this.camera.toWorld(clientX - r.left, clientY - r.top);
    if (this.viewport().width > 192 || this.viewport().height > 192) { this.nearby(p.x, p.y); return; }
    let nearest = 0, distance = Math.max(.8, 14 / t.scale);
    for (const a of this.animals) if (this.layers[a.species]) { const q = this.position(a), d = Math.hypot(q.x - p.x, q.y - p.y); if (d < distance) { nearest = a.id; distance = d; } } this.select(nearest);
  }
  private paintOverview(data: Overview) {
    this.overviewSource = data; this.overviewCanvas.width = data.width; this.overviewCanvas.height = data.height;
    const c = this.overviewCanvas.getContext('2d')!, terrain = bytes(data.terrain), plants = bytes(data.plants);
    for (let i = 0; i < terrain.length; i++) { c.fillStyle = this.color(terrain[i], this.layers.vegetation ? plants[i] : 0); c.fillRect(i % data.width, Math.floor(i / data.width), 1, 1); }
  }
  private cacheTile(data: TerrainTile) {
    const key = `${data.x},${data.y}`, old = this.tiles.get(key), tile: CachedTile = { data, terrain: bytes(data.terrain), plants: bytes(data.plants), moisture: bytes(data.moisture), nutrients: bytes(data.nutrients), water: bytes(data.water), canvas: old?.canvas ?? document.createElement('canvas') };
    this.tiles.delete(key); this.tiles.set(key, tile); this.paintTile(tile); while (this.tiles.size > 96) this.tiles.delete(this.tiles.keys().next().value!);
  }
  private color(terrain: number, plants: number, noise = 0) { const p = plants / 100; return terrain === 0 ? `rgb(${29 + noise},${65 + noise},${71 + noise})` : terrain === 2 ? `rgb(${62 + noise},${70 + noise},${52 + noise})` : `rgb(${Math.round(45 + p * 21 + noise)},${Math.round(56 + p * 43 + noise)},${Math.round(31 + p * 10 + noise)})`; }
  private paintTile(tile: CachedTile) {
    tile.canvas.width = tile.canvas.height = 128; const c = tile.canvas.getContext('2d')!;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const i = y * 32 + x, t = tile.terrain[i], p = this.layers.vegetation ? tile.plants[i] : 0, s = Math.floor(y / 8) * 4 + Math.floor(x / 8), noise = ((x * 31 + y * 17) % 11) - 5;
      if (this.overlay !== 'natural' && t === 1) { const value = (this.overlay === 'moisture' ? tile.moisture[s] : tile.nutrients[s]) / 100; c.fillStyle = this.overlay === 'moisture' ? `rgb(${Math.round(77 - 50 * value)},${Math.round(57 + 75 * value)},${Math.round(31 + 125 * value)})` : `rgb(${Math.round(76 + 55 * value)},${Math.round(51 + 100 * value)},${Math.round(34 + 20 * value)})`; }
      else c.fillStyle = t === 0 && tile.water[s] < 10 ? '#51462e' : this.color(t, p, noise);
      c.fillRect(x * 4, y * 4, 4, 4);
      if (this.overlay !== 'natural') continue;
      if (t === 1 && p > 35 && (x * 13 + y * 7) % 4 === 0) { c.fillStyle = '#a6c06e70'; c.fillRect(x * 4 + 1, y * 4 + 1, 1, 2); }
      if (t === 2) { c.fillStyle = '#87907755'; c.fillRect(x * 4 + 1, y * 4 + 1, 2, 2); }
    }
  }
  private minimap() {
    if (!this.state) return; const canvas = $<HTMLCanvasElement>('minimap'), c = canvas.getContext('2d')!, w = canvas.width, h = canvas.height;
    c.imageSmoothingEnabled = false; c.drawImage(this.overviewCanvas, 0, 0, w, h);
    for (const [x, y, grazers, hunters] of this.state.overview.population) { const g = this.layers.grazer ? grazers : 0, hCount = this.layers.hunter ? hunters : 0; if (!g && !hCount) continue; c.fillStyle = hCount > g ? '#efad72' : '#e1ecc8'; c.fillRect(x / this.state.width * w - 1, y / this.state.height * h - 1, 2, 2); }
    const t = this.camera.transform(), a = this.camera.toWorld(0, 0), b = this.camera.toWorld(t.w, t.h);
    c.strokeStyle = '#e2f3b6'; c.lineWidth = 1; c.strokeRect(a.x / this.state.width * w, a.y / this.state.height * h, (b.x - a.x) / this.state.width * w, (b.y - a.y) / this.state.height * h);
  }
  draw() {
    if (!this.state || document.hidden) return;
    const target = this.animals.find(a => a.id === this.selected); if (this.following && target) { const p = this.position(target); this.camera.focus(p.x, p.y); this.onView(); }
    const { w, h, scale, ox, oy } = this.camera.transform(), c = this.ctx, dpr = Math.min(2, devicePixelRatio || 1), viewport = this.viewport(), fine = viewport.width <= 192 && viewport.height <= 192;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.fillStyle = '#0d1916'; c.fillRect(0, 0, w, h); c.save(); c.translate(ox, oy); c.scale(scale, scale); c.imageSmoothingEnabled = false;
    c.beginPath(); c.rect(0, 0, this.state.width, this.state.height); c.clip();
    c.drawImage(this.overviewCanvas, 0, 0, this.state.width, this.state.height);
    if (fine) for (const tile of this.tiles.values()) { const d = tile.data; if (d.x + 32 < viewport.x || d.y + 32 < viewport.y || d.x > viewport.x + viewport.width || d.y > viewport.y + viewport.height) continue; c.drawImage(tile.canvas, d.x, d.y, 32, 32); }
    const climate = this.state.ecology, temperature = climate.temperature, sunlight = climate.daylight * this.state.params.sunlight;
    if (temperature < 5) { c.fillStyle = `rgba(187,216,229,${Math.min(.28, (5 - temperature) / 80)})`; c.fillRect(viewport.x, viewport.y, viewport.width, viewport.height); }
    else if (temperature > 30) { c.fillStyle = `rgba(211,155,64,${(temperature - 30) / 100})`; c.fillRect(viewport.x, viewport.y, viewport.width, viewport.height); }
    if (sunlight < .3) { c.fillStyle = `rgba(10,21,48,${(.3 - sunlight) * .9})`; c.fillRect(viewport.x, viewport.y, viewport.width, viewport.height); }
    for (const e of this.state.events) {
      if (['fire', 'wildfire'].includes(e.kind) && e.x !== undefined && e.y !== undefined && this.state.stats.tick - e.tick < 150) { c.strokeStyle = '#f8a364'; c.fillStyle = '#d66d3720'; c.lineWidth = .12; c.setLineDash([.6, .35]); c.beginPath(); c.arc(e.x, e.y, e.radius ?? 5, 0, Math.PI * 2); c.fill(); c.stroke(); c.setLineDash([]); }
      if (e.kind === 'migration' && e.x !== undefined && e.y !== undefined && this.state.stats.tick - e.tick < 300) { c.strokeStyle = '#8fe0c1'; c.lineWidth = 1.5 / scale; c.beginPath(); c.arc(e.x, e.y, 4 + (this.state.stats.tick - e.tick) / 80, 0, Math.PI * 2); c.stroke(); }
    }
    if (this.grid && scale > 5) { c.strokeStyle = '#e2efb71b'; c.lineWidth = .06; c.beginPath(); for (let x = Math.floor(viewport.x); x <= viewport.x + viewport.width; x++) { c.moveTo(x, viewport.y); c.lineTo(x, viewport.y + viewport.height); } for (let y = Math.floor(viewport.y); y <= viewport.y + viewport.height; y++) { c.moveTo(viewport.x, y); c.lineTo(viewport.x + viewport.width, y); } c.stroke(); }
    if (!fine) for (const [x, y, grazers, hunters] of this.state.density) { const g = this.layers.grazer ? grazers : 0, hc = this.layers.hunter ? hunters : 0; if (!g && !hc) continue; const side = Math.min(6, 2 + Math.log1p(g + hc)) / scale; c.fillStyle = hc > g ? '#eea271' : '#e6eccb'; c.fillRect(x - side / 2, y - side / 2, side, side); }
    const compact = this.animals.length > 1200, time = this.state.stats.tick / 5 + (!this.state.params.paused ? Math.min(this.interval, performance.now() - this.received) / 1000 * this.state.params.speed : 0);
    const dots = compact ? { grazer: new Path2D(), hunter: new Path2D() } : undefined;
    for (const a of this.animals) {
      if (!this.layers[a.species] || (!fine && a.id !== this.selected)) continue;
      const p = this.position(a); if (p.x * scale + ox < -20 || p.x * scale + ox > w + 20 || p.y * scale + oy < -20 || p.y * scale + oy > h + 20) continue;
      if (dots && a.id !== this.selected) { const side = Math.max(2.5 / scale, .35); dots[a.species].rect(p.x, p.y, side, side); continue; }
      c.save(); c.translate(p.x, p.y);
      if (a.id === this.selected) { c.strokeStyle = '#f1facb'; c.lineWidth = Math.max(.09, 1.4 / scale); c.beginPath(); c.arc(0, 0, .95, 0, Math.PI * 2); c.stroke(); c.fillStyle = '#eff8c920'; c.fill(); }
      const pose = spritePose(a), frame = reducedMotion.matches || a.action === '休息' || a.action === '饮水' ? 0 : Math.floor(time * (pose === 'run' ? 10 : pose === 'eat' ? 4 : 6) + a.id % 4) % 4;
      c.scale(Math.cos(a.heading) < 0 ? -1 : 1, 1); const sprite = animalSprite(a.species, pose, frame), side = Math.max(12 / scale, 1.9) * (a.age < maturity(a.species, this.state.params) ? .65 : 1); c.drawImage(sprite, -side / 2, -side * .78, side, side); c.restore();
    }
    if (dots) { c.fillStyle = '#e1ecc8'; c.fill(dots.grazer); c.fillStyle = '#efad72'; c.fill(dots.hunter); }
    c.restore();
    if (this.state.ecology.nature?.weather && this.state.ecology.weather?.kind === 'rain') {
      c.save(); c.beginPath(); c.rect(0, 0, w, h); c.clip(); c.strokeStyle = '#b3def34d'; c.lineWidth = 1;
      const phase = reducedMotion.matches ? 0 : this.state.stats.tick * 3 + (this.state.params.paused ? 0 : Math.min(500, performance.now() - this.received) * .02 * this.state.params.speed);
      c.beginPath(); for (let i = 0; i < 48; i++) { const x = (i * 127.7 + phase * .2) % w, y = (i * 79.3 + phase) % h; c.moveTo(x, y); c.lineTo(x - 3, y + 10); } c.stroke(); c.restore();
    }
    this.minimap(); $('map-detail').textContent = fine ? `${this.tiles.size} 块缓存 · 近景精灵` : '远景概览 · 点击区域放大';
  }
}
