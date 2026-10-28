import { DatabaseSync, backup } from 'node:sqlite';
import { resolve } from 'node:path';
const [source, destination] = process.argv.slice(2);
if (!source || !destination || resolve(source) === resolve(destination)) throw new Error('用法: node dist/server/backup.js 源数据库 备份路径（两者不能相同）');
const db = new DatabaseSync(source, { readOnly: true });
try { await backup(db, destination); console.log(`Backup created: ${destination}`); } finally { db.close(); }
