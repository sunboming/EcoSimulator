import type { Parameters } from '../shared/types.js';
import { environmentDefaults, type EnvironmentKey } from '../shared/environment.js';
export type { EnvironmentKey } from '../shared/environment.js';
export class EnvironmentDraft {
  private edits: Partial<Pick<Parameters, EnvironmentKey>> = {};
  get dirty() { return Object.keys(this.edits).length > 0; }
  edit(key: EnvironmentKey, value: number, current: Partial<Parameters>) {
    if (value === (current[key] ?? environmentDefaults[key])) delete this.edits[key]; else this.edits[key] = value;
  }
  value(key: EnvironmentKey, current: Partial<Parameters>) { return this.edits[key] ?? current[key] ?? environmentDefaults[key]; }
  patch() { return { ...this.edits }; }
  reconcile(current: Partial<Parameters>) {
    for (const key of Object.keys(this.edits) as EnvironmentKey[]) if (this.edits[key] === current[key]) delete this.edits[key];
  }
  clear() { this.edits = {}; }
}
export class PendingCommand {
  private sequence = 0;
  private current: { id: string; action: string } | null = null;
  get busy() { return this.current !== null; }
  get action() { return this.current?.action; }
  begin(action: string) {
    if (this.current) return null;
    const id = `command-${++this.sequence}`; this.current = { id, action }; return id;
  }
  finish(id: string) {
    if (id !== this.current?.id) return null;
    const action = this.current.action; this.current = null; return action;
  }
  cancel() { this.current = null; }
}
export class Camera {
  zoom = 1; private px = 0; private py = 0;
  private w = 1; private h = 1; private width = 1; private height = 1;
  get maxZoom() { return Math.max(6, Math.max(this.width, this.height) / 24); }
  resize(w: number, h: number, width: number, height: number) { this.w = w; this.h = h; this.width = width; this.height = height; this.constrain(); }
  transform() {
    const scale = Math.min(this.w / this.width, this.h / this.height) * this.zoom;
    return { w: this.w, h: this.h, scale, ox: (this.w - this.width * scale) / 2 + this.px, oy: (this.h - this.height * scale) / 2 + this.py };
  }
  toWorld(x: number, y: number) { const t = this.transform(); return { x: (x - t.ox) / t.scale, y: (y - t.oy) / t.scale }; }
  zoomAt(factor: number, x = this.w / 2, y = this.h / 2) {
    const point = this.toWorld(x, y); this.zoom = Math.max(1, Math.min(this.maxZoom, this.zoom * factor));
    const t = this.transform(); this.px += x - (t.ox + point.x * t.scale); this.py += y - (t.oy + point.y * t.scale); this.constrain();
  }
  pan(dx: number, dy: number) { this.px += dx; this.py += dy; this.constrain(); }
  focus(x: number, y: number) { const t = this.transform(); this.px += this.w / 2 - (t.ox + x * t.scale); this.py += this.h / 2 - (t.oy + y * t.scale); this.constrain(); }
  fit() { this.zoom = 1; this.px = this.py = 0; }
  private constrain() {
    const t = this.transform();
    const xLimit = Math.max(0, (this.width * t.scale - this.w) / 2), yLimit = Math.max(0, (this.height * t.scale - this.h) / 2);
    this.px = Math.max(-xLimit, Math.min(xLimit, this.px)); this.py = Math.max(-yLimit, Math.min(yLimit, this.py));
  }
}
