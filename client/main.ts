import './appearance';
import './style.css';
import './polish.css';
import type { Snapshot, Delta, Stats, Parameters, Intervention } from '../shared/types';
import { unpackAnimal } from '../shared/protocol';
import { hunger, speciesTraits } from '../shared/species';
import { EnvironmentDraft, PendingCommand, type EnvironmentKey } from './interactions';
import { WorldView } from './map';
import { PopulationChart } from './chart';
import { $ } from './dom';
import { parameterSpecs, environmentPresets, formatParameter } from '../shared/environment';
import { buildEnvironmentPanel, environmentKeys } from './environment-panel';
import { animalSprite, portrait } from './sprites';
import { maturity } from '../shared/model';
import { NaturePanel } from './nature-panel';
import { IdleMonitor } from './idle';
import type { NatureSettings } from '../shared/nature';

buildEnvironmentPanel();

let state: Snapshot | undefined, ws: WebSocket | undefined, token = '', candidateToken = '';
let connected = false, protectedWorld = true, history: Stats[] = [], lastPacket = 0, attempts = 0;
let toastTimer: ReturnType<typeof setTimeout>, reconnectTimer: ReturnType<typeof setTimeout>, commandTimer: ReturnType<typeof setTimeout>;
const pending = new PendingCommand(), draft = new EnvironmentDraft();
const idle = new IdleMonitor(() => ws, () => {
  clearTimeout(reconnectTimer); token = ''; candidateToken = ''; draft.clear();
  $<HTMLInputElement>('token').value = ''; $<HTMLDialogElement>('auth-dialog').close();
  disconnectFeedback(); ws?.close(4001, 'Idle timeout');
  $('connection').textContent = '● 闲置已下线';
  $('sync-message').textContent = '长时间未操作，已自动下线。世界继续演化，点击“重新进入”恢复连接。';
  $('reconnect').textContent = '重新进入';
});
const emptyInspector = $('inspector').innerHTML;
const chart = new PopulationChart($<HTMLCanvasElement>('chart'));
const map = new WorldView($<HTMLCanvasElement>('world'), () => inspect(), () => updateFollow(), requestView);
const naturePanel = new NaturePanel(patch => send('nature', 'nature', undefined, undefined, patch), (x, y) => { map.stopFollowing(); map.nearby(x, y); });
let viewTimer: ReturnType<typeof setTimeout> | undefined, lastViewSignature = '';
function requestView() {
  if (!connected || !state || viewTimer) return;
  viewTimer = setTimeout(() => {
    viewTimer = undefined; if (!connected || !ws || ws.readyState !== WebSocket.OPEN) return;
    const view = map.viewport(), signature = [Math.floor(view.x / 4), Math.floor(view.y / 4), Math.ceil(view.width / 4), Math.ceil(view.height / 4), view.selected].join(':');
    if (signature === lastViewSignature) return; lastViewSignature = signature;
    ws.send(JSON.stringify({ type: 'watch', view }));
  }, 400);
}

