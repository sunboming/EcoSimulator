import type { Animal, Species } from '../shared/types';
type Pose = 'walk' | 'run' | 'eat' | 'idle';
const cache = new Map<string, HTMLCanvasElement>();
/** Native 32px pixel sprites. Every frame is painted once, then reused via drawImage. */
export function animalSprite(species: Species, pose: Pose = 'idle', frame = 0) {
  frame %= 4; const key = `${species}:${pose}:${frame}`;
  if (cache.has(key)) return cache.get(key)!;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
  const c = canvas.getContext('2d')!, moving = pose === 'walk' || pose === 'run', hop = moving && (frame === 1 || frame === 2) ? -1 : 0;
  const nibble = pose === 'eat' && frame % 2 ? 1 : 0;
  const r = (x: number, y: number, w: number, h: number, color: string) => { c.fillStyle = color; c.fillRect(x, y, w, h); };
  c.fillStyle = '#07100c65'; c.beginPath(); c.ellipse(16, 29, species === 'hunter' ? 13 : 10, 2, 0, 0, 7); c.fill();
  c.save(); c.translate(0, hop);
  if (species === 'grazer') {
    const edge = '#3c4e43', shade = '#acbfbb', white = '#f5f5db', light = '#ffffee', pink = '#e4a9a3';
    // Long upright ears, white cotton tail and rounded haunch distinguish the rabbit.
    r(17, 2 + nibble, 5, 16, edge); r(18, 3 + nibble, 3, 13, white); r(19, 4 + nibble, 1, 9, pink);
    r(23, 3 - (frame % 2), 5, 15, edge); r(24, 4 - (frame % 2), 3, 12, white); r(25, 5, 1, 8, pink);
    r(5, 17, 17, 10, edge); r(3, 20, 4, 6, edge); r(6, 15, 13, 13, edge);
    r(6, 18, 15, 8, shade); r(7, 16, 11, 9, white); r(8, 17, 8, 6, light);
    r(2, 20, 5, 5, light); r(3, 19, 3, 7, white);
    r(17, 13 + nibble, 12, 10, edge); r(19, 12 + nibble, 8, 12, edge);
    r(18, 14 + nibble, 10, 8, white); r(20, 13 + nibble, 6, 9, light);
    r(25, 17 + nibble, 3, 3, '#25372e'); r(26, 17 + nibble, 1, 1, '#ffffff');
    r(28, 21 + nibble, 2, 2, pink); r(23, 22 + nibble, 4, 1, shade);
    r(8 + (moving ? frame % 2 * 2 : 0), 26, 7, 3, edge); r(9 + (moving ? frame % 2 * 2 : 0), 26, 6, 2, white);
    r(20 - (moving ? frame % 2 * 2 : 0), 25, 5, 3, edge); r(21 - (moving ? frame % 2 * 2 : 0), 25, 4, 2, white);
    if (pose === 'eat') { r(28, 25, 3, 2, '#9ec866'); r(29, 23, 2, 4, '#b4df80'); }
  } else {
    const edge = '#472c28', orange = '#eb8b3c', light = '#ffb051', shade = '#bb542d', cream = '#fff0c7', dark = '#56352d';
    // Large cream-tipped brush tail and sharp ears give the fox a different silhouette.
    const sway = moving || pose === 'idle' ? frame % 2 : 0;
    r(1, 15 + sway, 7, 7, edge); r(4, 16 + sway, 10, 9, edge); r(2, 16 + sway, 5, 5, cream);
    r(6, 17 + sway, 7, 6, orange); r(9, 20 + sway, 5, 5, shade);
    r(11, 17, 13, 10, edge); r(12, 17, 11, 8, orange); r(13, 17, 8, 3, light); r(13, 24, 10, 2, shade);
    r(21, 5, 4, 10, edge); r(22, 7, 2, 7, shade); r(27, 6, 3, 9, edge); r(28, 8, 1, 6, shade);
    r(20, 12 + nibble, 11, 8, edge); r(22, 10 + nibble, 7, 12, edge);
    r(21, 13 + nibble, 9, 6, orange); r(23, 11 + nibble, 5, 9, light);
    r(22, 18 + nibble, 8, 4, cream); r(25, 21 + nibble, 4, 2, cream); r(29, 18 + nibble, 2, 2, dark);
    r(26, 14 + nibble, 2, 3, '#302621'); r(27, 14 + nibble, 1, 1, '#fff9e2');
    r(20, 22, 3, 5, cream);
    const stride = moving ? [0, 2, 0, -2][frame] : 0;
    r(12 + stride, 25, 3, 4, dark); r(20 - stride, 25, 3, 4, dark); r(11 + stride, 28, 4, 1, dark); r(19 - stride, 28, 4, 1, dark);
    if (pose === 'eat') r(28, 24, 3, 2, '#cf6e53');
  }
  c.restore(); cache.set(key, canvas); return canvas;
}
export function spritePose(animal: Animal): Pose { return animal.action === '追猎' || animal.action === '逃离' ? 'run' : animal.action === '进食' || animal.action === '觅食' ? 'eat' : 'walk'; }
export function portrait(species: Species) { return animalSprite(species).toDataURL(); }
