import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { World } from './world.js';
export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS world (id INTEGER PRIMARY KEY CHECK (id=1), state TEXT NOT NULL, saved_at TEXT NOT NULL)');
  }
  load() { const row = this.db.prepare('SELECT state FROM world WHERE id=1').get(); return row ? World.restore(JSON.parse(String(row.state))) : null; }
  save(world: World) { this.db.prepare('INSERT INTO world VALUES(1, ?, ?) ON CONFLICT(id) DO UPDATE SET state=excluded.state, saved_at=excluded.saved_at').run(JSON.stringify(world.export()), new Date().toISOString()); }
  close() { this.db.close(); }
}
