import { deflateSync, inflateSync } from 'node:zlib';
import { endianness } from 'node:os';
import { climateAt } from '../shared/climate.js';
import { naturalClimateAt } from '../shared/nature.js';
import type { Animal, Parameters } from '../shared/types.js';
import { growthPotential } from '../shared/model.js';

export const REGION = 32, SOIL = 8, MAX_WORLD = 2048;
export interface HabitatSave { moisture: string; nutrients: string; detritus: string; water: string; updated: string; cursor: number }
export function encode(values: Float32Array | Float64Array | Uint8Array | Uint16Array) {
  let bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
  if (endianness() === 'BE' && !(values instanceof Uint8Array)) { bytes = Buffer.from(bytes); if (values instanceof Float64Array) bytes.swap64(); else if (values instanceof Uint16Array) bytes.swap16(); else bytes.swap32(); }
  return deflateSync(bytes, { level: 1 }).toString('base64');
}
export function decode(input: string, count: number, kind: 'u8' | 'u16' | 'f32' | 'f64') {
  if (typeof input !== 'string' || input.length > count * 12 + 256) throw new Error('存档图层格式无效');
  const size = kind === 'u8' ? 1 : kind === 'u16' ? 2 : kind === 'f32' ? 4 : 8;
  const bytes = inflateSync(Buffer.from(input, 'base64'), { maxOutputLength: count * size });
  if (bytes.length !== count * size) throw new Error('存档图层长度无效');
  if (endianness() === 'BE' && size > 1) { if (size === 8) bytes.swap64(); else if (size === 2) bytes.swap16(); else bytes.swap32(); }
  const copy = new Uint8Array(bytes.length); copy.set(bytes);
  return kind === 'u8' ? copy : kind === 'u16' ? new Uint16Array(copy.buffer) : kind === 'f32' ? new Float32Array(copy.buffer) : new Float64Array(copy.buffer);
}
function hash(x: number, y: number, seed: number) { let n = Math.imul(x + seed, 374761393) ^ Math.imul(y + 1, 668265263); n = Math.imul(n ^ n >>> 13, 1274126177); return (n ^ n >>> 16) >>> 0; }
export function terrainAt(x: number, y: number, seed: number) {
  const xx = x % 128, yy = y % 128, river = 34 + 12 * Math.sin(y / 28) + 5 * Math.sin(y / 9);
  if (Math.abs(xx - river) < 1.6 || ((xx - 94) / 13) ** 2 + ((yy - 84) / 18) ** 2 < 1) return 0;
  return hash(x, y, seed) / 4294967296 < .055 ? 2 : 1;
}

