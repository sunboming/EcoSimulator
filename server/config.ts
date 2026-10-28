function integer(name: string, fallback: number, min: number, max: number) {
  const n = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} 必须为 ${min}–${max} 的整数`);
  return n;
}
const privateMode = process.env.PRIVATE_MODE ?? 'true';
if (!['true', 'false'].includes(privateMode)) throw new Error('PRIVATE_MODE 必须为 true 或 false');
export const config = {
  privateMode: privateMode === 'true',
  idleTimeoutMs: integer('IDLE_TIMEOUT_SECONDS', 1800, 1, 86400) * 1000,
  port: integer('PORT', 3000, 1, 65535), host: process.env.HOST ?? '0.0.0.0',
  width: integer('WORLD_WIDTH', 512, 24, 2048), height: integer('WORLD_HEIGHT', 384, 24, 2048),
  seed: integer('WORLD_SEED', 42, 0, 4294967295), maxAnimals: integer('MAX_ANIMALS', 1200, 20, 5000),
  tickHz: integer('TICK_HZ', 5, 1, 20), pushHz: integer('PUSH_HZ', 2, 1, 5),
  saveSeconds: integer('SAVE_SECONDS', 30, 5, 3600), maxClients: privateMode === 'true' ? 1 : integer('MAX_CLIENTS', 1, 1, 200),
  dbPath: process.env.DB_PATH ?? './data/world.sqlite', adminToken: process.env.ADMIN_TOKEN ?? '',
  publicOrigin: process.env.PUBLIC_ORIGIN ?? '',
};
