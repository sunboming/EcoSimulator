import type { Animal } from './types.js';
const actions = ['探索', '逃离', '追猎', '进食', '觅食', '寻水', '饮水', '休息', '育幼', '求偶'];
export type WireAnimal = [number, number, number, number, number, number, number, number, number, number, number, number, number, number];
const round = (n: number, digits = 100) => Math.round(n * digits) / digits;
/** Compact, quantized render data. Persistence always keeps full precision. */
export function packAnimal(a: Animal): WireAnimal {
  return [a.id, a.species === 'hunter' ? 1 : 0, round(a.x), round(a.y), round(a.energy, 10), round(a.stamina, 10), round(a.age, 10), round(a.genes, 1000), round(a.heading % (Math.PI * 2)), actions.indexOf(a.action), round(a.hydration, 10), a.sex === 'female' ? 1 : 0, round(a.gestation, 10), a.motherId ?? 0];
}
export function unpackAnimal(a: WireAnimal): Animal {
  return { id: a[0], species: a[1] ? 'hunter' : 'grazer', x: a[2], y: a[3], energy: a[4], stamina: a[5], age: a[6], genes: a[7], heading: a[8], action: actions[a[9]] ?? '探索', cooldown: 0, hydration: a[10] ?? 80, sex: a[11] ? 'female' : 'male', gestation: a[12] ?? 0, motherId: a[13] || undefined };
}
