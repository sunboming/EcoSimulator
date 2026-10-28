import { processSpecs } from './model.js';
import type { EnvironmentKey } from './environment.js';

export type ControlKind = 'rotary' | 'temperature' | 'fader' | 'time' | 'rate' | 'distance' | 'coefficient';
export function controlKind(key: EnvironmentKey): ControlKind {
  if (['decayEfficiency', 'hunterAssimilation', 'moistureThreshold', 'nutrientThreshold'].includes(key)) return 'fader';
  if (key === 'temperature') return 'temperature';
  const spec = key in processSpecs ? processSpecs[key as keyof typeof processSpecs] : undefined;
  if (spec?.unit === '模拟秒') return 'time';
  if (spec?.unit === '°C') return 'temperature';
  if (spec?.unit === '格') return 'distance';
  if (spec && /\/VU$/.test(spec.unit)) return 'coefficient';
  if (!spec || spec.unit === '倍' || key === 'decayQ10') return 'rotary';
  return 'rate';
}
/** Display only: never use this rounded string to replace the model value. */
export function displayNumber(value: number) {
  if (!Number.isFinite(value)) return '—';
  const absolute = Math.abs(value); if (absolute === 0) return '0';
  if (absolute < .001 || absolute >= 1e7) return String(Number(value.toPrecision(3)));
  const digits = absolute >= 100 ? 1 : absolute >= 1 ? 2 : absolute >= .1 ? 3 : absolute >= .01 ? 4 : 5;
  return String(Number(value.toFixed(digits)));
}
export function formatTimecode(seconds: number) {
  const hundredths = Math.round(seconds * 100);
  return `${String(Math.floor(hundredths / 6000)).padStart(2, '0')}:${((hundredths % 6000) / 100).toFixed(2).padStart(5, '0')}`;
}
export function parseTimecode(input: string) {
  const text = input.trim();
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  const parts = /^(\d+):(\d{1,2}(?:\.\d+)?)$/.exec(text);
  if (!parts || Number(parts[2]) >= 60) throw new Error('请输入 分:秒，秒需小于60；也可直接输入秒数');
  return Number(parts[1]) * 60 + Number(parts[2]);
}
export class ParameterSensitivity {
  private fine = new Set<EnvironmentKey>();
  toggle(key: EnvironmentKey) { if (this.fine.has(key)) this.fine.delete(key); else this.fine.add(key); return this.fine.has(key); }
  factor(key: EnvironmentKey) { return this.fine.has(key) ? .1 : 1; }
}
