// Quick deal-state check after seed.
import Database from 'better-sqlite3';

const db = new Database('backend/data/biteforless.db', { readonly: true });
const rows = db.prepare(`
  SELECT d.food_name, d.status, d.expires_at, s.email as shop_email
  FROM deals d JOIN shops s ON s.id = d.shop_id
  WHERE s.email LIKE '%@example.com'
  ORDER BY d.food_name`).all();
for (const r of rows) console.log([r.food_name, r.status, r.expires_at].join(' | '));
db.close();
