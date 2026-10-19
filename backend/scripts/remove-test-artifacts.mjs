// Phase 0 remediation: removes test-artifact rows that leaked into the real
// demo database because tests once loaded config/db.js before switching
// DATABASE_URL (ESM static-import hoisting). Deletes ONLY rows tied to the
// *bfl.test runner accounts/shops; genuine demo data is untouched.
// A numbered backup is written into backend/data/backups/ before any delete.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');
const dbPath = process.env.BFL_DB || path.join(rootDir, 'backend', 'data', 'biteforless.db');
const backupDir = path.join(rootDir, 'backend', 'data', 'backups');

if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupPath = path.join(backupDir, `biteforless-phase0-${stamp}.db`);
await new Database(dbPath).backup(backupPath);
console.log(`Backup written: ${path.relative(rootDir, backupPath)}`);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const junkEmails = ['admin@bfl.test', 'custa@bfl.test', 'custb@bfl.test', 'owner1@bfl.test', 'owner2@bfl.test'];
const junkUserIds = db.prepare(`SELECT id, name FROM users WHERE email IN (${junkEmails.map(() => '?').join(',')})`)
  .all(...junkEmails);
const junkUserSet = new Set(junkUserIds.map((u) => u.id));

const junkShopRows = db.prepare("SELECT id, name FROM shops WHERE owner_id IN ('" + [...junkUserSet].join("','") + "') OR email LIKE '%@bfl.test'").all();
const junkShopSet = new Set(junkShopRows.map((s) => s.id));

console.log('Junk users:', JSON.stringify(junkUserIds));
console.log('Junk shops:', JSON.stringify(junkShopRows));

if (!junkUserSet.size && !junkShopSet.size && !db.prepare("SELECT COUNT(*) c FROM deals WHERE shop_id IN ('x')").get().c) {
  console.log('Nothing to clean.');
  db.close();
  process.exit(0);
}

const userIds = [...junkUserSet, null];
const shopIds = [...junkShopSet, null];

const tx = db.transaction(() => {
  const join = (iterable) => [...iterable].map((id) => `'${id}'`).join(',');
  // Deals created against junk shops (the test "Food ####" rows).
  const dealIds = db.prepare(`SELECT id FROM deals WHERE shop_id IN (${join(junkShopSet)})`).all().map((d) => d.id);
  if (dealIds.length) {
    const jDeals = join(dealIds);
    db.prepare(`DELETE FROM reviews WHERE deal_id IN (${jDeals})`).run();
    db.prepare(`DELETE FROM favorites WHERE deal_id IN (${jDeals})`).run();
    db.prepare(`DELETE FROM reservations WHERE deal_id IN (${jDeals})`).run();
    db.prepare(`DELETE FROM deals WHERE id IN (${jDeals})`).run();
  }
  // Reservations + notifications belonging to junk users.
  db.prepare(`DELETE FROM reservations WHERE user_id IN (${join(junkUserSet)})`).run();
  db.prepare(`DELETE FROM notifications WHERE user_id IN (${join(junkUserSet)})`).run();
  db.prepare(`DELETE FROM favorites WHERE user_id IN (${join(junkUserSet)})`).run();
  db.prepare(`DELETE FROM activity_logs WHERE actor_id IN (${join(junkUserSet)})`).run();
  // Shops (deals already handled), then the users.
  db.prepare(`DELETE FROM shops WHERE id IN (${join(junkShopSet)})`).run();
  db.prepare(`DELETE FROM users WHERE id IN (${join(junkUserSet)})`).run();
});
tx();

// Any stray deal rows with runner-shop naming, in case the owner link broke.
const strays = db.prepare("SELECT id FROM deals WHERE food_name LIKE 'Food %' AND shop_id NOT IN (SELECT id FROM shops)").all();
if (strays.length) {
  db.prepare(`DELETE FROM deals WHERE id IN ('${strays.join("','")}')`).run();
  console.log('Removed stray deal rows:', strays.length);
}

const verify = {
  bfl_test_users_left: db.prepare("SELECT COUNT(*) c FROM users WHERE email LIKE '%@bfl.test'").get().c,
  users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
  shops: db.prepare('SELECT COUNT(*) c FROM shops').get().c,
  deals: db.prepare('SELECT COUNT(*) c FROM deals').get().c,
  reviews: db.prepare('SELECT COUNT(*) c FROM reviews').get().c
};
console.log('After cleanup:', JSON.stringify(verify, null, 1));
db.close();
console.log('Test artifacts removed. Backup preserved for rollback.');
