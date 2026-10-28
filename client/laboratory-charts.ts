import { chartPalette } from './appearance';
export interface Point { x: number; y: number | null; label?: string }
export interface Curve { name: string; color: string; points: Point[]; dashed?: boolean; unit?: string }
function simulationTime(seconds: number) { const n = Math.round(seconds); return `${Math.floor(n / 3600)}:${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; }
export class LabPlot {
  curves: Curve[] = []; log = false; trajectory = false;
  fixedY?: number; xMin?: number; xMax?: number; xUnit = 's'; yUnit = ''; hover = -1; timeAxis = true; integerY = false;
  constructor(private canvas: HTMLCanvasElement, private output: HTMLElement) {
    window.addEventListener('themechange', () => this.draw());
    new ResizeObserver(() => this.draw()).observe(canvas);
    canvas.addEventListener('pointermove', e => {
      const points = this.curves[0]?.points; if (!points?.length) return;
      const r = canvas.getBoundingClientRect(), f = Math.max(0, Math.min(1, (e.clientX - r.left - 48) / (r.width - 64)));
      const [a, b] = this.domain(); const x = a + (b - a) * f;
      this.hover = points.reduce((best, p, i) => Math.abs(p.x - x) < Math.abs(points[best].x - x) ? i : best, 0); this.draw();
    });
    canvas.addEventListener('pointerleave', () => { this.hover = -1; this.draw(); });
    canvas.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'Escape'].includes(e.key)) return; e.preventDefault();
      this.hover = e.key === 'Escape' ? -1 : Math.max(0, Math.min((this.curves[0]?.points.length ?? 1) - 1, (this.hover < 0 ? 0 : this.hover) + (e.key === 'ArrowRight' ? 1 : -1))); this.draw();
    });
  }
  update(curves: Curve[]) { this.curves = curves; this.draw(); }
  private domain() {
    const points = this.curves.flatMap(c => c.points); const a = this.xMin ?? Math.min(...points.map(p => p.x), Infinity);
    const b = this.xMax ?? Math.max(...points.map(p => p.x), -Infinity);
    return [Number.isFinite(a) ? a : 0, Number.isFinite(b) && b > a ? b : (Number.isFinite(a) ? a : 0) + 1];
  }
  draw() {
    const palette = chartPalette();
    const tint = (color: string) => color.startsWith('--') ? getComputedStyle(document.documentElement).getPropertyValue(color).trim() : color;
    const r = this.canvas.getBoundingClientRect(); if (r.width < 50 || r.height < 50 || document.hidden) return;
    const d = Math.min(2, devicePixelRatio || 1); this.canvas.width = Math.round(r.width * d); this.canvas.height = Math.round(r.height * d);
    const c = this.canvas.getContext('2d')!; c.setTransform(d, 0, 0, d, 0, 0);
    const l = 48, top = 18, w = r.width - l - 16, h = r.height - 50;
    const [minX, maxX] = this.domain(); const values = this.curves.flatMap(s => s.points.flatMap(p => p.y === null ? [] : [p.y]));
    const rawStep = Math.max(.001, ...values) * 1.05 / 4, magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const fraction = rawStep / magnitude, step = Math.max(this.integerY ? 1 : .000001, magnitude * (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10));
    const maxY = this.fixedY ?? step * 4;
    const x = (v: number) => l + (v - minX) / (maxX - minX) * w;
    const y = (v: number) => top + h * (1 - (this.log ? Math.log1p(v) / Math.log1p(maxY) : v / maxY));
    const fmt = (v: number) => Math.abs(v) >= 10000 ? `${(v / 1000).toFixed(0)}k` : +v.toFixed(Math.abs(v) < 1 ? 3 : 1);
    c.font = '11px "Chakra Petch", sans-serif'; c.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const yy = top + h * i / 4, value = this.log ? Math.expm1(Math.log1p(maxY) * (1 - i / 4)) : maxY * (1 - i / 4);
      c.strokeStyle = palette.grid; c.setLineDash([2, 5]); c.beginPath(); c.moveTo(l, yy); c.lineTo(l + w, yy); c.stroke();
      c.fillStyle = palette.axis; c.textAlign = 'right'; c.fillText(String(fmt(value)), l - 9, yy + 3);
    }
    c.setLineDash([]); c.textAlign = 'center';
    for (let i = 0; i < 4; i++) { const v = minX + (maxX - minX) * i / 3; c.fillText(this.timeAxis ? simulationTime(v) : `${fmt(v)}${i === 3 ? this.xUnit : ''}`, x(v), top + h + 21); }
    if (this.yUnit) { c.textAlign = 'left'; c.fillText(this.yUnit, l, 10); }
    c.save(); c.beginPath(); c.rect(l - 2, top - 2, w + 4, h + 4); c.clip();
    for (const curve of this.curves) {
      c.setLineDash(curve.dashed ? [5, 5] : []); c.strokeStyle = tint(curve.color); c.lineWidth = curve.dashed ? 1.8 : 2.4;
      let open = false; c.beginPath();
      curve.points.forEach((p, i) => {
        if (p.y === null || !Number.isFinite(p.y)) { open = false; return; }
        if (this.trajectory && i && curve.points[i - 1].y !== null) {
          c.stroke(); c.strokeStyle = palette.plants; c.globalAlpha = .5 + i / curve.points.length * .5; c.beginPath(); c.moveTo(x(curve.points[i - 1].x), y(curve.points[i - 1].y!)); c.lineTo(x(p.x), y(p.y));
        } else if (open) c.lineTo(x(p.x), y(p.y)); else c.moveTo(x(p.x), y(p.y)); open = true;
      }); c.stroke(); c.globalAlpha = 1;
      const end = curve.points.at(-1); if (end?.y !== null && end?.y !== undefined) { c.fillStyle = tint(curve.color); c.beginPath(); c.arc(x(end.x), y(end.y), 3, 0, 7); c.fill(); }
    }
    const index = this.hover >= 0 ? Math.min(this.hover, (this.curves[0]?.points.length ?? 1) - 1) : (this.curves[0]?.points.length ?? 0) - 1;
    const p = this.curves[0]?.points[index];
    if (p && this.hover >= 0) { c.setLineDash([3, 3]); c.strokeStyle = palette.cursor; c.beginPath(); c.moveTo(x(p.x), top); c.lineTo(x(p.x), top + h); c.stroke(); }
    c.restore();
    if (p) this.output.textContent = `${p.label ?? (this.timeAxis ? `${simulationTime(p.x)} 模拟时刻` : `${fmt(p.x)} ${this.xUnit}`)} · ` + this.curves.map(s => `${s.name} ${s.points[index]?.y === null || s.points[index]?.y === undefined ? '—' : fmt(s.points[index].y!)}${s.unit ?? ''}`).join(' / ');
    if (!values.length) { c.fillStyle = palette.axis; c.textAlign = 'center'; c.fillText('尚无有效测量 · 等待服务器采样', l + w / 2, top + h / 2); }
  }
}
