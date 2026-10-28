import { allParameterSpecs, type EnvironmentKey } from '../shared/environment';
import { controlKind, displayNumber, formatTimecode } from '../shared/parameter-presentation';

export const controlNames = { rotary: '旋钮', temperature: '温度尺', fader: '推子', time: '时间码', rate: '速率带', distance: '距离尺', coefficient: '系数带' } as const;
export function instrumentMarkup(key: EnvironmentKey, label: string) {
  const s = allParameterSpecs[key], kind = controlKind(key);
  const attributes = `data-console-control="${key}" role="slider" aria-orientation="${kind === 'rotary' || kind === 'fader' ? 'vertical' : 'horizontal'}" tabindex="-1" aria-disabled="true" aria-label="${label}${controlNames[kind]}" aria-valuemin="${s.min}" aria-valuemax="${s.max}" aria-valuenow="${s.default}" aria-describedby="dial-help-${key}"`;
  if (kind === 'rotary') {
    const ticks = Array.from({ length: 19 }, (_, i) => { const angle = (-135 + i * 15) * Math.PI / 180, r = i % 3 === 0 ? 50 : 52; return `<line x1="${60 + Math.sin(angle) * r}" y1="${60 - Math.cos(angle) * r}" x2="${60 + Math.sin(angle) * 56}" y2="${60 - Math.cos(angle) * 56}"/>`; }).join('');
    return `<div class="dial-assembly"><div class="rotary-dial" data-dial="${key}" ${attributes}><svg viewBox="0 0 120 120" aria-hidden="true"><g class="dial-ticks">${ticks}</g><path class="dial-track" d="M27.473 92.527 A46 46 0 1 1 92.527 92.527"/><path class="dial-progress" pathLength="1" stroke-dasharray="0 1" d="M27.473 92.527 A46 46 0 1 1 92.527 92.527"/></svg><span class="dial-face"><i></i></span><span class="dial-center" aria-hidden="true"></span></div><div class="dial-scale"><span>${s.min}</span><span>${s.max}</span></div></div>`;
  }
  if (kind === 'time') return `<div class="time-instrument"><label for="clock-${key}">MIN : SEC</label><input id="clock-${key}" data-timecode="${key}" data-key="${key}" aria-label="${label}时间码" type="text" inputmode="text" value="${formatTimecode(s.default)}" title="分:秒，支持小数秒"><div class="transport-band" ${attributes}><span class="linear-rail"><i class="linear-thumb"></i></span></div><small>编辑时间码 / 拖曳时间带</small></div>`;
  if (kind === 'fader') {
    const fraction = ['decayEfficiency', 'hunterAssimilation'].includes(key), max = fraction ? `${s.max * 100}%` : displayNumber(s.max), min = fraction ? `${s.min * 100}%` : displayNumber(s.min);
    return `<div class="fader-control" ${attributes}><span class="fader-ticks" aria-hidden="true"></span><span class="fader-well"><span class="fader-fill"></span><i class="fader-thumb"></i></span><span class="fader-max">${max}</span><span class="fader-min">${min}</span></div>`;
  }
  const temperature = kind === 'temperature', caption = temperature ? '°C / 连续刻度' : kind === 'distance' ? 'SPACE / 距离' : kind === 'coefficient' ? 'COEFF / 连续系数' : 'RATE / 连续速率';
  return `<div class="${temperature ? 'temperature-control' : 'rate-control'}" ${attributes}><span class="instrument-caption">${caption}</span><span class="linear-rail"><span class="linear-fill"></span><i class="linear-thumb"></i></span><span class="linear-ticks" aria-hidden="true"></span><span class="linear-min">${displayNumber(s.min)}</span><span class="linear-max">${displayNumber(s.max)}</span><small>左右拖动${controlNames[kind]}</small></div>`;
}
