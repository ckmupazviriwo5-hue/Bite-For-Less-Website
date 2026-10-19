// Read-only DB inspector for audits (never writes).
import Database from 'better-sqlite3';

const dbPath = process.argv[2] || 'backend/data/biteforless.db';
const db = new Database(dbPath, { readonly: true });

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('tables:', tables.map((t) => t.name).join(', '));
const counts = {};
for (const t of tables.map((x) => x.name)) {
  try { counts[t] = db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c; } catch (e) { counts[t] = 'ERR ' + e.message; }
}
console.log('counts:', JSON.stringify(counts, null, 1));
try {
  console.log('users:', JSON.stringify(db.prepare('SELECT email, role, status FROM users ORDER BY role, email').all(), null, 1));
} catch (e) { console.log('users: ERR', e.message); }
try {
  console.log('shops:', JSON.stringify(db.prepare('SELECT id, name, status, owner_id FROM shops').all(), null, 1));
} catch (e) { console.log('shops: ERR', e.message); }
try {
  console.log('deals:', JSON.stringify(db.prepare('SELECT food_name, status, quantity_remaining, category FROM deals ORDER BY status').all(), null, 1));
} catch (e) { console.log('deals: ERR', e.message); }
db.close();