function toast(message: string, error = false) {
  $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3500);
}
function showAuth() { $('auth-error').textContent = ''; $<HTMLDialogElement>('auth-dialog').showModal(); $<HTMLInputElement>('token').focus(); }
function controls() {
  const editable = connected && (!protectedWorld || !!token), busy = pending.busy;
  naturePanel.controls(editable && !busy);
  document.querySelectorAll<HTMLButtonElement | HTMLInputElement>('#speeds button,#pause,[data-environment],#reset,#load-preset,[data-intervention],#fire-confirm,#expand,#expand-confirm').forEach(e => e.disabled = !editable || busy);
  if (state && (state.width > 1024 || state.height > 1024)) $<HTMLButtonElement>('expand').disabled = true;
  $<HTMLButtonElement>('apply-env').disabled = !editable || busy || !draft.dirty;
  $<HTMLButtonElement>('discard-env').disabled = busy || !draft.dirty;
  $<HTMLButtonElement>('unlock').disabled = !connected || busy;
  $('unlock').hidden = !protectedWorld || !!token; $('lock').hidden = !protectedWorld || !token;
  $<HTMLButtonElement>('lock').disabled = busy;
  $<HTMLButtonElement>('auth-submit').disabled = !connected || busy;
  $('auth-submit').textContent = pending.action === 'auth' ? '正在验证…' : '解锁控制';
  $<HTMLButtonElement>('reset-confirm').disabled = !editable || busy;
  $<HTMLButtonElement>('reset-cancel').disabled = pending.action === 'reset';
  $('reset-confirm').textContent = pending.action === 'reset' ? '正在重置…' : '确认重置';
  $('expand-confirm').textContent = pending.action === 'expand' ? '正在扩展并保存…' : '扩展疆域';
  $<HTMLButtonElement>('expand-cancel').disabled = pending.action === 'expand';
  $('access-label').textContent = !connected ? '未连接' : editable ? '可管理' : '只读观察';
  $('command-status').textContent = busy ? '正在等待服务器确认…' : !connected ? '连接恢复后可继续操作' : !editable ? '观察无需口令 · 解锁后可调整世界' : '暂停与倍速会同步影响所有访客';
  $('env-status').textContent = draft.dirty ? '有未应用的修改' : '已与服务器同步';
  $('env-status').classList.toggle('dirty', draft.dirty);
  if (state) $('pause').textContent = pending.action === 'pause' ? '正在同步…' : state.params.paused ? '▶ 继续演化' : 'Ⅱ 暂停世界';
}
function send(type: 'configure' | 'reset' | 'intervene' | 'expand' | 'nature', action: string, params?: Partial<Parameters>, intervention?: Intervention, nature?: Partial<NatureSettings>) {
  if (!connected || !ws || ws.readyState !== WebSocket.OPEN) { toast('连接恢复后即可操作', true); return; }
  if (protectedWorld && !token && action !== 'auth') { showAuth(); return; }
  const requestId = pending.begin(action); if (!requestId) return;
  controls();
  ws.send(JSON.stringify({ type, requestId, params, intervention, nature, token: action === 'auth' ? candidateToken : token }));
  commandTimer = setTimeout(() => {
    if (!pending.busy) return;
    pending.cancel(); candidateToken = ''; toast('操作结果尚未确认，正在重新连接核对状态', true); ws?.close();
  }, 6000);
}
function disconnectFeedback() {
  connected = false; clearTimeout(commandTimer);
  const action = pending.action; pending.cancel(); candidateToken = '';
  $('connection').textContent = '● 连接中断'; $('connection').classList.add('offline');
  $('sync-banner').hidden = false;
  $('sync-message').textContent = state ? '连接中断：当前显示最后同步的画面，正在自动重连。' : '暂时无法连接服务器，正在重试。';
  if (action === 'auth') $('auth-error').textContent = '连接已中断，请在恢复后重新验证。';
  if (action === 'reset') $('reset-error').textContent = '结果尚未确认，重连后请先查看世界状态。';
  if (!state) $('map-empty').querySelector('small')!.textContent = '请检查服务是否运行，或点击上方立即重连';
  if (state) naturePanel.update(state, false); updateStatus(); controls();
}
function connect() {
  clearTimeout(reconnectTimer);
  if (!idle.check()) return;
  if (!navigator.onLine) { disconnectFeedback(); return; }
  if (ws && ws.readyState < WebSocket.CLOSING) return;
  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`); ws = socket;
  $('connection').textContent = '● 正在同步';
  socket.onclose = event => {
    if (ws !== socket) return;
    if (event.code === 4001) idle.stop();
    if (!idle.check()) return;
    disconnectFeedback();
    reconnectTimer = setTimeout(connect, Math.min(15000, 1500 * 2 ** Math.min(attempts++, 3)) + Math.random() * 500);
  };
  socket.onerror = () => socket.close();
  socket.onmessage = event => {
    if (ws !== socket) return;
    lastPacket = Date.now();
    const msg = JSON.parse(event.data);
    if (msg.type === 'snapshot') idle.configure(msg.idleTimeoutMs);
    if (!idle.check()) return;
    if (msg.type === 'error' || msg.type === 'ack') {
      const action = pending.finish(msg.requestId); if (!action) return;
      clearTimeout(commandTimer);
      if (msg.type === 'error') {
        if (action === 'auth') { candidateToken = ''; $('auth-error').textContent = msg.message; $<HTMLInputElement>('token').focus(); }
        else { if (msg.message.includes('口令')) token = ''; if (action === 'reset') $('reset-error').textContent = msg.message; toast(msg.message, true); }
      } else {
        if (state && msg.params) { state.params = msg.params; draft.reconcile(state.params); }
        if (action === 'auth') { token = candidateToken; candidateToken = ''; $<HTMLInputElement>('token').value = ''; $<HTMLDialogElement>('auth-dialog').close(); toast('管理权限已解锁'); }
        else if (action === 'reset') { $<HTMLDialogElement>('reset-dialog').close(); toast('世界已重置，新的演化开始了'); }
        else if (action === 'expand') { $<HTMLDialogElement>('expand-dialog').close(); toast(msg.message); }
        else if (action === 'intervention' || action === 'nature') toast(msg.message);
        else toast(action === 'environment' ? '环境参数已应用到共享世界' : action === 'pause' ? state?.params.paused ? '共享世界已暂停' : '共享世界已继续演化' : `模拟速度已切换为 ${state?.params.speed}×`);
      }
      updateStats(); controls(); return;
    }
    if (msg.animals) msg.animals = msg.animals.map(unpackAnimal);
    if (msg.type === 'snapshot') {
      const changedWorld = !!state && state.epoch !== msg.epoch;
      state = msg as Snapshot; protectedWorld = state.protected; history = [...state.history]; lastViewSignature = '';
      if (changedWorld) { draft.clear(); $('inspector').innerHTML = emptyInspector; toast('共享世界已更新，观察记录已同步'); }
      connected = true; attempts = 0;
      $('connection').textContent = '● 已连接 · 共享世界'; $('connection').classList.remove('offline'); $('sync-banner').hidden = true;
      $('world-size').textContent = `${state.width} × ${state.height}`;
      $('map-empty').classList.add('hidden'); map.update(state); chart.update(history);
    } else if (msg.type === 'delta' && state && msg.epoch === state.epoch) {
      const delta = msg as Delta;
      const interventionChanged = state.events?.at(-1)?.id !== delta.events?.at(-1)?.id;
      for (const [i, value] of delta.plants) state.plants[i] = value;
      state.animals = delta.animals; state.params = delta.params; state.stats = delta.stats; state.events = delta.events;
      state.tiles = delta.tiles; state.ecology = delta.ecology; state.view = delta.view; state.density = delta.density;
      if (delta.overview) state.overview = delta.overview;
      for (const sample of delta.samples) if (sample.tick > (history.at(-1)?.tick ?? -1)) { history.push(sample); if (history.length > 240) history.shift(); }
      if (interventionChanged) {
        if (history.at(-1)?.tick === delta.stats.tick) history[history.length - 1] = delta.stats;
        else { history.push(delta.stats); if (history.length > 240) history.shift(); }
      }
      map.update(state, true); if (delta.samples.length || interventionChanged) chart.update(history);
    } else return;
    if (state) { draft.reconcile(state.params); updateStats(); inspect(); updateJournal(); controls(); requestView(); }
  };
}
function reconnectNow() {
  clearTimeout(reconnectTimer);
  if (!idle.check()) return;
  const old = ws; ws = undefined; old?.close();
  disconnectFeedback(); attempts = 0; connect();
}
function updateStatus() {
  const status = !connected ? state ? '连接中断 · 最后同步画面' : '等待世界同步' : state?.params.paused ? '世界已暂停' : `${state?.params.speed ?? 1}× 自主演化中`;
  $('map-status').textContent = status;
  $('map-badge').classList.toggle('is-paused', !!state?.params.paused || !connected);
  $('live-dot').classList.toggle('is-paused', !!state?.params.paused || !connected);
}
function updateEnvironment() {
  if (!state) return;
  for (const key of environmentKeys) {
    const value = draft.value(key, state.params), spec = parameterSpecs[key]; $<HTMLInputElement>(key).value = String(value); $(`${key}-value`).textContent = formatParameter(key, value);
    $<HTMLInputElement>(key).style.setProperty('--range-progress', `${(value - spec.min) / (spec.max - spec.min) * 100}%`);
  }
}
function updateStats() {
  if (!state) return; const s = state.stats;
  for (const key of ['plants', 'grazers', 'hunters', 'births'] as const) {
    $(key).textContent = s[key].toLocaleString(); $(key).classList.toggle('large-number', s[key] >= 1000000);
  }
  $('deaths').textContent = `累计死亡 ${s.deaths.toLocaleString()}`;
  const seconds = s.tick / 5, climate = state.ecology, day = climate.day;
  $('day').textContent = `DAY ${String(day).padStart(3, '0')}`;
  $('clock').textContent = `${String(Math.floor(climate.hour)).padStart(2, '0')}:00 · ${climate.season} · ${climate.daylight > .1 ? '白昼' : '夜间'}`;
  $('actual-weather').textContent = `${climate.temperature.toFixed(1)}°C · 光照 ${Math.round(climate.daylight * state.params.sunlight * 100)}%`;
  $('soil-status').textContent = `储水 ${Math.round(climate.moisture)}% · 养分 ${Math.round(climate.nutrients)}%`;
  $('life-status').textContent = `幼体 ${climate.juveniles} · 孕育 ${climate.pregnancies}`;
  $('region-status').textContent = `${climate.activeRegions} 活跃分区 · ${state.width * state.height >= 1000000 ? (state.width * state.height / 1000000).toFixed(2) + 'M' : (state.width * state.height / 1000).toFixed(1) + 'k'} 格`;
  $('speed-label').textContent = `${state.params.speed}×`;
  document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach(b => { const active = Number(b.dataset.speed) === state!.params.speed; b.classList.toggle('selected', active); b.setAttribute('aria-pressed', String(active)); });
  $('note').textContent = s.grazers + s.hunters === 0 ? '动物已全部消失。试试补种植被、投放兔群，再引入少量赤狐，重建食物链。' : state.params.temperature < 0 ? '低温正抑制植被恢复，也增加了动物的能量消耗。观察冬季资源如何传递到种群。' : state.params.rain < .5 ? '旱季来临。可尝试降低繁殖或代谢，为种群争取恢复时间。' : s.hunters === 0 ? '捕食者已消失。投放少量赤狐可重新施加捕食压力，或继续观察兔群与植被的博弈。' : '调整物种策略，或者引发一场局部干扰。尝试在不重置的情况下维持完整食物链。';
  naturePanel.update(state, connected); updateEnvironment(); updateStatus();
}
let journalSignature = '';
function updateJournal() {
  const events = state?.events ?? [], signature = `${state?.epoch}:${events.at(-1)?.id ?? 0}`;
  if (signature === journalSignature) return; journalSignature = signature;
  $('event-empty').hidden = events.length > 0; $('event-list').replaceChildren();
  for (const event of [...events].reverse()) { const li = document.createElement('li'), time = document.createElement('span'), text = document.createElement('p'); time.textContent = `${Math.floor(event.tick / 5)}s`; text.textContent = event.message; li.append(time, text); $('event-list').append(li); }
}
let inspectorId = -1, reportedDeath = 0;
function updateFollow() {
  $('follow').textContent = map.following ? '◎ 正在跟随 · 点击停止' : '◎ 跟随个体'; $('follow').setAttribute('aria-pressed', String(map.following));
}
function inspect() {
  const selected = map.selected, animal = state?.animals.find(a => a.id === selected);
  $('selection-hud').hidden = !selected || !animal;
  $('inspector-actions').hidden = !selected;
  $('inspector-tag').textContent = animal ? '个体观察' : selected ? '生命已结束' : '未选择个体';
  if (!selected) {
    if (inspectorId !== 0) $('inspector').innerHTML = emptyInspector;
    inspectorId = 0; updateFollow(); return;
  }
  if (!animal) {
    if (inspectorId !== -selected) $('inspector').innerHTML = '<div class="specimen">⌁</div><h3>这段生命旅程已结束</h3><p>它的能量已回到原野。<br>你可以选择另一只动物继续观察。</p><button id="discover">观察另一只 ↗</button>';
    inspectorId = -selected;
    if (reportedDeath !== selected) { reportedDeath = selected; toast(`观察个体 #${selected} 的生命已结束`); }
    $<HTMLButtonElement>('follow').disabled = true; updateFollow(); return;
  }
  $<HTMLButtonElement>('follow').disabled = false;
  $('selection-name').textContent = `${speciesTraits[animal.species].label} #${animal.id} · ${animal.action}`;
  if (inspectorId !== selected) {
    $('inspector').innerHTML = '<div class="animal-head"><img class="animal-portrait" id="animal-portrait" alt=""><strong id="animal-name"></strong><span id="animal-action"></span></div><div class="animal-stat"><span>能量</span><span id="animal-energy"></span></div><div class="bar"><i id="energy-bar"></i></div><div class="animal-stat"><span>体力</span><span id="animal-stamina"></span></div><div class="bar"><i id="stamina-bar"></i></div><div class="animal-details"><div><span>饥饿 / 水分</span><strong id="animal-hunger"></strong></div><div><span>年龄 / 阶段</span><strong id="animal-age"></strong></div><div><span>性别 / 孕期</span><strong id="animal-family"></strong></div><div><span>母体</span><strong id="animal-mother"></strong></div><div><span>速度基因</span><strong id="animal-genes"></strong></div><div><span>坐标</span><strong id="animal-position"></strong></div></div>';
    $<HTMLImageElement>('animal-portrait').src = portrait(animal.species);
    inspectorId = selected;
  }
  const traits = speciesTraits[animal.species];
  $('animal-name').textContent = `${traits.label} #${animal.id}`; $('animal-action').textContent = animal.action;
  $('animal-energy').textContent = `${Math.round(animal.energy)} / ${traits.capacity}`; $('animal-stamina').textContent = `${Math.round(animal.stamina)} / 100`;
  $('energy-bar').style.width = `${Math.min(100, animal.energy / traits.capacity * 100)}%`; $('stamina-bar').style.width = `${animal.stamina}%`;
  $('animal-hunger').textContent = `${Math.round(hunger(animal))}% / ${Math.round(animal.hydration)}%`; $('animal-age').textContent = `${animal.age.toFixed(0)}s · ${animal.age < maturity(animal.species, state!.params) ? '幼体' : '成体'}`;
  $('animal-family').textContent = `${animal.sex === 'female' ? '♀ 雌性' : '♂ 雄性'}${animal.gestation > 0 ? ` · 余 ${Math.ceil(animal.gestation)}s` : ''}`;
  $('animal-mother').textContent = animal.motherId ? `#${animal.motherId}` : '初始 / 投放个体';
  $('animal-genes').textContent = `${animal.genes.toFixed(3)}×`; $('animal-position').textContent = `${animal.x.toFixed(1)}, ${animal.y.toFixed(1)}`;
  updateFollow();
}
// Observation controls never send simulation commands.
document.querySelectorAll<HTMLButtonElement>('[data-layer]').forEach(b => b.onclick = () => { const key = b.dataset.layer as keyof WorldView['layers']; map.setLayer(key, !map.layers[key]); b.setAttribute('aria-pressed', String(map.layers[key])); });
$('grid').onclick = () => { map.grid = !map.grid; $('grid').setAttribute('aria-pressed', String(map.grid)); };
$<HTMLSelectElement>('soil-overlay').onchange = () => map.setOverlay($<HTMLSelectElement>('soil-overlay').value as WorldView['overlay']);
$('zoom-in').onclick = () => map.zoom(1.3); $('zoom-out').onclick = () => map.zoom(1 / 1.3); $('fit').onclick = () => map.fit();
$('follow').onclick = () => map.follow(); $('clear-selection').onclick = () => map.select(0);
$('view-inspector').onclick = () => $('inspector-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
$('inspector').onclick = e => { if ((e.target as Element).closest('#discover')) {
  if (!state?.animals.length) { toast('当前没有可观察的动物'); return; }
  const candidates = state.animals.filter(a => map.layers[a.species]);
  if (!candidates.length) { toast('先开启一个动物图层再观察'); return; }
  const animal = candidates[Math.floor(Math.random() * candidates.length)]; map.select(animal.id); map.follow();
  $('world-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
} };
$('fullscreen').onclick = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('world-panel').requestFullscreen(); } catch { toast('当前浏览器暂不支持全屏观察'); } };
document.addEventListener('fullscreenchange', () => { $('fullscreen').textContent = document.fullscreenElement ? '⊡' : '⛶'; $('fullscreen').setAttribute('aria-label', document.fullscreenElement ? '退出全屏' : '全屏观察'); });
const showHelp = () => $<HTMLDialogElement>('help-dialog').showModal();
$('help').onclick = showHelp; $('footer-help').onclick = showHelp; $('help-close').onclick = () => $<HTMLDialogElement>('help-dialog').close();
document.addEventListener('keydown', e => {
  if (document.querySelector('dialog[open]') || (e.target as HTMLElement).closest('input,textarea,select,button,a,[contenteditable="true"]')) return;
  if (e.code === 'Space') { e.preventDefault(); if (connected && (!protectedWorld || token)) send('configure', 'pause', { paused: !state?.params.paused }); }
  else if (e.key === '+' || e.key === '=') map.zoom(1.3);
  else if (e.key === '-') map.zoom(1 / 1.3);
  else if (e.key === '0') map.fit();
  else if (e.key.toLowerCase() === 'f') map.follow();
  else if (e.key === 'Escape') map.select(0);
  else if (e.key === '?') showHelp();
});
$('pause').onclick = () => send('configure', 'pause', { paused: !state?.params.paused });
document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach(b => b.onclick = () => send('configure', 'speed', { speed: Number(b.dataset.speed) }));
for (const key of environmentKeys) $<HTMLInputElement>(key).oninput = () => { if (!state) return; draft.edit(key, Number($<HTMLInputElement>(key).value), state.params); updateEnvironment(); controls(); };
$('load-preset').onclick = () => { if (!state) return; const preset = environmentPresets[$<HTMLSelectElement>('scenario').value]; for (const key of environmentKeys) draft.edit(key, preset.values[key], state.params); updateEnvironment(); controls(); toast(`已载入「${preset.label}」，点击应用环境后生效`); };
document.querySelectorAll<HTMLButtonElement>('[data-intervention]').forEach(b => b.onclick = () => { const kind = b.dataset.intervention as Intervention; if (kind === 'fire') $<HTMLDialogElement>('fire-dialog').showModal(); else send('intervene', 'intervention', undefined, kind); });
$('fire-cancel').onclick = () => $<HTMLDialogElement>('fire-dialog').close();
$('fire-confirm').onclick = () => { $<HTMLDialogElement>('fire-dialog').close(); send('intervene', 'intervention', undefined, 'fire'); };
$('expand').onclick = () => { if (!state) return; $('expand-summary').textContent = `${state.width} × ${state.height} → ${state.width * 2} × ${state.height * 2}，面积扩大 4 倍。原有动物、时间、栖息地和历史保留；新区域使用相同种子生成。`; $<HTMLDialogElement>('expand-dialog').showModal(); };
$('expand-cancel').onclick = () => $<HTMLDialogElement>('expand-dialog').close();
$('expand-confirm').onclick = () => send('expand', 'expand');
$('expand-dialog').addEventListener('cancel', e => { if (pending.action === 'expand') e.preventDefault(); });
$('apply-env').onclick = () => send('configure', 'environment', draft.patch());
$('discard-env').onclick = () => { draft.clear(); updateEnvironment(); controls(); };
$('unlock').onclick = showAuth;
$('lock').onclick = () => { token = ''; draft.clear(); updateEnvironment(); controls(); toast('已退出管理，可继续自由观察'); };
$('auth-cancel').onclick = () => $<HTMLDialogElement>('auth-dialog').close();
$('auth-dialog').addEventListener('close', () => { if (pending.action === 'auth') { pending.cancel(); clearTimeout(commandTimer); } candidateToken = ''; $<HTMLInputElement>('token').value = ''; controls(); });
$('auth-form').onsubmit = e => { e.preventDefault(); candidateToken = $<HTMLInputElement>('token').value; $('auth-error').textContent = ''; send('configure', 'auth', {}); };
$('reset').onclick = () => { if (!state) return; $('reset-error').textContent = ''; $('reset-summary').textContent = `当前第 ${Math.floor(state.stats.tick / 600) + 1} 天 · ${state.stats.grazers + state.stats.hunters} 只动物 · ${draft.dirty ? '未应用的参数修改也将清除' : '重置后恢复默认环境与 1× 速度'}`; $<HTMLDialogElement>('reset-dialog').showModal(); };
$('reset-cancel').onclick = () => $<HTMLDialogElement>('reset-dialog').close();
$('reset-dialog').addEventListener('cancel', e => { if (pending.action === 'reset') e.preventDefault(); });
$('reset-confirm').onclick = () => send('reset', 'reset');
$('reconnect').onclick = () => { idle.resume(); $('reconnect').textContent = '立即重连'; reconnectNow(); };
window.addEventListener('online', reconnectNow);
window.addEventListener('offline', () => { if (!idle.check()) return; disconnectFeedback(); ws?.close(); });
window.addEventListener('beforeunload', e => { if (draft.dirty) { e.preventDefault(); e.returnValue = ''; } });
setInterval(() => { if (connected && Date.now() - lastPacket > 8000) { disconnectFeedback(); ws?.close(); } }, 2000);
for (const species of ['grazer', 'hunter'] as const) {
  const icon = document.createElement('img'); icon.src = portrait(species); icon.alt = species === 'grazer' ? '原野兔' : '赤狐'; icon.className = 'species-icon';
  document.querySelector(`[data-layer="${species}"] .dot`)?.replaceWith(icon);
}
setInterval(() => { if (document.hidden) return; for (const canvas of document.querySelectorAll<HTMLCanvasElement>('.species-preview')) { const c = canvas.getContext('2d')!; c.clearRect(0, 0, 64, 64); c.imageSmoothingEnabled = false; c.drawImage(animalSprite(canvas.dataset.species as 'grazer' | 'hunter', 'walk', Math.floor((state?.stats.tick ?? 0) / 2) % 4), 0, 0, 64, 64); } }, 200);
controls(); connect();
