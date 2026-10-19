import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { config } from './env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const dataDir = path.join(rootDir, 'backend', 'data');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const rawPath = config.databaseUrl.startsWith('sqlite:')
  ? config.databaseUrl.replace('sqlite:', '')
  : config.databaseUrl;
const databasePath = path.isAbsolute(rawPath)
  ? rawPath
  : path.join(rootDir, rawPath.replace(/^\.\//, ''));

// Guard: automated tests must never open the real demo database. Any test
// module loading this file without an explicit DATABASE_URL (e.g. because an
// ESM static import was hoisted above the env override) fails FAST here
// instead of silently seeding/corrupting backend/data/biteforless.db.
const isTestRun = process.env.NODE_ENV === 'test'
  || process.argv.some((a) => a.includes('test'))
  || typeof process.env.NODE_TEST_CONTEXT === 'string';
if (isTestRun && !process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL must be set to an isolated temp path when tests load config/db.js. '
    + 'Refusing to open the real database: ' + databasePath
  );
}

const db = new Database(databasePath);
db.pragma('journal_mode = WAL');

// ---------------------------------------------------------------------------
// Schema. Everything here is additive and idempotent: existing rows are never
// rewritten, and CHECK-constraint widenings use the guarded rebuild pattern
// (insert-select into *_new, drop, rename) inside one transaction with foreign
// keys off. Money stays REAL ZMW everywhere — values are never reinterpreted.
// ---------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'customer' CHECK(role IN ('customer', 'shop_owner', 'admin')),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'pending', 'suspended', 'disabled')),
    profile_image TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS shops (
    id TEXT PRIMARY KEY,
    owner_id TEXT UNIQUE,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    city TEXT,
    latitude REAL,
    longitude REAL,
    business_info TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','suspended')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS deals (
    id TEXT PRIMARY KEY,
    shop_id TEXT NOT NULL,
    shop_name TEXT NOT NULL,
    food_name TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL DEFAULT 'Other',
    original_price REAL NOT NULL,
    discounted_price REAL NOT NULL,
    discount_percentage INTEGER NOT NULL DEFAULT 0,
    quantity INTEGER NOT NULL,
    quantity_remaining INTEGER NOT NULL,
    image_url TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','expired','cancelled','sold_out')),
    FOREIGN KEY (shop_id) REFERENCES shops(id)
  );

  CREATE TABLE IF NOT EXISTS reservations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    deal_id TEXT NOT NULL,
    shop_id TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    total_amount REAL NOT NULL,
    reservation_code TEXT NOT NULL UNIQUE,
    pickup_pin TEXT NOT NULL,
    qr_token TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','collected','cancelled','expired')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (deal_id) REFERENCES deals(id),
    FOREIGN KEY (shop_id) REFERENCES shops(id)
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    shop_id TEXT NOT NULL,
    deal_id TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    comment TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (shop_id) REFERENCES shops(id),
    FOREIGN KEY (deal_id) REFERENCES deals(id)
  );

  CREATE TABLE IF NOT EXISTS favorites (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    deal_id TEXT,
    shop_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    reservation_id TEXT,
    user_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','success','failed')),
    gateway TEXT NOT NULL DEFAULT 'development',
    amount REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reservation_id) REFERENCES reservations(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    icon TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS announcements (
    id TEXT PRIMARY KEY,
    created_by_admin_id TEXT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    audience TEXT NOT NULL DEFAULT 'all' CHECK(audience IN ('all','customers','shop_owners')),
    status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','archived')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by_admin_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS activity_logs (
    id TEXT PRIMARY KEY,
    actor_id TEXT,
    actor_role TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (actor_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_deals_shop ON deals(shop_id);
  CREATE INDEX IF NOT EXISTS idx_deals_status_expires ON deals(status, expires_at);
  CREATE INDEX IF NOT EXISTS idx_reservations_user ON reservations(user_id, status);
  CREATE INDEX IF NOT EXISTS idx_reservations_shop ON reservations(shop_id, status);
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
  CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
  CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_logs(created_at);
`);

// Guarded column adder: adds a column when it is missing from an existing
// table (data-preserving; no CHECK-affecting changes).
export function ensureColumns(d, table, columns) {
  const have = new Set(d.prepare(`SELECT name FROM pragma_table_info('${table}')`).all().map((r) => r.name));
  for (const [column, ddl] of Object.entries(columns)) {
    if (!have.has(column)) {
      d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    }
  }
}

// Migration 1: shops gained richer business-profile columns (multi-step
// onboarding). Preserves every existing shop row untouched.
ensureColumns(db, 'shops', {
  business_type: 'TEXT',
  description: 'TEXT',
  whatsapp_number: 'TEXT',
  area: 'TEXT',
  opening_hours: 'TEXT',
  pickup_instructions: 'TEXT',
  pickup_window_start: 'TEXT',
  pickup_window_end: 'TEXT',
  logo_path: 'TEXT',
  cover_image_path: 'TEXT',
  updated_at: 'TEXT'
});

// Migration 2: users.status must also allow 'disabled' (admin can disable an
// account without losing data) and users can carry a profile image + updated_at.
// Rebuild detection reads the CREATE SQL from sqlite_master — pragma_table_info
// only reveals the declared type ("TEXT"), which never mentions CHECK values.
const usersSql = (db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'`).get()?.sql) || '';
const usersNeedRebuild = !!usersSql && !/\bdisabled\b/.test(usersSql);
ensureColumns(db, 'users', { profile_image: 'TEXT', updated_at: 'TEXT' });
if (usersNeedRebuild) {
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE users_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          phone TEXT,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'customer' CHECK(role IN ('customer', 'shop_owner', 'admin')),
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'pending', 'suspended', 'disabled')),
          profile_image TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT
        );
        INSERT INTO users_new (id, name, email, phone, password_hash, role, status, profile_image, created_at, updated_at)
          SELECT id, name, email, phone, password_hash, role, status, NULL, created_at, updated_at FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
      `);
    })();
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

// Migration 3: deals gained managed pause state and pickup-window columns.
// Same sqlite_master detection as migration 2 (pragma "TEXT" can't show CHECK).
const dealsSql = (db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'deals'`).get()?.sql) || '';
const dealsNeedRebuild = !!dealsSql && !/\bpaused\b/.test(dealsSql);
ensureColumns(db, 'deals', {
  pickup_window_start: 'TEXT',
  pickup_window_end: 'TEXT',
  updated_at: 'TEXT',
  image_path: 'TEXT'
});
if (dealsNeedRebuild) {
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE deals_new (
          id TEXT PRIMARY KEY,
          shop_id TEXT NOT NULL,
          shop_name TEXT NOT NULL,
          food_name TEXT NOT NULL,
          description TEXT,
          category TEXT NOT NULL DEFAULT 'Other',
          original_price REAL NOT NULL,
          discounted_price REAL NOT NULL,
          discount_percentage INTEGER NOT NULL DEFAULT 0,
          quantity INTEGER NOT NULL,
          quantity_remaining INTEGER NOT NULL,
          image_url TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          expires_at TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','expired','cancelled','sold_out')),
          pickup_window_start TEXT,
          pickup_window_end TEXT,
          updated_at TEXT,
          image_path TEXT,
          FOREIGN KEY (shop_id) REFERENCES shops(id)
        );
        INSERT INTO deals_new (id, shop_id, shop_name, food_name, description, category, original_price, discounted_price, discount_percentage, quantity, quantity_remaining, image_url, created_at, expires_at, status, updated_at)
          SELECT id, shop_id, shop_name, food_name, description, category, original_price, discounted_price, discount_percentage, quantity, quantity_remaining, image_url, created_at, expires_at, status, updated_at FROM deals;
        DROP TABLE deals;
        ALTER TABLE deals_new RENAME TO deals;
      `);
    })();
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

// Migration 4: reviews moderation (default published — no moderation endpoint
// existed before, so existing review rows must not disappear from the site).
ensureColumns(db, 'reviews', {
  moderation_status: `TEXT NOT NULL DEFAULT 'published' CHECK(moderation_status IN ('published','hidden'))`
});

// Migration 5: reservations carry a collected_at timestamp so pickup history
// is auditable; sweep/cancel paths restore stock exactly once via the status
// guard (see routes/reservations.js).
ensureColumns(db, 'reservations', {
  collected_at: 'TEXT'
});

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_reservations_status_expires ON reservations(status, expires_at);
  CREATE INDEX IF NOT EXISTS idx_deals_category ON deals(category);
  CREATE INDEX IF NOT EXISTS idx_activity_actor ON activity_logs(actor_id);
  CREATE INDEX IF NOT EXISTS idx_shops_status ON shops(status);
  CREATE INDEX IF NOT EXISTS idx_users_role_status ON users(role, status);
`);

export default db;
