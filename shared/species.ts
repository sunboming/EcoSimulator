import type { Animal, Species } from './types.js';
/** Species traits are separate from world state; add new behavior strategies in World. */
export const speciesTraits: Record<Species, { label: string; speed: number; metabolism: number; lifespan: number; capacity: number; maturity: number; pregnancy: number }> = {
  grazer: { label: '原野兔', speed: .10, metabolism: .055, lifespan: 800, capacity: 130, maturity: 40, pregnancy: 35 },
  hunter: { label: '赤狐', speed: .12, metabolism: .075, lifespan: 1100, capacity: 145, maturity: 65, pregnancy: 70 },
};
/** Hunger is derived from energy, so feeding cannot leave two conflicting hunger states. */
export function hunger(a: Animal) { return Math.max(0, Math.min(100, (1 - a.energy / speciesTraits[a.species].capacity) * 100)); }
