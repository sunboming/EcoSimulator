import type { Environment } from './environment.js';
import type { Climate } from './climate.js';
import type { NatureSettings, weatherAt } from './nature.js';
export type Species = 'grazer' | 'hunter';
export interface Animal { id: number; species: Species; x: number; y: number; energy: number; stamina: number; age: number; genes: number; heading: number; cooldown: number; action: string; hydration: number; sex: 'female' | 'male'; gestation: number; motherId?: number; mateGenes?: number; waterX?: number; waterY?: number; waterChecked?: number }
export interface Parameters extends Environment { paused: boolean; speed: number }
export type Intervention = 'seed' | 'grazers' | 'hunters' | 'fire';
export interface WorldEvent { id: number; tick: number; kind: Intervention | 'configure' | 'weather' | 'wildfire' | 'migration' | 'nature'; message: string; x?: number; y?: number; radius?: number }
export interface Stats { tick: number; grazers: number; hunters: number; plants: number; births: number; deaths: number; diversity: number;
  moisture?: number; nutrients?: number; detritus?: number; plantMean?: number; landCells?: number; meanEnergy?: number; energyReserve?: number; meanHydration?: number; meanGenes?: number; geneSD?: number; juveniles?: number; juvenileGrazers?: number; juvenileHunters?: number; pregnancies?: number; females?: number; temperature?: number }
export interface HabitatState { moisture: string; nutrients: string; detritus: string; water: string; updated: string; cursor: number }
export interface SaveState { version: 1 | 2; width: number; height: number; seed: number; random: number; tick: number; nextId: number; maxAnimals: number; terrain: number[] | string; plants: number[] | string; plantEncoding?: 'u16x100'; animals: Animal[]; params: Parameters; births: number; deaths: number; history: Stats[]; events?: WorldEvent[]; nature?: NatureSettings; habitat?: HabitatState; focus?: { x: number; y: number } }
export interface ViewRect { x: number; y: number; width: number; height: number; selected?: number }
export interface TerrainTile { x: number; y: number; size: number; terrain: string; plants: string; moisture: string; nutrients: string; water: string }
export interface Overview { width: number; height: number; terrain: string; plants: string; population: number[][] }
export interface Ecology extends Climate { nature?: NatureSettings; weather?: ReturnType<typeof weatherAt>; fireRisk?: number; moisture: number; nutrients: number; detritus: number; juveniles: number; pregnancies: number; activeRegions: number; updatedRegions: number }
export interface Snapshot { type: 'snapshot'; epoch: string; width: number; height: number; terrain: number[]; plants: number[]; animals: Animal[]; params: Parameters; stats: Stats; history: Stats[]; protected: boolean; events: WorldEvent[]; tiles: TerrainTile[]; overview: Overview; ecology: Ecology; view: ViewRect; focus: { x: number; y: number }; density: number[][] }
export interface Delta { type: 'delta'; epoch: string; plants: [number, number][]; animals: Animal[]; params: Parameters; stats: Stats; samples: Stats[]; events: WorldEvent[]; tiles: TerrainTile[]; overview?: Overview; ecology: Ecology; density: number[][]; view: ViewRect }
