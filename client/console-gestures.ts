import { allParameterSpecs, preciseNumber, type EnvironmentKey } from '../shared/environment';
import { controlKind, displayNumber, ParameterSensitivity } from '../shared/parameter-presentation';

export function angleDelta(before: number, after: number) { return ((after - before + 540) % 360 + 360) % 360 - 180; }
export function dragValue(key: EnvironmentKey, current: number, distance: number, sensitivity = 1, angular = false) {
  const s = allParameterSpecs[key];
  if (![current, distance, sensitivity].every(Number.isFinite)) return current;
  const value = current + distance / (angular ? 270 : 240) * (s.max - s.min) * sensitivity;
  return Math.max(s.min, Math.min(s.max, Number(value.toPrecision(15))));
}
interface Callbacks {
  value(key: EnvironmentKey): number;
  change(key: EnvironmentKey, value: number): void;
  step(key: EnvironmentKey, direction: number, event: { shiftKey: boolean; altKey: boolean }): void;
  reset(key: EnvironmentKey): void;
  cancelEdit(key: EnvironmentKey): void;
}
interface Drag {
  key: EnvironmentKey; element: HTMLElement; pointer: number; origin: number; value: number;
  x: number; y: number; centerX: number; centerY: number; angle: number; angular: boolean; scrub: boolean;
  moved: boolean; pending: number | undefined;
}
/** All gestures only modify the local draft; no network messages or simulation steps. */
export class ConsoleGestures {
  private enabled = false; private drag?: Drag; private frame = 0; private fine = new ParameterSensitivity();
  private refs = new Map<EnvironmentKey, { dial: HTMLElement; input: HTMLInputElement; progress: SVGPathElement | null }>();
  constructor(private callbacks: Callbacks) {
    document.querySelectorAll<HTMLElement>('[data-console-control]').forEach(dial => {
      const key = dial.dataset.consoleControl as EnvironmentKey, input = document.getElementById(`expert-${key}`) as HTMLInputElement;
      this.refs.set(key, { dial, input, progress: dial.querySelector<SVGPathElement>('.dial-progress') });
      this.bindPointer(dial, key, false); this.bindPointer(input, key, true);
      dial.addEventListener('dblclick', e => { e.preventDefault(); if (this.enabled) callbacks.reset(key); });
      input.addEventListener('dblclick', () => this.edit(key));
      input.addEventListener('blur', () => { if (input.checkValidity()) { input.readOnly = true; this.update(key, callbacks.value(key)); } });
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); if (input.readOnly) this.edit(key); else { input.dispatchEvent(new Event('change')); if (input.checkValidity()) { input.readOnly = true; input.blur(); } } }
        if (e.key === 'Escape') { e.preventDefault(); callbacks.cancelEdit(key); input.readOnly = true; input.blur(); }
      });
      dial.addEventListener('keydown', e => {
        if (!this.enabled) return;
        if (['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(e.key)) { e.preventDefault(); callbacks.step(key, ['ArrowUp', 'ArrowRight'].includes(e.key) ? 1 : -1, e); }
        if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); callbacks.change(key, allParameterSpecs[key][e.key === 'Home' ? 'min' : 'max']); }
        if (e.key === 'Enter') { e.preventDefault(); this.edit(key); }
      });
      dial.addEventListener('wheel', e => {
        if (!this.enabled || document.activeElement !== dial) return; e.preventDefault();
        if (e.deltaY) callbacks.step(key, e.deltaY < 0 ? 1 : -1, e);
      }, { passive: false });
    });
    document.querySelectorAll<HTMLButtonElement>('[data-fine]').forEach(button => button.onclick = () => {
      const selected = this.fine.toggle(button.dataset.fine as EnvironmentKey);
      button.setAttribute('aria-pressed', String(selected));
    });
    document.querySelectorAll<HTMLButtonElement>('[data-edit-value]').forEach(button => button.onclick = () => this.edit(button.dataset.editValue as EnvironmentKey));
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && this.drag) { e.preventDefault(); this.end(true); } });
    window.addEventListener('blur', () => this.end(true));
  }
  private edit(key: EnvironmentKey) {
    if (!this.enabled || this.drag) return;
    const input = this.refs.get(key)!.input; input.readOnly = false; input.value = String(this.callbacks.value(key)); input.focus({ preventScroll: true }); input.select();
  }
  private bindPointer(element: HTMLElement, key: EnvironmentKey, scrub: boolean) {
    element.addEventListener('pointerdown', e => {
      if (!this.enabled || this.drag || e.button !== 0 || (scrub && !(element as HTMLInputElement).readOnly)) return;
      const rect = element.getBoundingClientRect(), cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      const angle = Math.atan2(e.clientX - cx, cy - e.clientY) * 180 / Math.PI;
      const origin = this.callbacks.value(key); element.focus({ preventScroll: true }); element.setPointerCapture(e.pointerId);
      this.drag = { key, element, pointer: e.pointerId, origin, value: origin, x: e.clientX, y: e.clientY, centerX: cx, centerY: cy, angle,
        angular: !scrub && controlKind(key) === 'rotary' && Math.hypot(e.clientX - cx, e.clientY - cy) > rect.width * .3, scrub, moved: false, pending: undefined };
      element.classList.add('is-dragging'); this.status(`${allParameterSpecs[key].label} · ${scrub ? '左右拖曳数值' : '拖动调节'} · Esc 撤回本次拖动`);
      // Preserve click focus/double-click editing, but avoid native text selection while scrubbing.
      if (scrub) e.preventDefault();
    });
    element.addEventListener('pointermove', e => {
      const d = this.drag; if (!d || d.pointer !== e.pointerId || d.element !== element) return;
      if (!this.enabled) { this.end(false); return; }
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 3) return;
      d.moved = true;
      const angle = Math.atan2(e.clientX - d.centerX, d.centerY - e.clientY) * 180 / Math.PI;
      const kind = controlKind(key);
      const distance = d.angular ? angleDelta(d.angle, angle) : d.scrub || !['rotary', 'fader'].includes(kind) ? dx : kind === 'fader' ? -dy : -dy + dx * .3;
      d.x = e.clientX; d.y = e.clientY; d.angle = angle;
      d.value = dragValue(key, d.value, distance, this.sensitivity(key) * (e.altKey ? .1 : e.shiftKey ? 10 : 1), d.angular);
      d.pending = d.value; if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.flush(); });
    });
    element.addEventListener('pointerup', e => { if (this.drag?.pointer === e.pointerId && this.drag.element === element) this.end(false); });
    element.addEventListener('pointercancel', e => { if (this.drag?.pointer === e.pointerId) this.end(true); });
    element.addEventListener('lostpointercapture', () => { if (this.drag?.element === element) this.end(true); });
  }
  private flush() { const d = this.drag; if (d?.pending !== undefined) { const value = d.pending; d.pending = undefined; this.callbacks.change(d.key, value); } }
  private end(cancelled: boolean) {
    const d = this.drag; if (!d) return;
    cancelAnimationFrame(this.frame); this.frame = 0; if (!cancelled) this.flush();
    this.drag = undefined; d.element.classList.remove('is-dragging');
    if (d.element.hasPointerCapture(d.pointer)) d.element.releasePointerCapture(d.pointer);
    if (cancelled && d.moved) this.callbacks.change(d.key, d.origin);
    this.status(cancelled ? '已撤回本次拖动 · 其他草稿保留' : '本地草稿 · 应用后才改变共享世界');
  }
  private status(message: string) { const el = document.getElementById('gesture-status'); if (el) el.textContent = message; }
  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.end(true);
    for (const { dial, input } of this.refs.values()) { dial.setAttribute('aria-disabled', String(!enabled)); dial.tabIndex = enabled ? 0 : -1; if (!enabled) input.readOnly = true; }
  }
  cancel() { this.end(true); }
  sensitivity(key: EnvironmentKey) { return this.fine.factor(key); }
  update(key: EnvironmentKey, value: number) {
    const ref = this.refs.get(key); if (!ref) return; const s = allParameterSpecs[key], fraction = (value - s.min) / (s.max - s.min);
    ref.dial.style.setProperty('--dial-angle', `${-135 + fraction * 270}deg`);
    ref.dial.style.setProperty('--control-fraction', String(Math.max(0, Math.min(1, fraction))));
    ref.progress?.setAttribute('stroke-dasharray', `${Math.max(0, Math.min(1, fraction))} 1`);
    ref.dial.setAttribute('aria-valuenow', String(value)); ref.dial.setAttribute('aria-valuetext', displayNumber(value));
    if (ref.input.readOnly) ref.input.value = displayNumber(value);
    ref.input.title = `实际值 ${preciseNumber(value)} · 左右拖动；双击或按Enter精确输入`;
    const readout = document.querySelector<HTMLElement>(`[data-console-value="${key}"]`); if (readout) readout.textContent = displayNumber(value);
  }
}
