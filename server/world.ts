import type { Animal, Parameters, SaveState, Stats, WorldEvent, Intervention, Ecology } from '../shared/types.js';
import { speciesTraits } from '../shared/species.js';
import { environmentDefaults, allParameterSpecs as parameterSpecs, type EnvironmentKey } from '../shared/environment.js';
import { maturity, gestation, lifespan } from '../shared/model.js';
import { Habitat, MAX_WORLD, decode, encode } from './habitat.js';
import { natureDefaults, validateNature, naturalClimateAt, weatherAt, weatherSpecs, naturalHash, type NatureSettings } from '../shared/nature.js';

export class World {
  habitat: Habitat;
  animals: Animal[] = []; tick = 0; nextId = 1; births = 0; deaths = 0; history: Stats[] = [];
  params: Parameters = { paused: false, speed: 1, ...environmentDefaults };
  events: WorldEvent[] = []; focus: { x: number; y: number };
  nature: NatureSettings = { ...natureDefaults };
  private random: number;
  get terrain() { return this.habitat.terrain as unknown as number[]; }
  get plants() { return this.habitat.plants; }
  constructor(public width = 512, public height = 384, public seed = 42, public maxAnimals = 1200) {
    if (![width, height].every(n => Number.isInteger(n) && n >= 24 && n <= MAX_WORLD) ||
      !Number.isInteger(maxAnimals) || maxAnimals < 20 || maxAnimals > 5000 ||
      !Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new Error('世界规模或种群上限无效');
    this.random = seed >>> 0; this.focus = { x: width / 2, y: height / 2 };
    this.habitat = new Habitat(width, height, seed);
    this.habitat.weatherSeed = seed;
    for (let i = 0; i < Math.min(110, Math.floor(maxAnimals * .65)); i++) this.spawn(i % 9 === 0 ? 'hunter' : 'grazer');
    this.history.push(this.stats());
  }
  private rand() { this.random = (Math.imul(this.random, 1664525) + 1013904223) >>> 0; return this.random / 4294967296; }
  private spawn(species: Animal['species'], parent?: Animal, center = this.focus, exact = false) {
    if (this.animals.length >= this.maxAnimals) return;
    let x = parent?.x ?? 0, y = parent?.y ?? 0;
    if (!parent && exact) { x = center.x; y = center.y; if (!this.land(x, y)) return; }
    else if (!parent) {
      let attempts = 0;
      do { x = Math.max(0, Math.min(this.width - .01, center.x + (this.rand() - .5) * Math.min(96, this.width))); y = Math.max(0, Math.min(this.height - .01, center.y + (this.rand() - .5) * Math.min(64, this.height))); } while (!this.land(x, y) && ++attempts < 1000);
      if (!this.land(x, y)) return;
    }
    this.animals.push({ id: this.nextId++, species, x, y, energy: parent ? 28 : 70 + this.rand() * 30, stamina: 100,
      age: parent ? 0 : maturity(species, this.params), genes: parent ? Math.max(.7, Math.min(1.4, (parent.genes + (parent.mateGenes ?? parent.genes)) / 2 + (this.rand() - .5) * .1 * this.params.mutation)) : .9 + this.rand() * .2,
      heading: this.rand() * Math.PI * 2, cooldown: 80, action: '探索', hydration: parent ? 75 : 100,
      sex: this.rand() < .5 ? 'female' : 'male', gestation: 0, ...(parent ? { motherId: parent.id } : {}) });
  }
  private land(x: number, y: number) { return x >= 0 && y >= 0 && x < this.width && y < this.height && this.habitat.terrain[Math.floor(y) * this.width + Math.floor(x)] === 1; }
  configure(input: Partial<Parameters>) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('参数必须是对象');
    for (const [key, value] of Object.entries(input)) {
      if (key === 'paused') { if (typeof value !== 'boolean') throw new Error('paused 必须是布尔值'); }
      else {
        const spec = Object.hasOwn(parameterSpecs, key) ? parameterSpecs[key as EnvironmentKey] : undefined;
        const range = key === 'speed' ? [.25, 8] : spec ? [spec.min, spec.max] : undefined;
        if (!range || typeof value !== 'number' || !Number.isFinite(value) || value < range[0] || value > range[1]) throw new Error(`无效参数: ${key}`);
      }
    }
    // Finish the previous weather interval before applying new forcing parameters.
    const changed = (Object.keys(input) as (keyof Parameters)[]).filter(key => key !== 'speed' && key !== 'paused' && input[key] !== this.params[key]);
    if (changed.length) this.habitat.flush(this.tick, this.params);
    Object.assign(this.params, input);
    if (changed.length) { this.record('configure', `环境参数更新 · ${changed.length} 项 · ${changed.slice(0, 3).map(key => parameterSpecs[key as EnvironmentKey].label).join(' / ')}`); this.sample(); }
  }
  configureNature(input: Partial<NatureSettings>) {
    validateNature(input);
    if (input.weather !== undefined && input.weather !== this.nature.weather) this.habitat.flush(this.tick, this.params);
    Object.assign(this.nature, input); this.habitat.weatherSeed = this.nature.weather ? this.seed : undefined;
    this.record('nature', `自然演变设置 · 天气${this.nature.weather ? '开' : '关'} / 山火${this.nature.disasters ? '开' : '关'} / 迁入${this.nature.migration ? '开' : '关'}`);
  }
  expand() {
    if (this.width * 2 > MAX_WORLD || this.height * 2 > MAX_WORLD) throw new Error(`世界边长最多 ${MAX_WORLD} 格`);
    this.habitat.flush(this.tick, this.params);
    this.habitat = this.habitat.expanded(this.seed, this.tick); this.width *= 2; this.height *= 2;
    this.habitat.weatherSeed = this.nature.weather ? this.seed : undefined;
    this.record('seed', `疆域扩展至 ${this.width} × ${this.height} · 原有生命与栖息地保留`);
    this.sample();
  }
  private record(kind: WorldEvent['kind'], message: string, location: Partial<WorldEvent> = {}) {
    const event: WorldEvent = { id: (this.events.at(-1)?.id ?? 0) + 1, tick: this.tick, kind, message, ...location };
    this.events.push(event); if (this.events.length > 12) this.events.shift(); return event;
  }
  private sample() { const stats = this.stats(); if (this.history.at(-1)?.tick === this.tick) this.history[this.history.length - 1] = stats; else { this.history.push(stats); if (this.history.length > 240) this.history.shift(); } }
  intervene(kind: Intervention, center = this.focus, natural = false) {
    if (!['seed', 'grazers', 'hunters', 'fire'].includes(kind)) throw new Error('未知生态干预');
    if (![center.x, center.y].every(Number.isFinite) || center.x < 0 || center.x >= this.width || center.y < 0 || center.y >= this.height) throw new Error('干预位置无效');
    let message = '', location: Partial<WorldEvent> = {};
    if (kind === 'seed') {
      let added = 0; const plants = this.habitat.rawPlants;
      for (let i = 0; i < plants.length; i++) if (this.habitat.terrain[i] === 1) { const before = plants[i]; plants[i] = Math.round(Math.min(100, before + 25) * 100) / 100; added += plants[i] - before; }
      this.habitat.recount(); message = `植被补种完成 · 新增 ${Math.round(added / 100)} 生物量`;
    } else if (kind === 'grazers' || kind === 'hunters') {
      const before = this.animals.length, amount = kind === 'grazers' ? 20 : 5;
      for (let i = 0; i < amount; i++) this.spawn(kind === 'grazers' ? 'grazer' : 'hunter', undefined, center);
      const added = this.animals.length - before;
      message = added ? `投放 ${kind === 'grazers' ? '原野兔' : '赤狐'} ${added} 只 · 当前观察区域附近` : '投放未增加个体 · 已达到世界容量上限';
    } else {
      let x = center.x, y = center.y;
      for (let i = 0; !natural && i < 1000; i++) { x = Math.max(.5, Math.min(this.width - .5, center.x + (this.rand() - .5) * 40)); y = Math.max(.5, Math.min(this.height - .5, center.y + (this.rand() - .5) * 40)); if (this.land(x, y)) break; }
      const radius = Math.min(20, Math.max(5, Math.min(this.width, this.height) * .12));
      for (let yy = Math.max(0, Math.floor(y - radius)); yy < Math.min(this.height, y + radius); yy++) for (let xx = Math.max(0, Math.floor(x - radius)); xx < Math.min(this.width, x + radius); xx++)
        if ((xx + .5 - x) ** 2 + (yy + .5 - y) ** 2 <= radius ** 2) { const i = yy * this.width + xx; this.habitat.setPlant(i, this.habitat.rawPlants[i] * .05); }
      for (const a of this.animals) if ((a.x - x) ** 2 + (a.y - y) ** 2 <= radius ** 2) { a.energy -= 35; if (a.energy <= 0) this.carcass(a); }
      const before = this.animals.length; this.animals = this.animals.filter(a => a.energy > 0); this.deaths += before - this.animals.length;
      location = { x, y, radius }; message = `局部山火 · (${Math.floor(x)}, ${Math.floor(y)}) · 植被受损，区域内动物损失能量`;
    }
    const event = this.record(natural ? 'wildfire' : kind, natural ? message.replace('局部山火', '自然山火 · 干燥植被起火') : message, location); this.sample(); return event;
  }
  fireRisk() {
    const climate = naturalClimateAt(this.tick, this.params, this.seed, this.nature.weather), soil = this.habitat.summary();
    return Math.max(0, Math.min(1, (45 - soil.moisture) / 40)) * Math.max(0, Math.min(1, (climate.temperature - 15) / 25)) * Math.min(1, soil.plantMean / 35);
  }
  private advanceNature() {
    if (this.nature.weather) {
      const now = weatherAt(this.tick, this.seed), previous = weatherAt(this.tick - 1, this.seed);
      if (now.kind !== previous.kind) this.record('weather', now.kind === 'clear' ? '天气过程结束 · 原野回到季节背景气候' : `${weatherSpecs[now.kind].label} · ${weatherSpecs[now.kind].effect}`);
    }
    // At most one bounded local fire check every 20 simulated seconds; no full-map scan.
    if (this.nature.disasters && this.tick % 100 === 0 && naturalHash(this.seed, this.tick, 981) < this.fireRisk() * .22) {
      for (let i = 0; i < 32; i++) {
        const x = Math.floor(naturalHash(this.seed, this.tick + i, 57) * this.width) + .5, y = Math.floor(naturalHash(this.seed, this.tick + i, 69) * this.height) + .5;
        if (this.land(x, y) && this.habitat.soilAt(x, y).moisture < 40 && this.habitat.rawPlants[Math.floor(y) * this.width + Math.floor(x)] > 25) { this.intervene('fire', { x, y }, true); break; }
      }
    }
    if (!this.nature.migration || this.tick % 600 !== 450 || this.animals.length >= this.maxAnimals) return;
    const season = Math.floor(this.tick / 3600) % 4, chance = [1, .8, .65, .35][season];
    if (naturalHash(this.seed, this.tick, 712) >= chance) return;
    const species = naturalHash(this.seed, this.tick, 23) < .78 ? 'grazer' : 'hunter', amount = species === 'grazer' ? 4 + Math.floor(naturalHash(this.seed, this.tick, 31) * 5) : 2;
    const edge = Math.floor(naturalHash(this.seed, this.tick, 70) * 4);
    for (let i = 0; i < 128; i++) {
      const p = naturalHash(this.seed, this.tick + i, 42), depth = 1 + naturalHash(this.seed, this.tick + i, 43) * 2;
      const x = edge === 0 ? depth : edge === 1 ? this.width - depth : p * (this.width - 1) + .5;
      const y = edge === 2 ? depth : edge === 3 ? this.height - depth : p * (this.height - 1) + .5;
      if (!this.land(x, y) || this.habitat.soilAt(x, y).moisture < 25 || this.habitat.rawPlants[Math.floor(y) * this.width + Math.floor(x)] < 20) continue;
      const before = this.animals.length;
      for (let n = 0; n < amount; n++) this.spawn(species, undefined, { x, y }, true);
      this.record('migration', `${['西', '东', '北', '南'][edge]}侧边界迁入 · ${species === 'grazer' ? '原野兔' : '赤狐'} ${this.animals.length - before} 只 · 新性状进入食物网`, { x, y });
      break;
    }
  }
  private carcass(a: Animal, fraction = 1) { this.habitat.addDetritus(a.x, a.y, (12 + Math.max(0, a.energy) * .2) * fraction); }
  private findWater(a: Animal) {
    const radius = Math.max(4, Math.round(8 * this.params.vision)); let distance = Infinity;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const x = Math.floor(a.x) + dx, y = Math.floor(a.y) + dy;
      if (x < 0 || y < 0 || x >= this.width || y >= this.height || this.habitat.terrain[y * this.width + x] !== 0 || this.habitat.soilAt(x, y).water < 10) continue;
      const d = dx * dx + dy * dy; if (d < distance) { distance = d; a.waterX = x + .5; a.waterY = y + .5; }
    }
    if (!Number.isFinite(distance)) { a.waterX = undefined; a.waterY = undefined; }
  }
  step() {
    if (this.params.paused) return; this.tick++;
    this.advanceNature();
    this.habitat.advance(this.tick, this.animals, this.params);
    const climate = naturalClimateAt(this.tick, this.params, this.seed, this.nature.weather);
    const bins = new Map<number, { grazer: Animal[]; hunter: Animal[] }>(), cols = Math.ceil(this.width / 8);
    const byId = new Map(this.animals.map(a => [a.id, a]));
    for (const a of this.animals) {
      const key = Math.floor(a.y / 8) * cols + Math.floor(a.x / 8); let bin = bins.get(key);
      if (!bin) { bin = { grazer: [], hunter: [] }; bins.set(key, bin); } bin[a.species].push(a);
    }
    const dead = new Set<number>();
    for (const a of [...this.animals]) {
      if (dead.has(a.id)) continue;
      const traits = speciesTraits[a.species], juvenile = a.age < maturity(a.species, this.params);
      const naturallyResting = a.species === 'grazer' ? climate.daylight < .12 : climate.daylight > .75;
      const resting = naturallyResting && a.energy > 60 && a.hydration > 50;
      a.age += .2; a.cooldown -= .2;
      a.hydration = Math.max(0, a.hydration - this.params.hydrationLoss * .2 * (1 + Math.max(0, climate.temperature - 25) / 20) * (resting ? .6 : 1));
      a.energy -= (a.species === 'grazer' ? this.params.grazerMaintenance : this.params.hunterMaintenance) * .2 * this.params.metabolism * a.genes * (1 + Math.abs(climate.temperature - 20) / 50) * (resting ? .5 : 1) * (juvenile ? this.params.juvenileMetabolism : 1) + (a.hydration < 20 ? .08 : 0);
      this.habitat.addDetritus(a.x, a.y, .002 * this.params.metabolism);
      if (a.energy <= 0 || a.hydration <= 0 || a.age > lifespan(a.species, this.params)) { dead.add(a.id); this.carcass(a); continue; }
      if (a.gestation > 0) {
        a.gestation = Math.max(0, a.gestation - .2); a.energy -= .015;
        if (a.energy <= 0) { dead.add(a.id); this.carcass(a); continue; }
        if (a.energy < 25) { a.gestation = 0; a.cooldown = 30; }
        else if (a.gestation === 0 && this.animals.length < this.maxAnimals) { a.energy -= 18; a.cooldown = 100; this.spawn(a.species, a); this.births++; }
      }
      let target: Animal | undefined, distance = (8 * this.params.vision) ** 2;
      const search = Math.ceil(this.params.vision), bx = Math.floor(a.x / 8), by = Math.floor(a.y / 8);
      const nearby = (species: Animal['species'], visit: (b: Animal) => void) => {
        for (let yy = Math.max(0, by - search); yy <= Math.min(Math.ceil(this.height / 8) - 1, by + search); yy++)
          for (let xx = Math.max(0, bx - search); xx <= Math.min(cols - 1, bx + search); xx++) {
            const candidates = bins.get(yy * cols + xx)?.[species]; if (!candidates?.length) continue;
            const count = Math.min(16, candidates.length), offset = (this.tick + a.id) % candidates.length;
            for (let i = 0; i < count; i++) { const b = candidates[(offset + Math.floor(i * candidates.length / count)) % candidates.length]; if (!dead.has(b.id)) visit(b); }
          }
      };
      nearby(a.species === 'grazer' ? 'hunter' : 'grazer', b => { const d = (b.x - a.x) ** 2 + (b.y - a.y) ** 2; if (d < distance) { target = b; distance = d; } });
      a.action = '探索'; let sprint = false, stationary = false;
      if (target && a.species === 'grazer' && distance < (5 * this.params.vision) ** 2) {
        a.heading = Math.atan2(a.y - target.y, a.x - target.x); a.action = '逃离'; sprint = true;
      } else if (a.hydration < 55) {
        if (a.waterChecked === undefined || this.tick - a.waterChecked >= 25) { this.findWater(a); a.waterChecked = this.tick; }
        if (a.waterX !== undefined && a.waterY !== undefined) {
          a.heading = Math.atan2(a.waterY - a.y, a.waterX - a.x); a.action = '寻水';
          if (Math.hypot(a.waterX - a.x, a.waterY - a.y) < 1.6 && this.habitat.drink(a.waterX, a.waterY)) { a.hydration = Math.min(100, a.hydration + this.params.drinkingRate * .2); a.action = '饮水'; stationary = true; }
        } else { a.action = '寻水'; if (this.rand() < .05) a.heading += (this.rand() - .5) * 1.5; }
      } else if (target && a.species === 'hunter' && a.energy < 105) {
        a.heading = Math.atan2(target.y - a.y, target.x - a.x); a.action = '追猎'; sprint = true;
        if (distance < .7) { dead.add(target.id); this.carcass(target, .25); a.energy = Math.min(145, a.energy + Math.max(8, target.energy * this.params.hunterAssimilation)); a.action = '进食'; }
      } else if (resting) { a.action = '休息'; stationary = true; }
      else if (a.species === 'grazer' && a.energy < 115) {
        let best = 0, tx = a.x, ty = a.y; const forage = Math.max(1, Math.round(3 * this.params.vision));
        for (let dy = -forage; dy <= forage; dy++) for (let dx = -forage; dx <= forage; dx++) {
          const x = Math.floor(a.x) + dx, y = Math.floor(a.y) + dy; if (!this.land(x, y)) continue;
          const score = this.habitat.rawPlants[y * this.width + x] / (1 + dx * dx + dy * dy);
          if (score > best) { best = score; tx = x + .5; ty = y + .5; }
        }
        a.heading = Math.atan2(ty - a.y, tx - a.x); a.action = '觅食';
        const i = Math.floor(a.y) * this.width + Math.floor(a.x), meal = Math.min(this.habitat.rawPlants[i], this.params.grazingRate * .2);
        this.habitat.setPlant(i, this.habitat.rawPlants[i] - meal); a.energy = Math.min(130, a.energy + meal * this.params.grazerAssimilation * this.params.plantNutrition);
      } else if (this.rand() < .08) a.heading += (this.rand() - .5) * 2;
      if (juvenile && a.age < 15 && a.motherId && !sprint) {
        const mother = byId.get(a.motherId);
        if (mother && !dead.has(mother.id)) {
          const d = Math.hypot(mother.x - a.x, mother.y - a.y);
          if (d > 1.5) { a.heading = Math.atan2(mother.y - a.y, mother.x - a.x); a.action = '育幼'; stationary = false; }
          else if (mother.energy > 35) { mother.energy -= .14; a.energy += .11; a.hydration = Math.min(100, a.hydration + .06); a.action = '育幼'; }
        }
      }
      const fast = sprint && a.stamina > 8;
      a.stamina = Math.max(0, Math.min(100, a.stamina + (fast ? -.7 : stationary ? .8 : .4)));
      const speed = traits.speed * a.genes * (fast ? 1.8 : 1) * (a.species === 'grazer' ? this.params.grazerSpeed : this.params.hunterSpeed) * (juvenile ? .65 : 1);
      if (!stationary) {
        const nx = a.x + Math.cos(a.heading) * speed, ny = a.y + Math.sin(a.heading) * speed;
        if (this.land(nx, ny)) { a.x = nx; a.y = ny; }
        else { for (const turn of [.8, -.8, 1.6, -1.6, 2.4]) { const angle = a.heading + turn * (a.id % 2 ? 1 : -1), x = a.x + Math.cos(angle) * speed, y = a.y + Math.sin(angle) * speed; if (this.land(x, y)) { a.x = x; a.y = y; a.heading = angle; break; } } }
      }
      const birthRate = a.species === 'grazer' ? this.params.grazerBirthRate : this.params.hunterBirthRate;
      if (!juvenile && a.sex === 'female' && a.energy > 100 && a.hydration > 50 && a.cooldown <= 0 && a.gestation === 0 && !sprint && this.animals.length < this.maxAnimals && this.rand() < .025 * birthRate * climate.breeding) {
        let mate: Animal | undefined;
        nearby(a.species, b => { if (!mate && b.sex === 'male' && b.age >= maturity(a.species, this.params) && b.energy > 60 && b.hydration > 40 && b.cooldown <= 0 && Math.hypot(b.x - a.x, b.y - a.y) < this.params.mateRadius) mate = b; });
        if (mate) { a.energy -= 24; mate.energy -= 8; mate.cooldown = 25; a.gestation = gestation(a.species, this.params); a.mateGenes = mate.genes; a.action = '求偶'; }
      }
    }
    this.deaths += dead.size; this.animals = this.animals.filter(a => !dead.has(a.id));
    if (this.tick % 25 === 0) this.sample();
  }
  stats(): Stats {
    const grazers = this.animals.filter(a => a.species === 'grazer').length;
    const count = this.animals.length, mean = (fn: (a: Animal) => number) => count ? this.animals.reduce((n, a) => n + fn(a), 0) / count : 0;
    const genes = mean(a => a.genes), soil = this.habitat.summary();
    return { tick: this.tick, grazers, hunters: this.animals.length - grazers, plants: Math.round(this.habitat.totalPlants / 100), births: this.births, deaths: this.deaths,
      diversity: Math.round(genes * 100), ...soil, meanEnergy: mean(a => a.energy), energyReserve: mean(a => Math.min(100, a.energy / speciesTraits[a.species].capacity * 100)), meanHydration: mean(a => a.hydration), meanGenes: genes,
      geneSD: Math.sqrt(mean(a => (a.genes - genes) ** 2)), juveniles: this.animals.filter(a => a.age < maturity(a.species, this.params)).length,
      juvenileGrazers: this.animals.filter(a => a.species === 'grazer' && a.age < maturity(a.species, this.params)).length,
      juvenileHunters: this.animals.filter(a => a.species === 'hunter' && a.age < maturity(a.species, this.params)).length,
      pregnancies: this.animals.filter(a => a.gestation > 0).length, females: this.animals.filter(a => a.sex === 'female').length,
      temperature: naturalClimateAt(this.tick, this.params, this.seed, this.nature.weather).temperature };
  }
  ecology(): Ecology {
    const average = (values: Float32Array) => values.reduce((n, v) => n + v, 0) / values.length;
    return { ...naturalClimateAt(this.tick, this.params, this.seed, this.nature.weather), nature: { ...this.nature }, weather: weatherAt(this.tick, this.seed), fireRisk: this.fireRisk(), moisture: average(this.habitat.moisture), nutrients: average(this.habitat.nutrients), detritus: average(this.habitat.detritus),
      juveniles: this.animals.filter(a => a.age < maturity(a.species, this.params)).length, pregnancies: this.animals.filter(a => a.gestation > 0).length, activeRegions: this.habitat.activeRegions, updatedRegions: this.habitat.updatedRegions };
  }
  export(): SaveState {
    const packedPlants = new Uint16Array(this.habitat.rawPlants.length);
    for (let i = 0; i < packedPlants.length; i++) packedPlants[i] = Math.round(this.habitat.rawPlants[i] * 100);
    return { version: 2, width: this.width, height: this.height, seed: this.seed, random: this.random, tick: this.tick, nextId: this.nextId, maxAnimals: this.maxAnimals,
      terrain: encode(this.habitat.terrain), plants: encode(packedPlants), plantEncoding: 'u16x100', habitat: this.habitat.save(), focus: { ...this.focus },
      animals: structuredClone(this.animals), params: { ...this.params }, births: this.births, deaths: this.deaths, history: structuredClone(this.history), events: structuredClone(this.events), nature: { ...this.nature } };
  }
  static restore(s: SaveState) {
    const uint = (n: number) => Number.isSafeInteger(n) && n >= 0;
    const keys = new Set(['version', 'width', 'height', 'seed', 'random', 'tick', 'nextId', 'maxAnimals', 'terrain', 'plants', 'plantEncoding', 'animals', 'params', 'births', 'deaths', 'history', 'events', 'habitat', 'focus', 'nature']);
    if (!s || typeof s !== 'object' || Object.keys(s).some(key => !keys.has(key)) || ![1, 2].includes(s.version) || !Number.isInteger(s.width) || !Number.isInteger(s.height) || s.width < 24 || s.width > MAX_WORLD || s.height < 24 || s.height > MAX_WORLD ||
      !Array.isArray(s.animals) || !Array.isArray(s.history) || !uint(s.maxAnimals) || s.maxAnimals < 20 || s.maxAnimals > 5000 || s.animals.length > s.maxAnimals || s.history.length > 240 ||
      !uint(s.tick) || !uint(s.random) || s.random > 4294967295 || !uint(s.seed) || s.seed > 4294967295 || !uint(s.nextId) || !uint(s.births) || !uint(s.deaths) ||
      !s.params || !['paused', 'speed', 'rain', 'fertility', 'metabolism'].every(key => Object.hasOwn(s.params, key)) || (s.events !== undefined && (!Array.isArray(s.events) || s.events.length > 12))) throw new Error('存档格式无效');
    const cells = s.width * s.height;
    let terrain: Uint8Array, plants: Float32Array;
    if (s.version === 1) {
      if (!Array.isArray(s.terrain) || !Array.isArray(s.plants) || s.terrain.length !== cells || s.plants.length !== cells || s.terrain.some(t => ![0, 1, 2].includes(t)) || s.plants.some(p => !Number.isFinite(p) || p < 0 || p > 100)) throw new Error('存档图层无效');
      terrain = Uint8Array.from(s.terrain); plants = Float32Array.from(s.plants);
    } else {
      if (typeof s.terrain !== 'string' || typeof s.plants !== 'string' || !s.habitat) throw new Error('存档图层无效');
      if (s.plantEncoding !== undefined && s.plantEncoding !== 'u16x100') throw new Error('存档植被编码无效');
      terrain = decode(s.terrain, cells, 'u8') as Uint8Array;
      if (s.plantEncoding === 'u16x100') {
        const packed = decode(s.plants, cells, 'u16') as Uint16Array; plants = new Float32Array(cells);
        for (let i = 0; i < cells; i++) plants[i] = packed[i] / 100;
      } else plants = decode(s.plants, cells, 'f32') as Float32Array;
      if (terrain.some(t => t > 2) || plants.some(p => !Number.isFinite(p) || p < 0 || p > 100)) throw new Error('存档图层无效');
    }
    const animals = structuredClone(s.animals), ids = new Set<number>();
    for (const a of animals) {
      if (s.version === 1) { a.hydration ??= 80; a.sex ??= a.id % 2 ? 'female' : 'male'; a.gestation ??= 0; }
      if (!a || !uint(a.id) || a.id >= s.nextId || ids.has(a.id) || !['grazer', 'hunter'].includes(a.species) || !['male', 'female'].includes(a.sex) ||
        ![a.x, a.y, a.energy, a.age, a.stamina, a.genes, a.heading, a.cooldown, a.hydration, a.gestation].every(Number.isFinite) ||
        a.x < 0 || a.x >= s.width || a.y < 0 || a.y >= s.height || terrain[Math.floor(a.y) * s.width + Math.floor(a.x)] !== 1 || a.energy <= 0 || a.stamina < 0 || a.stamina > 100 || a.age < 0 || a.genes < .7 || a.genes > 1.4 || a.hydration <= 0 || a.hydration > 100 || a.gestation < 0 || a.gestation > 240 ||
        (a.motherId !== undefined && (!uint(a.motherId) || a.motherId >= s.nextId)) || (a.waterChecked !== undefined && (!uint(a.waterChecked) || a.waterChecked > s.tick)) || (a.mateGenes !== undefined && (!Number.isFinite(a.mateGenes) || a.mateGenes < .7 || a.mateGenes > 1.4)) ||
        ((a.waterX !== undefined || a.waterY !== undefined) && (![a.waterX, a.waterY].every(n => typeof n === 'number' && Number.isFinite(n)) || a.waterX! < 0 || a.waterX! >= s.width || a.waterY! < 0 || a.waterY! >= s.height))) throw new Error('存档个体数据无效');
      ids.add(a.id);
    }
    if (s.history.some(h => !h || !Object.entries(h).every(([key, n]) => typeof n === 'number' && Number.isFinite(n) && (key === 'temperature' ? n >= -100 && n <= 100 : n >= 0)))) throw new Error('存档历史数据无效');
    if (s.events?.some(e => !e || !uint(e.id) || !uint(e.tick) || e.tick > s.tick || !['seed', 'grazers', 'hunters', 'fire', 'configure', 'weather', 'wildfire', 'migration', 'nature'].includes(e.kind) || typeof e.message !== 'string' || e.message.length > 300 ||
      ((e.x !== undefined || e.y !== undefined) && (![e.x, e.y].every(n => typeof n === 'number' && Number.isFinite(n)) || e.x! < 0 || e.x! >= s.width || e.y! < 0 || e.y! >= s.height)) ||
      (['fire', 'wildfire'].includes(e.kind) && (![e.x, e.y, e.radius].every(n => typeof n === 'number' && Number.isFinite(n)) || e.x! < 0 || e.x! >= s.width || e.y! < 0 || e.y! >= s.height || e.radius! <= 0 || e.radius! > 256)))) throw new Error('存档事件数据无效');
    const w = Object.create(World.prototype) as World;
    for (const key of ['width', 'height', 'seed', 'random', 'tick', 'nextId', 'maxAnimals', 'births', 'deaths'] as const) (w as unknown as Record<string, unknown>)[key] = s[key];
    w.habitat = new Habitat(s.width, s.height, s.seed, { terrain, plants }); if (s.habitat) w.habitat.load(s.habitat, s.tick);
    else w.habitat.updated.fill(s.tick);
    w.animals = animals; w.params = { ...environmentDefaults, ...s.params }; w.configure(w.params);
    validateNature(s.nature ?? natureDefaults); w.nature = { ...natureDefaults, ...s.nature }; w.habitat.weatherSeed = w.nature.weather ? w.seed : undefined;
    w.events = structuredClone(s.events ?? []); w.history = structuredClone(s.history);
    w.focus = s.focus ? { ...s.focus } : { x: s.width / 2, y: s.height / 2 };
    if (![w.focus.x, w.focus.y].every(Number.isFinite) || w.focus.x < 0 || w.focus.x >= w.width || w.focus.y < 0 || w.focus.y >= w.height) throw new Error('存档观察中心无效');
    return w;
  }
}
