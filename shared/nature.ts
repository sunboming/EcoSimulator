import { climateAt } from './climate.js';
import type { Parameters } from './types.js';

export type WeatherKind = 'clear' | 'rain' | 'drought' | 'heat' | 'cold';
export interface NatureSettings { weather: boolean; migration: boolean; disasters: boolean }
export const natureDefaults: NatureSettings = { weather: true, migration: true, disasters: true };
export const weatherSpecs = {
  clear: { label: '天气平稳', icon: '☀', rain: 1, heat: 0, light: 1, effect: '昼夜与季节继续驱动原野。' },
  rain: { label: '连绵降雨', icon: '☂', rain: 2.4, heat: -3, light: .65, effect: '降雨 ×2.4 · 气温 −3°C · 云层减光35%，水土逐渐补给。' },
  drought: { label: '持续干旱', icon: '◌', rain: .12, heat: 4, light: 1.1, effect: '降雨 ×0.12 · 气温 +4°C，储水减少，干燥植被更易起火。' },
  heat: { label: '热浪过境', icon: '≋', rain: .45, heat: 10, light: 1.05, effect: '气温 +10°C · 降雨 ×0.45，蒸发、动物失水与能量消耗增加。' },
  cold: { label: '冷锋南下', icon: '❄', rain: 1.2, heat: -10, light: .8, effect: '气温 −10°C · 云层减光20%，生长和动物代谢随温度响应。' },
} as const;
export function naturalHash(seed: number, index: number, salt = 0) {
  let n = Math.imul(seed ^ salt, 374761393) ^ Math.imul(index + 1, 668265263);
  n = Math.imul(n ^ n >>> 13, 1274126177); return ((n ^ n >>> 16) >>> 0) / 4294967296;
}
function episode(index: number, seed: number) {
  const season = Math.floor((index * 720 + 180) / 3600) % 4, roll = naturalHash(seed, index, 8191);
  const choices: WeatherKind[][] = [['rain', 'rain', 'drought', 'cold'], ['heat', 'drought', 'rain', 'heat'], ['rain', 'drought', 'cold', 'rain'], ['cold', 'cold', 'rain', 'drought']];
  return { kind: choices[season][Math.min(3, Math.floor(roll * 4))], start: index * 720 + 180, end: index * 720 + 480 + Math.floor(naturalHash(seed, index, 93) * 150) };
}
/** Stateless simulation-time schedule: no timers, stored event queues or viewer dependence. */
export function weatherAt(tick: number, seed: number) {
  const index = Math.floor(tick / 720), e = episode(index, seed), active = tick >= e.start && tick < e.end;
  const next = tick < e.start ? e : episode(index + 1, seed);
  return { kind: active ? e.kind : 'clear' as WeatherKind, start: active ? e.start : index * 720, end: active ? e.end : next.start,
    nextKind: next.kind, nextTick: next.start };
}
export function naturalClimateAt(tick: number, params: Parameters, seed: number, enabled = true) {
  const c = climateAt(tick, params), spec = weatherSpecs[enabled ? weatherAt(tick, seed).kind : 'clear'];
  return { ...c, temperature: c.temperature + spec.heat, rain: c.rain * spec.rain, daylight: c.daylight * spec.light };
}
export function validateNature(input: Partial<NatureSettings>) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.entries(input).some(([key, value]) => !Object.hasOwn(natureDefaults, key) || typeof value !== 'boolean')) throw new Error('自然演变设置无效');
}
