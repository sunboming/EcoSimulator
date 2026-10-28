import type { Parameters } from './types.js';
export interface Climate { day: number; hour: number; season: string; daylight: number; temperature: number; rain: number; breeding: number }
/** Display days last 120 simulated seconds; one season lasts six days. */
export function climateAt(tick: number, params: Parameters): Climate {
  const days = tick / 600, season = Math.floor(days / 6) % 4;
  const phase = (days + .35) % 1, length = [.55, .7, .5, .35][season];
  const solar = Math.cos((phase - .5) * Math.PI * 2);
  const daylight = Math.max(0, Math.min(1, (solar - Math.cos(length * Math.PI)) / (1 - Math.cos(length * Math.PI))));
  return { day: Math.floor(days) + 1, hour: phase * 24, season: ['春季', '夏季', '秋季', '冬季'][season], daylight,
    temperature: params.temperature + [0, 8, -2, -12][season] * params.seasonStrength + solar * params.diurnalAmplitude,
    rain: params.rain * Math.max(0, 1 + ([1, .65, 1.2, .7][season] - 1) * params.seasonStrength), breeding: Math.max(0, 1 + ([1, .85, .45, .15][season] - 1) * params.seasonStrength) };
}
