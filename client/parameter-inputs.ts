import { allParameterSpecs, preciseNumber, type EnvironmentKey, type Environment } from '../shared/environment';
import { processSpecs } from '../shared/model';
import { controlKind, displayNumber } from '../shared/parameter-presentation';
import { instrumentMarkup, controlNames } from './control-instruments';

export type Auxiliary = 'percent' | 'minuteRate' | 'minutes' | 'halfLife' | 'degreeGain' | 'mealEnergy';
export function auxiliaryFor(key: EnvironmentKey): Auxiliary | undefined {
  if (key === 'decayRate') return 'halfLife';
  if (key === 'decayQ10') return 'degreeGain';
  if (key === 'decayEfficiency' || key === 'hunterAssimilation') return 'percent';
  if (key === 'grazerAssimilation') return 'mealEnergy';
  const s = key in processSpecs ? processSpecs[key as keyof typeof processSpecs] : undefined;
  if (s?.unit === '模拟秒') return 'minutes';
  if (s && /\/s|点\/s|\(格·s\)|\(s·°C\)/.test(s.unit)) return 'minuteRate';
  if (!s && key !== 'temperature') return 'percent';
}
export function toAuxiliary(kind: Auxiliary, value: number) {
  if (kind === 'halfLife') return value > 0 ? Math.LN2 / value : null;
  if (kind === 'degreeGain') return (value ** .1 - 1) * 100;
  if (kind === 'minutes') return value / 60;
  if (kind === 'minuteRate') return value * 60;
  if (kind === 'mealEnergy') return value * 10;
  return value * 100;
}
export function fromAuxiliary(kind: Auxiliary, value: number) {
  if (!Number.isFinite(value) || (kind === 'halfLife' && value <= 0) || (kind === 'degreeGain' && value <= -100)) throw new Error(kind === 'halfLife' ? '半衰期必须是大于0的有限秒数' : '请输入有效的有限数值');
  if (kind === 'halfLife') return Math.LN2 / value;
  if (kind === 'degreeGain') return (1 + value / 100) ** 10;
  if (kind === 'minutes') return value * 60;
  if (kind === 'minuteRate') return value / 60;
  if (kind === 'mealEnergy') return value / 10;
  return value / 100;
}
export function nudgeValue(key: EnvironmentKey, value: number, amount: number, direction: number, relative = false) {
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(value) || ![-1, 1].includes(direction)) throw new Error('微调量必须大于0');
  const s = allParameterSpecs[key], displacement = relative ? Math.abs(value) * amount / 100 : amount;
  return Math.max(s.min, Math.min(s.max, Number((value + direction * displacement).toPrecision(15))));
}
export function thermalPair(key: EnvironmentKey) {
  return key === 'thermalWidth' ? { center: 'growthOptimum' as const, width: 'thermalWidth' as const } : key === 'decayThermalWidth' ? { center: 'decayOptimum' as const, width: 'decayThermalWidth' as const } : undefined;
}
export function thermalPatch(key: EnvironmentKey, side: 'low' | 'high', boundary: number, current: Environment): Partial<Environment> {
  const pair = thermalPair(key); if (!pair || !Number.isFinite(boundary)) throw new Error('温区端点必须是有限温度');
  const low = side === 'low' ? boundary : current[pair.center] - current[pair.width];
  const high = side === 'high' ? boundary : current[pair.center] + current[pair.width];
  if (low >= high) throw new Error('温区下限必须低于上限');
  const patch = { [pair.center]: (low + high) / 2, [pair.width]: (high - low) / 2 };
  validatePatch(patch); return patch;
}
export function validatePatch(patch: Partial<Environment>) {
  for (const [key, value] of Object.entries(patch)) {
    const s = allParameterSpecs[key as EnvironmentKey];
    if (!s || typeof value !== 'number' || !Number.isFinite(value) || value < s.min || value > s.max) throw new Error(`${s?.label ?? key}需在${s?.min}–${s?.max}范围内；请调整输入`);
  }
}
const toggles: Partial<Record<EnvironmentKey, string>> = { rain: '降雨', sunlight: '日照', fertility: '肥力增益', growthRate: '植物增长', decayRate: '碎屑分解', mutation: '随机变异', grazerBirthRate: '兔新受孕', hunterBirthRate: '狐新受孕' };
const auxLabels: Record<Auxiliary, [string, string, string]> = {
  percent: ['百分比输入', '%', '100% = 系数1，可输入任意小数'],
  minuteRate: ['按分钟输入', '每模拟分钟', '与上方每秒系数双向换算，不改变模型时间步长'],
  minutes: ['按分钟输入', '模拟分钟', '支持小数分钟；1.25分钟 = 75模拟秒'],
  halfLife: ['参考半衰期', '模拟秒', 'ln(2)/k；参考20°C、热适宜度和水分因子均为1，不是当前实际分解耗时'],
  degreeGain: ['每升温1°C的倍率增幅', '%', '仅换算Q10因子，不包含温区和水分限制'],
  mealEnergy: ['每10 VU摄入收益', 'EU', '植物营养倍率为1时；EU/VU不是无量纲百分比'],
};
export function inputMarkup(key: EnvironmentKey, label: string, unit: string, explanation = '') {
  const s = allParameterSpecs[key], kind = auxiliaryFor(key), pair = thermalPair(key);
  const auxiliary = kind ? `<label class="alternate-input" for="aux-${key}"><span>${auxLabels[kind][0]}</span><span><input id="aux-${key}" data-aux="${kind}" data-key="${key}" type="number" inputmode="decimal" step="any" aria-describedby="aux-note-${key}"><small>${kind === 'minuteRate' ? unit.replace('s', 'min') : auxLabels[kind][1]}</small></span></label><p class="editor-note" id="aux-note-${key}">${auxLabels[kind][2]}</p>` : '';
  const bounds = pair ? `<fieldset class="thermal-bounds"><legend>直接定义有效温区 · 同时更新中心与宽度</legend><label>下限 °C<input id="bound-${key}-low" data-bound="low" data-key="${key}" type="number" inputmode="decimal" step="any" aria-label="${label}温区下限"></label><span>至</span><label>上限 °C<input id="bound-${key}-high" data-bound="high" data-key="${key}" type="number" inputmode="decimal" step="any" aria-label="${label}温区上限"></label></fieldset>` : '';
  const temperature = ['temperature', 'growthOptimum', 'decayOptimum', 'diurnalAmplitude'].includes(key);
  const gauge = temperature || ['moistureThreshold', 'nutrientThreshold'].includes(key) ? `<div class="parameter-gauge ${temperature ? 'temperature-gauge' : ''}" aria-hidden="true"><i data-gauge="${key}"></i></div><p class="editor-note">${temperature ? '连续温度刻度 · 精确值以上方输入为准' : '资源饱和阈值 · 指数0–100，非百分比增长率'}</p>` : '';
  const surface = controlKind(key), hint = surface === 'rotary' ? '外圈转动 / 中心上下拖' : surface === 'fader' ? '上下拖动推子' : surface === 'time' ? '输入分:秒 / 拖曳时间带' : '左右拖动刻度带';
  return `<div class="console-hardware" data-control-kind="${surface}">${instrumentMarkup(key, label)}<div class="console-readout"><div class="readout-heading"><span class="readout-caption sr-only">${controlNames[surface]}</span><button type="button" data-fine="${key}" aria-pressed="false" aria-label="${label}精细调节" title="仅此参数精细调节：拖动与步进×0.1">精细</button></div><div class="precision-main"><input class="scrub-input" readonly type="number" inputmode="decimal" id="expert-${key}" min="${s.min}" max="${s.max}" step="any" value="${s.default}" aria-label="${label}" title="左右拖动数值；双击或按Enter精确输入" aria-describedby="mechanism-${key} limits-${key} dial-help-${key}"><span>${unit}</span><button type="button" data-edit-value="${key}" title="输入精确数值" aria-label="精确输入${label}">✎</button></div><p class="sr-only" id="dial-help-${key}">${hint}<br>数值左右拖 · 双击输入</p></div></div>
    ${toggles[key] ? `<button type="button" role="switch" data-process-toggle="${key}" aria-checked="true" class="process-toggle">${toggles[key]}<span data-toggle-label="${key}">已开启</span></button>` : ''}
    <details class="console-advanced"><summary>详情与精确设置 <span aria-hidden="true">⌄</span></summary><div class="console-advanced-body">${explanation}<div class="console-reference">当前 <b data-current="${key}">—</b> · 默认 ${s.default} ${unit}</div>
    <div class="nudge-row"><button type="button" data-nudge="${key}" data-direction="-1" aria-label="减小${label}">−</button><label><span class="sr-only">${label}微调量</span><input data-amount="${key}" type="number" inputmode="decimal" step="any" min="0" value="${s.step}" aria-label="${label}微调量"></label><select data-adjust-mode="${key}" aria-label="${label}微调方式"><option value="absolute">绝对微调</option><option value="relative">相对 %</option></select><button type="button" data-nudge="${key}" data-direction="1" aria-label="增大${label}">＋</button></div>
    ${auxiliary}${bounds}${gauge}<button type="button" class="channel-reset" data-reset-parameter="${key}" aria-label="${label}恢复默认">恢复默认值</button><small id="limits-${key}">范围 ${s.min}–${s.max} ${unit}</small></div></details>
    <p class="input-feedback" data-input-feedback="${key}" role="status" hidden></p>`;
}
export function setAuxiliaryValue(input: HTMLInputElement, value: number | null) { input.value = value === null ? '' : displayNumber(value); input.placeholder = value === null ? '已停用 · ∞' : ''; }
