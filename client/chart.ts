import type { Stats } from '../shared/types';
import { $ } from './dom';
import { chartPalette } from './appearance';
type Series = 'plants' | 'grazers' | 'hunters';
export class PopulationChart {
  private history: Stats[] = []; private hover = -1; private log = true;
  private visible = new Set<Series>(['plants', 'grazers', 'hunters']);
  private ctx: CanvasRenderingContext2D;
  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    window.addEventListener('themechange', () => { this.draw(); this.sparklines(); });
    canvas.addEventListener('pointermove', e => { const r = canvas.getBoundingClientRect(); this.hover = Math.round(Math.max(0, Math.min(1, (e.clientX - r.left - 45) / (r.width - 65))) * (this.history.length - 1)); this.draw(); });
    canvas.addEventListener('pointerleave', () => { this.hover = -1; this.draw(); });
    canvas.addEventListener('keydown', e => { if (!['ArrowLeft', 'ArrowRight', 'Escape'].includes(e.key)) return; e.preventDefault(); this.hover = e.key === 'Escape' ? -1 : Math.max(0, Math.min(this.history.length - 1, (this.hover < 0 ? this.history.length - 1 : this.hover) + (e.key === 'ArrowLeft' ? -1 : 1))); this.draw(); });
    document.querySelectorAll<HTMLButtonElement>('[data-series]').forEach(b => b.onclick = () => {
      const key = b.dataset.series as Series;
      if (this.visible.has(key)) { if (this.visible.size === 1) return; this.visible.delete(key); } else this.visible.add(key);
      b.setAttribute('aria-pressed', String(this.visible.has(key))); this.draw();
    });
    $('chart-scale').onclick = () => { this.log = !this.log; $('chart-scale').textContent = `${this.log ? '对数' : '线性'}刻度 ⇄`; this.draw(); };
    new ResizeObserver(() => { this.draw(); this.sparklines(); }).observe(canvas.parentElement!);
  }
  update(history: Stats[]) { this.history = history; if (this.hover >= history.length) this.hover = -1; this.draw(); this.sparklines(); }
  private setup(canvas: HTMLCanvasElement) {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    if (canvas.width !== Math.round(r.width * dpr) || canvas.height !== Math.round(r.height * dpr)) { canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); }
    const c = canvas.getContext('2d')!; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, r.width, r.height);
    return { w: r.width, h: r.height, c };
  }
  private sparklines() {
    const colors = chartPalette();
    for (const canvas of document.querySelectorAll<HTMLCanvasElement>('[data-metric]')) {
      const { w, h, c } = this.setup(canvas), key = canvas.dataset.metric as Series | 'births';
      const samples = this.history.slice(-35).map(s => s[key]); if (!samples.length) continue;
      const min = Math.min(...samples), range = Math.max(1, Math.max(...samples) - min);
      c.beginPath(); samples.forEach((v, i) => { const x = 2 + i / Math.max(1, samples.length - 1) * (w - 4), y = h - 3 - (v - min) / range * (h - 6); if (i) c.lineTo(x, y); else c.moveTo(x, y); }); c.strokeStyle = colors[key]; c.lineWidth = 1.5; c.stroke();
      c.lineTo(w - 2, h); c.lineTo(2, h); c.closePath(); c.fillStyle = `${colors[key]}15`; c.fill();
    }
  }
  draw() {
    const colors = chartPalette();
    const { w, h } = this.setup(this.canvas), c = this.ctx, left = 45, top = 20, cw = w - 65, ch = h - 40;
    const max = Math.max(10, ...this.history.flatMap(s => [...this.visible].map(key => s[key])));
    const fraction = (n: number) => this.log ? Math.log1p(n) / Math.log1p(max) : n / max;
    c.font = '500 11px "Chakra Petch", monospace'; c.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const y = top + ch * i / 3;
      c.strokeStyle = colors.grid; c.setLineDash([3, 5]); c.beginPath(); c.moveTo(left, y); c.lineTo(w - 20, y); c.stroke();
      c.fillStyle = colors.axis; const value = Math.round(this.log ? Math.expm1(Math.log1p(max) * (1 - i / 3)) : max * (1 - i / 3)); c.fillText(value.toLocaleString(), 5, y + 3);
    }
    c.setLineDash([]);
    if (!this.history.length) { c.fillStyle = colors.axis; c.textAlign = 'center'; c.fillText('等待第一个采样点', w / 2, h / 2); c.textAlign = 'left'; }
    for (const key of this.visible) {
      if (!this.history.length) continue;
      c.beginPath(); this.history.forEach((s, i) => { const x = left + i / Math.max(1, this.history.length - 1) * cw, y = top + ch * (1 - fraction(s[key])); if (!i) c.moveTo(x, y); else c.lineTo(x, y); });
      c.strokeStyle = colors[key]; c.lineWidth = 2.3; c.stroke();
      const last = this.history.at(-1)!; c.fillStyle = colors[key]; c.beginPath(); c.arc(this.history.length > 1 ? left + cw : left, top + ch * (1 - fraction(last[key])), 2.8, 0, 7); c.fill();
    }
    const sample = this.history[this.hover]; $('chart-readout').hidden = !sample;
    if (sample) {
      const x = left + this.hover / Math.max(1, this.history.length - 1) * cw;
      c.strokeStyle = colors.cursor; c.lineWidth = 1; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(x, top); c.lineTo(x, top + ch); c.stroke(); c.setLineDash([]);
      $('chart-readout').textContent = `${Math.floor(sample.tick / 5)} 秒 · 植物 ${sample.plants.toLocaleString()} / 食草 ${sample.grazers} / 食肉 ${sample.hunters}`;
      $('chart-caption').textContent = `第 ${Math.floor(sample.tick / 5)} 模拟秒`;
    } else $('chart-caption').textContent = '悬停或触摸查看数量';
    $('chart-start').textContent = this.history.length ? `${Math.floor(this.history[0].tick / 5)}s` : '等待采样';
    $('chart-end').textContent = this.history.length ? `${Math.floor(this.history.at(-1)!.tick / 5)}s` : '现在';
  }
}
