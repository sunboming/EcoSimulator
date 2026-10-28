import type { Stats } from './types.js';
export function populationRates(before: Stats | undefined, after: Stats) {
  if (!before || after.tick <= before.tick || after.births < before.births || after.deaths < before.deaths) return { births: null, deaths: null, growth: null };
  const minutes = (after.tick - before.tick) / 300, n0 = before.grazers + before.hunters, n1 = after.grazers + after.hunters;
  return { births: (after.births - before.births) / minutes, deaths: (after.deaths - before.deaths) / minutes, growth: n0 > 0 && n1 > 0 ? Math.log(n1 / n0) / minutes : null };
}
export function historyCSV(history: Stats[]) {
  const keys: (keyof Stats)[] = ['tick', 'grazers', 'hunters', 'plants', 'births', 'deaths', 'moisture', 'nutrients', 'detritus', 'plantMean', 'landCells', 'meanEnergy', 'energyReserve', 'meanHydration', 'meanGenes', 'geneSD', 'juveniles', 'juvenileGrazers', 'juvenileHunters', 'pregnancies', 'females', 'temperature'];
  const populationMeans = new Set(['meanEnergy', 'energyReserve', 'meanHydration', 'meanGenes', 'geneSD']);
  return 'simulation_seconds,' + keys.join(',') + '\n' + history.map(s => [s.tick / 5, ...keys.map(k => s[k] === undefined || (s.grazers + s.hunters === 0 && populationMeans.has(k)) ? '' : s[k])].join(',')).join('\n');
}
