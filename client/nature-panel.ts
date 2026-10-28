import { weatherSpecs, type NatureSettings } from '../shared/nature';
import type { Snapshot } from '../shared/types';
import { $ } from './dom';
import './nature.css';

const names = { weather: '动态天气', disasters: '自然山火', migration: '边界迁入' } as const;
const duration = (ticks: number) => { const seconds = Math.max(0, Math.ceil(ticks / 5)); return `${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, '0')}秒`; };
export class NaturePanel {
  private signature = '';
  constructor(change: (patch: Partial<NatureSettings>) => void, locate: (x: number, y: number) => void) {
    $('nature-switches').innerHTML = Object.entries(names).map(([key, label]) => `<button type="button" role="switch" aria-checked="false" data-nature="${key}" disabled><i></i>${label}<span>同步中</span></button>`).join('');
    document.querySelectorAll<HTMLButtonElement>('[data-nature]').forEach(button => button.onclick = () => change({ [button.dataset.nature!]: button.getAttribute('aria-checked') !== 'true' }));
    $('nature-sightings').addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-x]');
      if (button) { locate(Number(button.dataset.x), Number(button.dataset.y)); $('world-panel').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' }); }
    });
  }
  controls(editable: boolean) { document.querySelectorAll<HTMLButtonElement>('[data-nature]').forEach(button => button.disabled = !editable); }
  update(state: Snapshot, connected: boolean) {
    const ecology = state.ecology, settings = ecology.nature, weather = ecology.weather, tick = state.stats.tick;
    const enabled = settings?.weather ?? false, kind = enabled && weather ? weather.kind : 'clear', spec = weatherSpecs[kind];
    $('nature-panel').dataset.weather = kind;
    $('weather-icon').textContent = spec.icon; $('weather-title').textContent = enabled ? spec.label : '季节背景气候';
    $('weather-effect').textContent = enabled ? spec.effect : '动态天气已关闭，季节和昼夜仍会影响原野。';
    $('weather-phase').textContent = !connected ? '离线 · 最后同步' : state.params.paused ? '世界暂停 · 预报冻结' : 'SIMULATION WEATHER / 实时天气';
    $('weather-remaining').textContent = !enabled || !weather ? '—' : kind === 'clear' ? `${duration(weather.nextTick - tick)}后变化` : `余 ${duration(weather.end - tick)}`;
    const fraction = enabled && weather && kind !== 'clear' ? Math.max(0, Math.min(1, (tick - weather.start) / (weather.end - weather.start))) : 0;
    $<HTMLProgressElement>('weather-progress').value = fraction;
    $('weather-next').textContent = enabled && weather ? `${weatherSpecs[weather.nextKind].icon} ${weatherSpecs[weather.nextKind].label}` : '天气过程已关闭';
    $('weather-next-time').textContent = enabled && weather ? `约 ${duration(weather.nextTick - tick)}后抵达` : '可在下方重新开启';
    $('weather-temperature').textContent = `${ecology.temperature.toFixed(1)}°C`;
    $('weather-rain').textContent = `${ecology.rain.toFixed(2)}×`;
    const risk = Math.round((ecology.fireRisk ?? 0) * 100);
    $('fire-risk').textContent = settings?.disasters ? `${risk < 20 ? '低' : risk < 55 ? '中' : '高'} · ${risk}` : '已关闭';
    $<HTMLMeterElement>('fire-risk-meter').value = risk;
    $('fire-risk-note').textContent = '火险指数，非发生概率 · 取决于干燥程度、温度与植被';
    document.querySelectorAll<HTMLButtonElement>('[data-nature]').forEach(button => {
      const on = settings?.[button.dataset.nature as keyof NatureSettings] ?? false;
      button.setAttribute('aria-checked', String(on)); button.querySelector('span')!.textContent = on ? '开启' : '关闭';
    });
    const events = state.events.filter(e => ['weather', 'wildfire', 'migration'].includes(e.kind)), signature = `${state.epoch}:${events.map(e => e.id).join(',')}`;
    if (signature === this.signature) return; this.signature = signature;
    const list = $('nature-sightings'); list.replaceChildren();
    if (!events.length) { const empty = document.createElement('p'); empty.className = 'nature-empty'; empty.textContent = '留意边界的新访客，也留意下一阵风。自然事件会在这里留下记录。'; list.append(empty); }
    for (const event of events.slice(-3).reverse()) {
      const row = document.createElement('div'), time = document.createElement('span'), text = document.createElement('p');
      row.className = 'nature-sighting'; time.textContent = `${Math.floor(event.tick / 5)}s`; text.textContent = event.message; row.append(time, text);
      if (event.x !== undefined && event.y !== undefined) { const button = document.createElement('button'); button.textContent = '定位 ↗'; button.dataset.x = String(event.x); button.dataset.y = String(event.y); button.setAttribute('aria-label', `定位：${event.message}`); row.append(button); }
      list.append(row);
    }
  }
}
