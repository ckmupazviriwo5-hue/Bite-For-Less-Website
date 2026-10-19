// Read-only check: timestamps of any remaining runner-artifact rows.
import Database from 'better-sqlite3';

const db = new Database('backend/data/biteforless.db', { readonly: true });
console.log('bfl.test users:', JSON.stringify(db.prepare("SELECT id, name, email, created_at FROM users WHERE email LIKE '%@bfl.test'").all(), null, 1));
console.log('Food % deals:', JSON.stringify(db.prepare("SELECT id, food_name, shop_id, created_at FROM deals WHERE food_name LIKE 'Food %'").all(), null, 1));
console.log('Shop % rows:', JSON.stringify(db.prepare("SELECT id, name, email, owner_id, created_at FROM shops WHERE name LIKE 'Shop %'").all(), null, 1));
console.log('user counts:', db.prepare('SELECT COUNT(*) c FROM users').get().c);
db.close();
