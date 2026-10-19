// Migration entrypoint: backs up the existing SQLite database (+ WAL/SHM)
// into backend/data/backups/ BEFORE loading the schema module, which applies
// all additive/idempotent migrations in config/db.js. Existing rows are never
// rewritten; fresh databases are created directly.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..');
const dataDir = path.join(backendRoot, 'data');
const dbFile = process.env.DATABASE_URL?.startsWith('sqlite:')
  ? process.env.DATABASE_URL.replace('sqlite:', '')
  : (process.env.DATABASE_URL || './backend/data/biteforless.db');
const dbPath = path.isAbsolute(dbFile) ? dbFile : path.resolve(path.join(backendRoot, '..'), dbFile.replace(/^\.\//, ''));
const backupDir = path.join(dataDir, 'backups');

if (fs.existsSync(dbPath)) {
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const base = path.basename(dbPath, '.db');
  for (const suffix of ['', '-wal', '-shm']) {
    const src = `${dbPath}${suffix}`;
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(backupDir, `${base}-${stamp}${suffix || '.db'}`).replace('.db.db', '.db'));
    }
  }
  console.log(`Backup written to backend/data/backups/${base}-${stamp}.db`);
}

await import('../config/db.js');
console.log('Database schema ready.');
process.exit(0);
