import { parameterSpecs, environmentPresets, type QuickParameterKey } from '../shared/environment';
import { $ } from './dom';
export const environmentKeys = Object.keys(parameterSpecs) as QuickParameterKey[];
export function buildEnvironmentPanel() {
  const groups = [...new Set(environmentKeys.map(key => parameterSpecs[key].group))];
  $('parameter-tabs').innerHTML = groups.map((group, i) => `<button role="tab" id="parameter-tab-${i}" aria-controls="parameter-group-${i}" aria-selected="${i === 0}" data-parameter-tab="${i}">${group.split('与')[0]} <small>${environmentKeys.filter(key => parameterSpecs[key].group === group).length}</small></button>`).join('');
  $('parameter-fields').innerHTML = groups.map((group, i) => `<section role="tabpanel" aria-labelledby="parameter-tab-${i}" id="parameter-group-${i}" ${i ? 'hidden' : ''}>${environmentKeys.filter(key => parameterSpecs[key].group === group).map(key => {
    const s = parameterSpecs[key];
    return `<div class="parameter-field"><label class="slider-label" for="${key}">${s.label}<output id="${key}-value"></output></label><input id="${key}" data-environment="${key}" type="range" min="${s.min}" max="${s.max}" step="any" value="${s.default}" aria-describedby="${key}-hint"><p class="sr-only" id="${key}-hint">${s.hint}</p></div>`;
  }).join('')}</section>`).join('');
  $('scenario').innerHTML = Object.entries(environmentPresets).map(([key, s]) => `<option value="${key}">${s.label}</option>`).join('');
  const describe = () => $('preset-description').textContent = environmentPresets[$<HTMLSelectElement>('scenario').value].description;
  $<HTMLSelectElement>('scenario').onchange = describe; describe();
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-parameter-tab]')];
  const activate = (index: number) => tabs.forEach((tab, i) => { tab.setAttribute('aria-selected', String(i === index)); tab.tabIndex = i === index ? 0 : -1; $(`parameter-group-${i}`).hidden = i !== index; });
  tabs.forEach((tab, index) => { tab.onclick = () => activate(index); tab.onkeydown = e => { if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; e.preventDefault(); const next = (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length; activate(next); tabs[next].focus(); }; });
  activate(0);
}