export class Habitat {
  readonly terrain: Uint8Array; readonly rawPlants: Float32Array;
  /** Compatibility facade tracks direct edits without adding proxy work to simulation loops. */
  readonly plants: number[];
  readonly cols: number; readonly rows: number; readonly regionCols: number; readonly regionRows: number;
  moisture: Float32Array; nutrients: Float32Array; detritus: Float32Array; water: Float32Array;
  updated: Float64Array; private totals: Float64Array; private land: Uint16Array;
  readonly versions: Uint32Array;
  private waterSites: Uint8Array;
  totalPlants = 0; updatedRegions = 0; activeRegions = 0; cursor = 0;
  weatherSeed?: number;
  constructor(readonly width: number, readonly height: number, seed: number, layers?: { terrain: Uint8Array; plants: Float32Array }) {
    this.cols = Math.ceil(width / SOIL); this.rows = Math.ceil(height / SOIL);
    this.regionCols = Math.ceil(width / REGION); this.regionRows = Math.ceil(height / REGION);
    const cells = width * height, soils = this.cols * this.rows, regions = this.regionCols * this.regionRows;
    this.terrain = layers?.terrain ?? new Uint8Array(cells); this.rawPlants = layers?.plants ?? new Float32Array(cells);
    this.moisture = new Float32Array(soils).fill(55); this.nutrients = new Float32Array(soils).fill(65);
    this.detritus = new Float32Array(soils); this.water = new Float32Array(soils);
    this.waterSites = new Uint8Array(soils);
    this.updated = new Float64Array(regions); this.totals = new Float64Array(regions); this.land = new Uint16Array(regions);
    this.versions = new Uint32Array(regions).fill(1);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!layers) { this.terrain[i] = terrainAt(x, y, seed); this.rawPlants[i] = this.terrain[i] === 1 ? Math.round((20 + hash(x, y, seed + 99) / 4294967296 * 70) * 100) / 100 : 0; }
      else this.rawPlants[i] = Math.round(this.rawPlants[i] * 100) / 100;
      if (this.terrain[i] === 0) { this.water[this.soilIndex(x, y)] = 100; this.waterSites[this.soilIndex(x, y)] = 1; }
      if (this.terrain[i] === 1) this.land[this.regionIndex(x, y)]++;
    }
    this.recount();
    this.plants = new Proxy(this.rawPlants, {
      get: (target, property) => {
        if (property === 'fill') return (value: number, start?: number, end?: number) => { target.fill(Math.round(value * 100) / 100, start, end); this.recount(); return this.plants; };
        const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
      },
      set: (target, property, value) => { const index = Number(property); if (typeof property === 'string' && Number.isInteger(index) && index >= 0 && index < cells) { this.setPlant(index, value); return true; } return Reflect.set(target, property, value, target); },
    }) as unknown as number[];
  }
  regionIndex(x: number, y: number) { return Math.floor(y / REGION) * this.regionCols + Math.floor(x / REGION); }
  soilIndex(x: number, y: number) { return Math.floor(y / SOIL) * this.cols + Math.floor(x / SOIL); }
  soilAt(x: number, y: number) { const i = this.soilIndex(x, y); return { moisture: this.moisture[i], nutrients: this.nutrients[i], detritus: this.detritus[i], water: this.water[i] }; }
  addDetritus(x: number, y: number, amount: number) { const i = this.soilIndex(x, y); this.detritus[i] = Math.min(500, this.detritus[i] + Math.max(0, amount)); }
  setPlant(index: number, value: number) {
    const before = this.rawPlants[index]; this.rawPlants[index] = Math.round(Math.max(0, Math.min(100, value)) * 100) / 100;
    const delta = this.rawPlants[index] - before; this.totalPlants += delta;
    const region = this.regionIndex(index % this.width, Math.floor(index / this.width)); this.totals[region] += delta; if (delta) this.versions[region]++;
  }
  recount() {
    this.totalPlants = 0; this.totals.fill(0);
    for (let i = 0; i < this.versions.length; i++) this.versions[i]++;
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) { const value = this.rawPlants[y * this.width + x]; this.totalPlants += value; this.totals[this.regionIndex(x, y)] += value; }
  }
  regionBiomass(x: number, y: number) { const r = this.regionIndex(x, y); return this.land[r] ? this.totals[r] / this.land[r] : 0; }
  summary() {
    const mean = (a: Float32Array) => a.reduce((n, v) => n + v, 0) / a.length;
    const landCells = this.land.reduce((n, v) => n + v, 0);
    return { moisture: mean(this.moisture), nutrients: mean(this.nutrients), detritus: mean(this.detritus), landCells, plantMean: landCells ? this.totalPlants / landCells : 0 };
  }
  advance(tick: number, animals: Animal[], params: Parameters) {
    this.updatedRegions = 0;
    const active = [...new Set(animals.map(a => this.regionIndex(a.x, a.y)))]; this.activeRegions = active.length;
    // Priorities are driven by organisms, never by viewers. Dense/large populations stay bounded.
    const offset = active.length ? (tick * 64) % active.length : 0;
    for (let i = 0; i < Math.min(64, active.length); i++) this.advanceRegion(active[(offset + i) % active.length], tick, params);
    for (let i = 0; i < 2; i++) { this.advanceRegion(this.cursor, tick, params); this.cursor = (this.cursor + 1) % this.updated.length; }
  }
  flush(tick: number, params: Parameters) { for (let r = 0; r < this.updated.length; r++) this.advanceRegion(r, tick, params, true); }
  private advanceRegion(region: number, tick: number, params: Parameters, force = false) {
    const elapsed = (tick - this.updated[region]) / 5;
    if (elapsed <= 0 || (!force && elapsed < 1)) return;
    const start = this.updated[region]; this.updated[region] = tick; this.updatedRegions++;
    this.versions[region]++;
    // Bounded quadrature approximates dormant-region weather over elapsed time.
    const samples = Math.min(8, Math.max(1, Math.ceil(elapsed / 20)));
    let rain = 0, light = 0, temperature = 0;
    for (let j = 0; j < samples; j++) { const t = start + (tick - start) * (j + .5) / samples, c = this.weatherSeed === undefined ? climateAt(t, params) : naturalClimateAt(t, params, this.weatherSeed); rain += c.rain / samples; light += c.daylight * params.sunlight / samples; temperature += c.temperature / samples; }
    const rx = region % this.regionCols * REGION, ry = Math.floor(region / this.regionCols) * REGION;
    const thermal = Math.max(0, 1 - Math.abs(temperature - params.decayOptimum) / params.decayThermalWidth);
    for (let sy = ry / SOIL; sy < Math.min(this.rows, (ry + REGION) / SOIL); sy++) for (let sx = rx / SOIL; sx < Math.min(this.cols, (rx + REGION) / SOIL); sx++) {
      const s = sy * this.cols + sx, evaporate = params.evaporationBase + Math.max(0, temperature) * params.evaporationHeat * Math.max(.1, light);
      const hasWater = this.waterSites[s] !== 0;
      if (hasWater) this.water[s] = Math.max(.01, Math.min(100, this.water[s] + elapsed * (rain * params.waterRecharge + .025 - evaporate)));
      this.moisture[s] = Math.max(0, Math.min(100, this.moisture[s] + elapsed * (rain * params.rainInfiltration - evaporate + (this.water[s] > 20 ? params.soilExchange : 0))));
      const decomposed = this.detritus[s] * (1 - Math.exp(-elapsed * params.decayRate * thermal * Math.min(1, this.moisture[s] / 50) * params.decayQ10 ** ((temperature - 20) / 10)));
      this.detritus[s] -= decomposed; this.nutrients[s] = Math.min(100, this.nutrients[s] + decomposed * params.decayEfficiency);
      const growth = Math.min(elapsed * growthPotential(temperature, this.moisture[s], this.nutrients[s], light, params), this.nutrients[s] / (params.nutrientCost * 64), this.moisture[s] / (params.moistureCost * 64));
      let grown = 0;
      for (let y = sy * SOIL; y < Math.min(this.height, (sy + 1) * SOIL); y++) for (let x = sx * SOIL; x < Math.min(this.width, (sx + 1) * SOIL); x++) {
        const i = y * this.width + x; if (this.terrain[i] !== 1) continue;
        const before = this.rawPlants[i]; this.rawPlants[i] = Math.round(Math.min(100, before + growth) * 100) / 100; grown += this.rawPlants[i] - before;
      }
      this.totals[region] += grown; this.totalPlants += grown;
      this.nutrients[s] = Math.max(0, this.nutrients[s] - grown * params.nutrientCost);
      this.moisture[s] = Math.max(0, this.moisture[s] - grown * params.moistureCost);
    }
  }
  drink(x: number, y: number) { const i = this.soilIndex(x, y); if (this.water[i] < 10) return false; this.water[i] = Math.max(0, this.water[i] - .04); this.versions[this.regionIndex(x, y)]++; return true; }
  save(): HabitatSave { return { moisture: encode(this.moisture), nutrients: encode(this.nutrients), detritus: encode(this.detritus), water: encode(this.water), updated: encode(this.updated), cursor: this.cursor }; }
  load(s: HabitatSave, tick: number) {
    for (const key of ['moisture', 'nutrients', 'detritus', 'water'] as const) {
      const values = decode(s[key], this.cols * this.rows, 'f32') as Float32Array;
      const max = key === 'detritus' ? 500 : 100;
      if (values.some(v => !Number.isFinite(v) || v < 0 || v > max)) throw new Error('存档土壤数据无效'); this[key] = values;
    }
    this.updated = decode(s.updated, this.updated.length, 'f64') as Float64Array;
    if (this.updated.some(v => !Number.isSafeInteger(v) || v < 0 || v > tick) || !Number.isInteger(s.cursor) || s.cursor < 0 || s.cursor >= this.updated.length) throw new Error('存档分区数据无效');
    this.cursor = s.cursor;
  }
  expanded(seed: number, tick: number) {
    const result = new Habitat(this.width * 2, this.height * 2, seed);
    for (let y = 0; y < this.height; y++) { result.terrain.set(this.terrain.subarray(y * this.width, (y + 1) * this.width), y * result.width); result.rawPlants.set(this.rawPlants.subarray(y * this.width, (y + 1) * this.width), y * result.width); }
    for (const key of ['moisture', 'nutrients', 'detritus', 'water'] as const) for (let y = 0; y < this.rows; y++) result[key].set(this[key].subarray(y * this.cols, (y + 1) * this.cols), y * result.cols);
    for (let y = 0; y < this.rows; y++) result.waterSites.set(this.waterSites.subarray(y * this.cols, (y + 1) * this.cols), y * result.cols);
    result.updated.fill(tick); result.recount(); return result;
  }
}
