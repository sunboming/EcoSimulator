import type { Overview, TerrainTile, ViewRect } from '../shared/types.js';
import { packAnimal } from '../shared/protocol.js';
import { REGION, SOIL } from './habitat.js';
import type { World } from './world.js';
export const FINE_SPAN = 192;
export function normalizeView(input: unknown, world: World): ViewRect {
  const v = input as ViewRect;
  if (!v || ![v.x, v.y, v.width, v.height].every(n => typeof n === 'number' && Number.isFinite(n)) || v.width < 1 || v.height < 1 ||
    (v.selected !== undefined && (!Number.isSafeInteger(v.selected) || v.selected < 0))) throw new Error('观察范围无效');
  const x = Math.max(0, Math.min(world.width - 1, Math.floor(v.x))), y = Math.max(0, Math.min(world.height - 1, Math.floor(v.y)));
  return { x, y, width: Math.min(world.width - x, Math.ceil(v.width)), height: Math.min(world.height - y, Math.ceil(v.height)), selected: v.selected };
}
export function initialView(world: World) { return normalizeView({ x: Math.max(0, world.focus.x - 64), y: Math.max(0, world.focus.y - 48), width: Math.min(128, world.width), height: Math.min(96, world.height) }, world); }
export function overview(world: World): Overview {
  const stride = Math.max(1, Math.ceil(Math.max(world.width, world.height) / 128));
  const width = Math.ceil(world.width / stride), height = Math.ceil(world.height / stride);
  const terrain = Buffer.alloc(width * height), plants = Buffer.alloc(width * height);
  for (let yy = 0; yy < height; yy++) for (let xx = 0; xx < width; xx++) {
    const x = Math.min(world.width - 1, xx * stride + Math.floor(stride / 2)), y = Math.min(world.height - 1, yy * stride + Math.floor(stride / 2)), i = yy * width + xx;
    terrain[i] = world.habitat.terrain[y * world.width + x]; plants[i] = Math.round(world.habitat.regionBiomass(x, y));
  }
  const groups = new Map<number, number[]>(), cell = Math.max(8, Math.ceil(Math.max(world.width, world.height) / 32)), cols = Math.ceil(world.width / cell);
  for (const a of world.animals) { const key = Math.floor(a.y / cell) * cols + Math.floor(a.x / cell); let group = groups.get(key); if (!group) { group = [Math.floor(a.x / cell) * cell + cell / 2, Math.floor(a.y / cell) * cell + cell / 2, 0, 0]; groups.set(key, group); } group[a.species === 'grazer' ? 2 : 3]++; }
  return { width, height, terrain: terrain.toString('base64'), plants: plants.toString('base64'), population: [...groups.values()] };
}
export function buildView(world: World, view: ViewRect, seen?: Map<number, number>) {
  const fine = view.width <= FINE_SPAN && view.height <= FINE_SPAN, tiles: TerrainTile[] = [];
  const current = new Set<number>();
  if (fine) for (let cy = Math.floor(view.y / REGION); cy < Math.ceil((view.y + view.height) / REGION); cy++) for (let cx = Math.floor(view.x / REGION); cx < Math.ceil((view.x + view.width) / REGION); cx++) {
    const region = cy * world.habitat.regionCols + cx; current.add(region);
    if (seen?.get(region) === world.habitat.versions[region]) continue;
    seen?.set(region, world.habitat.versions[region]);
    const x = cx * REGION, y = cy * REGION, terrain = Buffer.alloc(REGION * REGION, 2), plants = Buffer.alloc(REGION * REGION);
    const moisture = Buffer.alloc(16), nutrients = Buffer.alloc(16), water = Buffer.alloc(16);
    for (let yy = 0; yy < REGION && y + yy < world.height; yy++) for (let xx = 0; xx < REGION && x + xx < world.width; xx++) {
      const src = (y + yy) * world.width + x + xx, dst = yy * REGION + xx;
      terrain[dst] = world.habitat.terrain[src]; plants[dst] = Math.round(world.habitat.rawPlants[src]);
    }
    for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < 4; xx++) {
      if (x + xx * SOIL >= world.width || y + yy * SOIL >= world.height) continue;
      const s = world.habitat.soilAt(x + xx * SOIL, y + yy * SOIL), i = yy * 4 + xx;
      moisture[i] = Math.round(s.moisture); nutrients[i] = Math.round(s.nutrients); water[i] = Math.round(s.water);
    }
    tiles.push({ x, y, size: REGION, terrain: terrain.toString('base64'), plants: plants.toString('base64'), moisture: moisture.toString('base64'), nutrients: nutrients.toString('base64'), water: water.toString('base64') });
  }
  if (seen) for (const key of seen.keys()) if (!current.has(key)) seen.delete(key);
  const visible = world.animals.filter(a => a.id === view.selected || (a.x >= view.x - 3 && a.y >= view.y - 3 && a.x < view.x + view.width + 3 && a.y < view.y + view.height + 3));
  const density: number[][] = [];
  if (!fine) {
    const cells = new Map<number, number[]>(), cellSize = Math.max(8, Math.ceil(Math.max(view.width, view.height) / 40)), cols = Math.ceil(world.width / cellSize);
    for (const a of visible) { const key = Math.floor(a.y / cellSize) * cols + Math.floor(a.x / cellSize); let cell = cells.get(key); if (!cell) { cell = [Math.floor(a.x / cellSize) * cellSize + cellSize / 2, Math.floor(a.y / cellSize) * cellSize + cellSize / 2, 0, 0]; cells.set(key, cell); } cell[a.species === 'grazer' ? 2 : 3]++; }
    density.push(...cells.values());
  }
  return { view, tiles, density, animals: (fine ? visible : [...new Map([...visible.filter(a => a.id === view.selected), ...visible.slice(0, 16)].map(a => [a.id, a])).values()]).map(packAnimal) };
}
