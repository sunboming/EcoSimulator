import './appearance';
import './style.css';
import './laboratory.css';
import './parameter-inputs.css';
import './console.css';
import './control-instruments.css';
import './polish.css';
import { $ } from './dom';
import { allParameterSpecs, environmentDefaults, environmentPresets, formatParameter, preciseNumber, type EnvironmentKey, type Environment } from '../shared/environment';
import { processSpecs, growthPotential } from '../shared/model';
import { historyCSV, populationRates } from '../shared/analysis';
import type { Stats, Snapshot } from '../shared/types';
import { EnvironmentDraft, PendingCommand } from './interactions';
import { LabPlot, type Curve } from './laboratory-charts';
import { inputMarkup, auxiliaryFor, toAuxiliary, fromAuxiliary, thermalPair, thermalPatch, nudgeValue, validatePatch, setAuxiliaryValue } from './parameter-inputs';
import { ConsoleGestures } from './console-gestures';
import { displayNumber, formatTimecode, parseTimecode } from '../shared/parameter-presentation';

type LabState = Pick<Snapshot, 'epoch' | 'width' | 'height' | 'params' | 'stats' | 'history' | 'events' | 'protected' | 'ecology'>;
const keys = Object.keys(allParameterSpecs) as EnvironmentKey[], draft = new EnvironmentDraft(), gate = new PendingCommand();
const invalidKeys = new Set<EnvironmentKey>();
const invalidAux = new Set<HTMLInputElement>(), lastEnabled = new Map<EnvironmentKey, number>();
const groups = ['气候强迫', '水文与土壤', '初级生产', '分解与循环', '摄食与生理', '生命史与演化'];
const introductions = ['设定外部强迫与季节性，让温度、降雨和光照共同驱动生态过程。', '追踪水的补给与损失。水分点为相对指数，不直接等同于毫米降水。', '用生产率与温湿度、养分限制描述资源生成，实际增长受存量约束。', '描述碎屑分解与养分回补。Q10表示温度敏感性，不是统一的生理常数。', '区分摄入、同化、维持代谢与失水，观察资源如何转化为存活机会。', '配对、成熟、妊娠与寿命共同决定代际更替，单一基因影响速度和代谢。'];
const quickGroups: Record<string, string> = { rain: groups[0], temperature: groups[0], sunlight: groups[0], fertility: groups[2], plantNutrition: groups[4], metabolism: groups[4], lifespan: groups[5], grazerBirthRate: groups[5], hunterBirthRate: groups[5], grazerSpeed: groups[4], hunterSpeed: groups[4], vision: groups[4], mutation: groups[5] };
const quickMechanisms: Record<string, string> = {
  rain: '实际降雨倍率 = 基础降雨 × 季节雨量修正；影响入渗和水体补给。',
  temperature: '实际温度 = 基础温度 + 季节温度偏移 × 季节振幅 + 昼夜温差振幅 × cos(时相)。',
  sunlight: '实际光照 = 昼夜光照因子 × 日照倍率；夜间因子为0，植物停止增长。',
  fertility: '潜在植物增长量乘以肥力倍率；水分与养分限制不会被该倍率取消。',
  plantNutrition: '草食能量收益 = 摄入 VU × 草食同化系数 × 植物营养倍率。',
  metabolism: '维持消耗与排泄碎屑量乘以基础代谢倍率，另有温度、活动和幼体修正。',
  lifespan: '年龄上限 = 对应物种基准寿命 × 自然寿命倍率。',
  grazerBirthRate: '满足配对条件后，每0.2模拟秒的雌兔受孕尝试概率为0.025 × 倍率 × 季节繁殖因子。',
  hunterBirthRate: '满足配对条件后，每0.2模拟秒的雌狐受孕尝试概率为0.025 × 倍率 × 季节繁殖因子。',
  grazerSpeed: '兔步行速度0.5格/模拟秒 × 倍率 × 基因；冲刺×1.8，幼体×0.65。',
  hunterSpeed: '狐步行速度0.6格/模拟秒 × 倍率 × 基因；冲刺×1.8，幼体×0.65。',
  vision: '捕食感知半径8格 × 倍率；草食觅食半径为round(3格 × 倍率)，密集区邻居采样。',
  mutation: '子代性状 = 双亲均值 + Uniform(−0.05,0.05) × 变异倍率；截断到[0.7,1.4]。',
};
function meta(key: EnvironmentKey) {
  const s = allParameterSpecs[key], advanced = key in processSpecs ? processSpecs[key as keyof typeof processSpecs] : undefined;
  return { ...s, group: advanced?.group ?? quickGroups[key], unit: advanced?.unit ?? (key === 'temperature' ? '°C' : '倍'), mechanism: advanced?.mechanism ?? quickMechanisms[key], advanced: !!advanced };
}
let state: LabState | undefined, ws: WebSocket | undefined, connected = false, token = '', candidate = '', activeGroup = groups[0];
let history: Stats[] = [], currentTab = 'parameters', retries = 0, lastPacket = 0;
let reconnectTimer: ReturnType<typeof setTimeout>, commandTimer: ReturnType<typeof setTimeout>, toastTimer: ReturnType<typeof setTimeout>;
const plots = {
  temperature: new LabPlot($<HTMLCanvasElement>('response-temperature'), $('temperature-readout')),
  water: new LabPlot($<HTMLCanvasElement>('response-water'), $('water-readout')),
  population: new LabPlot($<HTMLCanvasElement>('population-chart'), $('population-readout')),
  resources: new LabPlot($<HTMLCanvasElement>('resources-chart'), $('resources-readout')),
  rates: new LabPlot($<HTMLCanvasElement>('rates-chart'), $('rates-readout')),
  phase: new LabPlot($<HTMLCanvasElement>('phase-chart'), $('phase-readout')),
  physiology: new LabPlot($<HTMLCanvasElement>('physiology-chart'), $('physiology-readout')),
};
plots.temperature.xUnit = '°C'; plots.temperature.yUnit = 'VU/(格·s)'; plots.water.xUnit = '点'; plots.water.yUnit = 'VU/(格·s)';
plots.temperature.timeAxis = false; plots.water.timeAxis = false; plots.phase.timeAxis = false; plots.population.integerY = true; plots.phase.integerY = true;
plots.resources.fixedY = 100; plots.physiology.fixedY = 100; plots.phase.trajectory = true; plots.phase.xMin = 0; plots.phase.xUnit = '只兔'; plots.phase.yUnit = '只狐';
const color = { rabbit: '--mint', fox: '--orange', plant: '--lime', water: '--blue', muted: '--chart-axis' };
function toast(message: string, error = false) { $('lab-toast').textContent = message; $('lab-toast').classList.toggle('error', error); $('lab-toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('lab-toast').classList.remove('show'), 5000); }
function parameterValue(key: EnvironmentKey) { return draft.value(key, state?.params ?? environmentDefaults); }
function groupFor(key: EnvironmentKey) { return meta(key).group; }
$('parameter-count').textContent = String(keys.length);
$('parameter-groups').innerHTML = groups.map((g, i) => `<button data-group="${g}" aria-pressed="${i === 0}"><span>0${i + 1}</span>${g}<small>${keys.filter(k => groupFor(k) === g).length}</small></button>`).join('');
$('expert-fields').innerHTML = keys.map(key => {
  const s = meta(key);
  return `<article class="expert-field" data-key="${key}" data-group="${s.group}"><div class="field-identity"><label for="expert-${key}">${s.label}</label></div><div class="field-value precision-value">${inputMarkup(key, s.label, s.unit, `<div class="parameter-explanation"><p>${s.hint}</p><p id="mechanism-${key}">${s.mechanism}</p>${key.includes('Gestation') ? '<p>仅影响新受孕个体。</p>' : key.includes('Lifespan') || key === 'lifespan' ? '<p>降低寿命上限可能导致现有个体死亡。</p>' : ''}</div>`)}</div></article>`;
}).join('');
const consoleGestures = new ConsoleGestures({
  value: parameterValue,
  change: (key, value) => acceptPatch({ [key]: value }),
  step: (key, direction, event) => adjustParameter(key, direction, event),
  reset: key => acceptPatch({ [key]: environmentDefaults[key] }),
  cancelEdit: key => { invalidKeys.delete(key); const input = $<HTMLInputElement>(`expert-${key}`); input.setCustomValidity(''); input.value = String(parameterValue(key)); if (![...invalidAux].some(el => el.dataset.key === key)) showInputError(key, ''); syncFields([key]); },
});
function filterFields() {
  const query = $<HTMLInputElement>('parameter-search').value.trim().toLowerCase(); let count = 0;
  document.querySelectorAll<HTMLElement>('.expert-field').forEach(el => {
    const key = el.dataset.key as EnvironmentKey, s = meta(key);
    el.hidden = query ? !`${key} ${s.label} ${s.hint} ${s.unit} ${s.mechanism}`.toLowerCase().includes(query) : s.group !== activeGroup;
    if (!el.hidden) count++;
  });
  $('search-empty').hidden = count > 0;
  $('group-title').textContent = query ? `搜索结果 · ${count} 项` : activeGroup;
  $('group-description').textContent = query ? '搜索跨越全部过程分类，清空后返回当前分类。' : introductions[groups.indexOf(activeGroup)];
  $('group-index').textContent = query ? 'PARAMETER SEARCH' : `PROCESS / 0${groups.indexOf(activeGroup) + 1}`;
  document.querySelectorAll<HTMLButtonElement>('[data-group]').forEach(b => b.setAttribute('aria-pressed', String(!query && b.dataset.group === activeGroup)));
}
document.querySelectorAll<HTMLButtonElement>('[data-group]').forEach(b => b.onclick = () => { activeGroup = b.dataset.group!; $<HTMLInputElement>('parameter-search').value = ''; filterFields(); });
$('parameter-search').oninput = filterFields;
const targetedParameter = new URLSearchParams(location.search).get('parameter');
if (targetedParameter && Object.hasOwn(allParameterSpecs, targetedParameter)) $<HTMLInputElement>('parameter-search').value = targetedParameter;
filterFields();
function edit(key: EnvironmentKey, value: number) {
  const s = allParameterSpecs[key], input = $<HTMLInputElement>(`expert-${key}`);
  if (!Number.isFinite(value) || value < s.min || value > s.max) { invalidKeys.add(key); const message = `请输入 ${s.min}–${s.max} 范围内的有限数值`; input.setCustomValidity(message); showInputError(key, message); input.reportValidity(); controls(); return; }
  acceptPatch({ [key]: value });
}
function showInputError(key: EnvironmentKey, message: string) { const el = document.querySelector<HTMLElement>(`[data-input-feedback="${key}"]`)!; el.textContent = message; el.hidden = !message; }
function acceptPatch(patch: Partial<Environment>) {
  validatePatch(patch);
  for (const [k, value] of Object.entries(patch)) {
    const key = k as EnvironmentKey; invalidKeys.delete(key); const input = $<HTMLInputElement>(`expert-${key}`); input.setCustomValidity(''); input.value = String(value);
    document.querySelectorAll<HTMLInputElement>(`article[data-key="${key}"] input[data-aux],article[data-key="${key}"] input[data-bound],article[data-key="${key}"] input[data-timecode]`).forEach(el => { invalidAux.delete(el); el.setCustomValidity(''); });
    showInputError(key, ''); draft.edit(key, value!, state?.params ?? environmentDefaults);
  }
  syncFields(Object.keys(patch) as EnvironmentKey[]); preview();
}
document.querySelectorAll<HTMLInputElement>('input[id^="expert-"]').forEach(input => input.addEventListener('change', () => { if (!input.readOnly) edit(input.id.replace('expert-', '') as EnvironmentKey, input.valueAsNumber); }));
document.querySelectorAll<HTMLInputElement>('input[data-aux],input[data-bound]').forEach(input => input.addEventListener('change', () => {
  const key = input.dataset.key as EnvironmentKey;
  try {
    const current = { ...(state?.params ?? environmentDefaults), ...draft.patch() };
    const patch = input.dataset.bound ? thermalPatch(key, input.dataset.bound as 'low' | 'high', input.valueAsNumber, current) : { [key]: fromAuxiliary(input.dataset.aux as NonNullable<ReturnType<typeof auxiliaryFor>>, input.valueAsNumber) };
    validatePatch(patch); invalidAux.delete(input); input.setCustomValidity(''); acceptPatch(patch);
  } catch (error) { const message = error instanceof Error ? error.message : '数值无效'; invalidAux.add(input); input.setCustomValidity(message); showInputError(key, message); input.reportValidity(); controls(); }
}));
document.querySelectorAll<HTMLInputElement>('input[data-timecode]').forEach(input => input.addEventListener('change', () => {
  const key = input.dataset.timecode as EnvironmentKey;
  try { const value = parseTimecode(input.value); validatePatch({ [key]: value }); invalidAux.delete(input); input.setCustomValidity(''); acceptPatch({ [key]: value }); }
  catch (error) { const message = error instanceof Error ? error.message : '时间码无效'; invalidAux.add(input); input.setCustomValidity(message); showInputError(key, message); input.reportValidity(); controls(); }
}));
document.querySelectorAll<HTMLInputElement>('input[data-aux],input[data-bound],input[data-timecode]').forEach(input => {
  input.addEventListener('focus', () => {
    if (invalidAux.has(input)) return; const key = input.dataset.key as EnvironmentKey, value = parameterValue(key);
    if (input.dataset.timecode) input.value = `${Math.floor(value / 60)}:${preciseNumber(value % 60).padStart(2, '0')}`;
    else if (input.dataset.aux) { const auxiliary = toAuxiliary(input.dataset.aux as NonNullable<ReturnType<typeof auxiliaryFor>>, value); input.value = auxiliary === null ? '' : String(auxiliary); }
    else { const pair = thermalPair(key)!; input.value = String(parameterValue(pair.center) + (input.dataset.bound === 'low' ? -1 : 1) * parameterValue(pair.width)); }
    input.select();
  });
  input.addEventListener('blur', () => { if (!invalidAux.has(input)) syncFields([input.dataset.key as EnvironmentKey]); });
});
function adjustParameter(key: EnvironmentKey, direction: number, modifiers: { shiftKey: boolean; altKey: boolean }, current?: number) {
  const amount = document.querySelector<HTMLInputElement>(`[data-amount="${key}"]`)!, mode = document.querySelector<HTMLSelectElement>(`[data-adjust-mode="${key}"]`)!;
  try {
    if ((current === undefined && invalidKeys.has(key)) || [...invalidAux].some(el => el.dataset.key === key)) throw new Error('请先修正此参数的无效输入');
    const value = current ?? parameterValue(key); validatePatch({ [key]: value });
    const factor = (modifiers.shiftKey ? 10 : modifiers.altKey ? .1 : 1) * consoleGestures.sensitivity(key);
    acceptPatch({ [key]: nudgeValue(key, value, amount.valueAsNumber * factor, direction, mode.value === 'relative') });
  } catch (error) { toast(error instanceof Error ? error.message : '无法微调', true); }
}
document.querySelectorAll<HTMLButtonElement>('[data-nudge]').forEach(button => button.onclick = e => adjustParameter(button.dataset.nudge as EnvironmentKey, Number(button.dataset.direction), e));
document.querySelectorAll<HTMLInputElement>('input[id^="expert-"]').forEach(input => input.addEventListener('keydown', e => {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return; e.preventDefault();
  const key = input.id.replace('expert-', '') as EnvironmentKey;
  adjustParameter(key, e.key === 'ArrowUp' ? 1 : -1, e, input.readOnly ? parameterValue(key) : input.valueAsNumber);
}));
document.querySelectorAll<HTMLButtonElement>('[data-reset-parameter]').forEach(button => button.onclick = () => { const key = button.dataset.resetParameter as EnvironmentKey; acceptPatch({ [key]: environmentDefaults[key] }); });
document.querySelectorAll<HTMLButtonElement>('[data-process-toggle]').forEach(button => button.onclick = () => {
  const key = button.dataset.processToggle as EnvironmentKey, value = parameterValue(key);
  if (value > 0) lastEnabled.set(key, value); acceptPatch({ [key]: value > 0 ? 0 : lastEnabled.get(key) ?? environmentDefaults[key] });
});
document.querySelectorAll<HTMLSelectElement>('[data-adjust-mode]').forEach(select => select.onchange = () => { const input = document.querySelector<HTMLInputElement>(`[data-amount="${select.dataset.adjustMode}"]`)!; input.value = String(select.value === 'relative' ? 1 : allParameterSpecs[select.dataset.adjustMode as EnvironmentKey].step); });
function syncFields(fieldKeys = keys) {
  for (const key of fieldKeys) {
    const input = $<HTMLInputElement>(`expert-${key}`), value = parameterValue(key);
    if (!invalidKeys.has(key) && document.activeElement !== input) { input.value = String(value); input.setCustomValidity(''); }
    const kind = auxiliaryFor(key), aux = document.querySelector<HTMLInputElement>(`#aux-${key}`);
    if (aux && kind && !invalidAux.has(aux) && document.activeElement !== aux) setAuxiliaryValue(aux, toAuxiliary(kind, value));
    const pair = thermalPair(key);
    if (pair) for (const side of ['low', 'high'] as const) { const bound = $<HTMLInputElement>(`bound-${key}-${side}`); if (!invalidAux.has(bound) && document.activeElement !== bound) bound.value = displayNumber(parameterValue(pair.center) + (side === 'low' ? -1 : 1) * parameterValue(pair.width)); }
    const clock = document.querySelector<HTMLInputElement>(`[data-timecode="${key}"]`); if (clock && !invalidAux.has(clock) && document.activeElement !== clock) clock.value = formatTimecode(value);
    const gauge = document.querySelector<HTMLElement>(`[data-gauge="${key}"]`); if (gauge) { const s = allParameterSpecs[key]; gauge.style.left = `${(value - s.min) / (s.max - s.min) * 100}%`; }
    const toggle = document.querySelector<HTMLButtonElement>(`[data-process-toggle="${key}"]`); if (toggle) { if (value > 0) lastEnabled.set(key, value); toggle.setAttribute('aria-checked', String(value > 0)); document.querySelector(`[data-toggle-label="${key}"]`)!.textContent = value > 0 ? '开启' : '关闭'; }
    const baseline = state?.params[key]; document.querySelector(`[data-current="${key}"]`)!.textContent = baseline === undefined ? '—' : displayNumber(baseline);
    consoleGestures.update(key, value);
    document.querySelector(`[data-key="${key}"]`)!.classList.toggle('modified', baseline !== undefined && parameterValue(key) !== baseline);
  }
  controls(); review();
}
function controls() {
  const editable = connected && !!state && (!state.protected || !!token), busy = gate.busy;
  consoleGestures.setEnabled(editable && !busy);
  document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('.field-value input,.field-value button,.field-value select,#lab-load,#restore-defaults,#import-config').forEach(el => el.disabled = !editable || busy);
  $<HTMLButtonElement>('apply-all').disabled = !editable || busy || !draft.dirty || invalidKeys.size > 0 || invalidAux.size > 0;
  $<HTMLButtonElement>('discard-all').disabled = busy || (!draft.dirty && invalidKeys.size === 0 && invalidAux.size === 0);
  $('lab-unlock').hidden = !state?.protected || !!token; $('lab-lock').hidden = !state?.protected || !token;
  $<HTMLButtonElement>('lab-unlock').disabled = !connected || busy; $<HTMLButtonElement>('lab-lock').disabled = busy;
  $<HTMLButtonElement>('lab-auth-submit').disabled = !connected || busy;
  $('lab-access').textContent = !connected ? '离线 · 最后同步数据' : editable ? '共享世界 · 可管理' : '共享世界 · 只读';
  $('draft-status').textContent = busy ? '等待服务器确认…' : invalidKeys.size + invalidAux.size ? `有${invalidKeys.size + invalidAux.size}项输入无效，请修正` : draft.dirty ? `${Object.keys(draft.patch()).length} 项修改待应用` : connected ? '参数已与服务器同步' : '正在等待连接';
  $('draft-detail').textContent = !editable && connected ? '解锁管理权限后可编辑，查看分析无需口令。' : '应用后影响所有访客；不重置世界。';
  $('apply-all').textContent = gate.action === 'apply' ? '正在应用…' : '应用修改';
}
function review() {
  const patch = draft.patch(), changed = Object.keys(patch) as EnvironmentKey[]; $('change-count').textContent = String(changed.length);
  const list = $('change-list'); list.replaceChildren();
  if (!changed.length) { list.textContent = '尚无修改。调整参数或载入方案后，在此核对。'; return; }
  for (const key of changed) {
    const line = document.createElement('div'), name = document.createElement('span'), value = document.createElement('strong');
    name.textContent = meta(key).label; value.textContent = `${formatParameter(key, state?.params[key] ?? environmentDefaults[key])} → ${formatParameter(key, patch[key]!)}`;
    value.title = `${state?.params[key] ?? environmentDefaults[key]} → ${patch[key]}`;
    if (formatParameter(key, state?.params[key] ?? environmentDefaults[key]) === formatParameter(key, patch[key]!)) value.textContent += ' · 精细变化';
    line.append(name, value); list.append(line);
  }
}
function preview() {
  if (currentTab !== 'parameters' || !state) return;
  const p = { ...state.params, ...draft.patch() }, base = state.params;
  const temp = Array.from({ length: 81 }, (_, i) => i - 20), water = Array.from({ length: 51 }, (_, i) => i * 2);
  const curves = (values: number[], mode: 'temperature' | 'water'): Curve[] => [p, base].map((params, i) => ({ name: i ? '当前' : '草稿', color: i ? color.muted : color.plant, dashed: i === 1, unit: ' VU/(格·s)', points: values.map(x => ({ x, y: growthPotential(mode === 'temperature' ? x : params.temperature, mode === 'water' ? x : 100, 100, params.sunlight, params) })) }));
  plots.temperature.update(curves(temp, 'temperature')); plots.water.update(curves(water, 'water'));
}
$('lab-scenario').innerHTML = Object.entries(environmentPresets).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('');
function describeScenario() { $('lab-scenario-description').textContent = environmentPresets[$<HTMLSelectElement>('lab-scenario').value].description; }
$('lab-scenario').onchange = describeScenario; describeScenario();
function clearInvalid() { invalidKeys.clear(); invalidAux.clear(); document.querySelectorAll<HTMLInputElement>('.field-value input').forEach(input => input.setCustomValidity('')); for (const key of keys) showInputError(key, ''); }
$('lab-load').onclick = () => { if (!state) return; clearInvalid(); const p = environmentPresets[$<HTMLSelectElement>('lab-scenario').value]; for (const key of keys) draft.edit(key, p.values[key], state.params); syncFields(); preview(); toast('方案已载入草稿，尚未改变世界'); };
$('restore-defaults').onclick = () => { if (!state) return; clearInvalid(); for (const key of keys) draft.edit(key, environmentDefaults[key], state.params); syncFields(); preview(); };
$('discard-all').onclick = () => { draft.clear(); clearInvalid(); syncFields(); preview(); };
function send(action: 'apply' | 'auth') {
  if (!connected || ws?.readyState !== WebSocket.OPEN || !state) return;
  const id = gate.begin(action); if (!id) return;
  const params = action === 'apply' ? draft.patch() : {};
  const expected = Object.fromEntries(Object.keys(params).map(k => [k, state!.params[k as EnvironmentKey]]));
  ws.send(JSON.stringify({ type: 'configure', requestId: id, token: action === 'auth' ? candidate : token, params, expected })); controls();
  commandTimer = setTimeout(() => { if (!gate.busy) return; gate.cancel(); candidate = ''; toast('操作结果尚未确认，正在重新连接核对', true); ws?.close(); }, 6000);
}
$('apply-all').onclick = () => { const invalid = keys.map(k => $<HTMLInputElement>(`expert-${k}`)).find(el => !el.checkValidity()); if (invalid) { activeGroup = groupFor(invalid.id.replace('expert-', '') as EnvironmentKey); $<HTMLInputElement>('parameter-search').value = ''; filterFields(); invalid.reportValidity(); invalid.focus(); return; } send('apply'); };
$('lab-unlock').onclick = () => { $('lab-auth-error').textContent = ''; $<HTMLDialogElement>('lab-auth').showModal(); $<HTMLInputElement>('lab-token').focus(); };
$('lab-auth-cancel').onclick = () => $<HTMLDialogElement>('lab-auth').close();
$('lab-auth-form').onsubmit = e => { e.preventDefault(); candidate = $<HTMLInputElement>('lab-token').value; send('auth'); };
$('lab-auth').addEventListener('close', () => { candidate = ''; $<HTMLInputElement>('lab-token').value = ''; if (gate.action === 'auth') { gate.cancel(); clearTimeout(commandTimer); controls(); } });
$('lab-lock').onclick = () => { token = ''; draft.clear(); clearInvalid(); syncFields(); preview(); };
function download(name: string, content: string, type: string) { const url = URL.createObjectURL(new Blob([content], { type })), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
$('export-config').onclick = () => { if (!state) return; download('wildhaven-parameters.json', JSON.stringify({ schema: 1, model: 'ABM-02', exportedAt: new Date().toISOString(), tick: state.stats.tick, world: [state.width, state.height], source: draft.dirty ? 'draft' : 'applied', parameters: Object.fromEntries(keys.map(k => [k, parameterValue(k)])) }, null, 2), 'application/json'); toast(draft.dirty ? '已导出草稿参数，未改变世界' : '已导出当前参数'); };
$('import-config').onclick = () => $<HTMLInputElement>('config-file').click();
$<HTMLInputElement>('config-file').onchange = async e => {
  const input = e.target as HTMLInputElement, file = input.files?.[0]; if (!file || !state) return;
  try {
    if (file.size > 65536) throw new Error('参数文件不能超过64KB');
    const data = JSON.parse(await file.text()); if (data.schema !== 1 || data.model !== 'ABM-02' || !data.parameters || typeof data.parameters !== 'object' || Array.isArray(data.parameters)) throw new Error('需要schema=1、model=ABM-02的参数JSON');
    const entries = Object.entries(data.parameters); if (!entries.length) throw new Error('参数文件为空');
    for (const [k, v] of entries) { if (!Object.hasOwn(allParameterSpecs, k)) throw new Error(`未知参数 ${k}`); const spec = allParameterSpecs[k as EnvironmentKey]; if (typeof v !== 'number' || !Number.isFinite(v) || v < spec.min || v > spec.max) throw new Error(`${spec.label} 超出允许范围`); }
    if (!connected || gate.busy || (state.protected && !token)) throw new Error('连接或管理状态已改变，请解锁后重试');
    acceptPatch(Object.fromEntries(entries) as Partial<Environment>); toast(`已导入${entries.length}项到草稿，核对后应用`);
  } catch (error) { toast(error instanceof Error ? error.message : '导入失败', true); } finally { input.value = ''; }
};
$('export-csv').onclick = () => { if (!history.length) return; download('wildhaven-observations.csv', '\uFEFF' + historyCSV(history), 'text/csv;charset=utf-8'); toast('已导出全部保留采样；空白单元格表示未记录'); };
function chooseTab(tab: string) {
  currentTab = tab; for (const name of ['parameters', 'analysis']) { $(`${name}-view`).hidden = name !== tab; $(`${name}-tab`).setAttribute('aria-selected', String(name === tab)); $(`${name}-tab`).tabIndex = name === tab ? 0 : -1; }
  if (tab === 'analysis') analytics(); else preview();
}
for (const name of ['parameters', 'analysis']) { $(`${name}-tab`).onclick = () => chooseTab(name); $(`${name}-tab`).onkeydown = e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const next = name === 'analysis' ? 'parameters' : 'analysis'; chooseTab(next); $(`${next}-tab`).focus(); } }; }
$('history-window').onchange = analytics;
$('population-scale').onclick = () => { plots.population.log = !plots.population.log; $('population-scale').textContent = `${plots.population.log ? '对数' : '线性'}刻度 ⇄`; plots.population.draw(); };
function analytics() {
  if (currentTab !== 'analysis' || !state || document.hidden) return;
  const window = Number($<HTMLSelectElement>('history-window').value), latest = history.at(-1)?.tick ?? 0;
  const h = window === 240 ? history : history.filter(s => s.tick >= latest - window * 25); const s = state.stats;
  const f = (n: number | undefined, digits = 1) => n === undefined ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: digits });
  const indicators = [['当前种群', `${s.grazers + s.hunters}`, '只 · 全世界'], ['平均植被', f(s.plantMean), 'VU / 可栖息格'], ['体内水分', s.grazers + s.hunters ? f(s.meanHydration) : '—', '点 · 全群平均'], ['遗传性状离散度', s.grazers + s.hunters ? f(s.geneSD, 4) : '—', 'σ · 单性状标准差']];
  $('lab-indicators').innerHTML = indicators.map(([label, value, unit]) => `<article><span>${label}</span><strong>${value}</strong><small>${unit}</small></article>`).join('');
  $('sample-window').textContent = `${h.length} 个采样 · ${h.length ? f((h.at(-1)!.tick - h[0].tick) / 5, 0) : 0} 模拟秒 · 通常每5秒 · 全世界统计`;
  const series = (key: keyof Stats, name: string, tint: string, unit = ''): Curve => ({ name, color: tint, unit, points: h.map(s => ({ x: s.tick / 5, y: typeof s[key] === 'number' ? s[key]! : null })) });
  plots.population.update([series('grazers', '兔', color.rabbit, '只'), series('hunters', '狐', color.fox, '只')]);
  plots.resources.update([series('moisture', '水分', color.water), series('nutrients', '养分', color.rabbit), series('plantMean', '平均植被', color.plant, 'VU')]);
  const rates = h.map(s => populationRates(history[history.indexOf(s) - 1], s));
  plots.rates.update([{ name: '出生', color: color.rabbit, unit: '只/分', points: h.map((s, i) => ({ x: s.tick / 5, y: rates[i].births })) }, { name: '死亡', color: color.fox, unit: '只/分', points: h.map((s, i) => ({ x: s.tick / 5, y: rates[i].deaths })) }]);
  plots.phase.update([{ name: '狐', color: color.plant, unit: '只', points: h.map(s => ({ x: s.grazers, y: s.hunters, label: `${s.tick / 5}s · 兔 ${s.grazers}只` })) }]);
  const hydration = series('meanHydration', '体内水分', color.water, '点'), energy = series('energyReserve', '能量储备', color.plant, '%');
  for (let i = 0; i < h.length; i++) if (h[i].grazers + h[i].hunters === 0) { hydration.points[i].y = null; energy.points[i].y = null; }
  plots.physiology.update([hydration, energy]);
  $('life-structure').replaceChildren();
  for (const [name, total, young] of [['原野兔', s.grazers, s.juvenileGrazers], ['赤狐', s.hunters, s.juvenileHunters]] as const) {
    const row = document.createElement('div'); row.className = 'structure-row'; const title = document.createElement('span'); title.textContent = name;
    const bar = document.createElement('div'), child = document.createElement('i'); bar.className = 'structure-bar'; child.style.width = `${total && young !== undefined ? young / total * 100 : 0}%`; bar.append(child);
    const detail = document.createElement('small'); detail.textContent = young === undefined ? '尚无阶段数据' : `幼体 ${young} / 成体 ${total - young}`; row.append(title, bar, detail); $('life-structure').append(row);
  }
  $('gene-summary').textContent = `雌性 ${s.females ?? '—'} · 孕育 ${s.pregnancies ?? '—'} · 基因均值 ${s.grazers + s.hunters ? f(s.meanGenes, 4) : '—'} · 标准差 ${s.grazers + s.hunters ? f(s.geneSD, 4) : '—'}`;
  $('lab-events').replaceChildren(); for (const event of [...state.events].reverse().slice(0, 5)) { const li = document.createElement('li'); li.textContent = `${event.tick / 5}s · ${event.message}`; $('lab-events').append(li); }
}
function disconnected() {
  connected = false; gate.cancel(); candidate = ''; clearTimeout(commandTimer); $('lab-connection').textContent = '● 连接中断'; $('lab-offline').hidden = false; controls();
}
function connect() {
  clearTimeout(reconnectTimer); if (ws && ws.readyState < WebSocket.CLOSING) return;
  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws?mode=lab`); ws = socket;
  socket.onerror = () => socket.close();
  socket.onclose = () => { if (ws !== socket) return; disconnected(); reconnectTimer = setTimeout(connect, Math.min(15000, 1000 * 2 ** Math.min(4, retries++))); };
  socket.onmessage = e => {
    if (ws !== socket) return; lastPacket = Date.now(); const msg = JSON.parse(e.data);
    if (msg.type === 'ack' || msg.type === 'error') {
      const action = gate.finish(msg.requestId); if (!action) return; clearTimeout(commandTimer);
      if (msg.type === 'error') { if (action === 'auth') $('lab-auth-error').textContent = msg.message; else toast(msg.message, true); if (msg.message.includes('口令') && action !== 'auth') token = ''; }
      else { if (action === 'auth') { token = candidate; candidate = ''; $<HTMLDialogElement>('lab-auth').close(); toast('管理权限已解锁'); } else toast('参数已应用到共享世界'); if (state && msg.params) { state.params = msg.params; draft.reconcile(state.params); } }
      syncFields(); preview(); return;
    }
    if (msg.type === 'snapshot') {
      if (state && state.epoch !== msg.epoch) { consoleGestures.cancel(); draft.clear(); clearInvalid(); toast('世界已更新，未应用草稿已清除'); }
      state = msg as LabState; history = [...state.history]; connected = true; retries = 0; $('lab-connection').textContent = '● 已连接 · 共享世界'; $('lab-offline').hidden = true;
    } else if (msg.type === 'delta' && state && state.epoch === msg.epoch) {
      state.params = msg.params; state.stats = msg.stats; state.events = msg.events; state.ecology = msg.ecology;
      for (const s of msg.samples as Stats[]) if (s.tick > (history.at(-1)?.tick ?? -1)) { history.push(s); if (history.length > 240) history.shift(); }
      if (state.events.at(-1)?.tick === state.stats.tick && history.at(-1)?.tick === state.stats.tick) history[history.length - 1] = state.stats;
    } else return;
    draft.reconcile(state!.params); syncFields(); preview(); analytics();
  };
}
$('lab-reconnect').onclick = () => { const old = ws; ws = undefined; old?.close(); disconnected(); retries = 0; connect(); };
window.addEventListener('online', connect); window.addEventListener('offline', () => ws?.close());
window.addEventListener('beforeunload', e => { if (draft.dirty || invalidKeys.size || invalidAux.size) { e.preventDefault(); e.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { preview(); analytics(); } });
setInterval(() => { if (connected && Date.now() - lastPacket > 8000) ws?.close(); }, 2000);
syncFields(); connect();
