// Idempotent demo seed. Running this NEVER overwrites genuine user data:
// every insert is guarded by an existence check (users by email, shops by
// email, deals by shop+food_name, categories by name, reviews by user+deal).
// Demo data is Zambian (Lusaka) and priced in ZMW.
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import db from '../config/db.js';
import { config } from '../config/env.js';
import { makeId, nowIso } from '../utils/helpers.js';

const imagesDir = path.join(config.uploadsDir, 'products');
if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

// ---------------------------------------------------------------------------
// Product imagery: prefer project-controlled local files so the presentation
// works offline. Curated Unsplash photos are downloaded ONCE into
// backend/uploads/products (gitignored, provenance documented in
// docs/MEDIA_PROVENANCE.md); when the download fails (no internet) a clean
// local SVG placeholder is generated instead. Either way the DB only stores
// the relative /uploads/... path.
// ---------------------------------------------------------------------------
function localSvgPlaceholder(label, [r, g, b]) {
  const safe = label.replace(/[<>&]/g, '');
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="560" viewBox="0 0 800 560">` +
      `<rect width="800" height="560" fill="rgb(${r},${g},${b})"/>` +
      `<circle cx="400" cy="250" r="110" fill="rgba(255,255,255,0.18)"/>` +
      `<text x="400" y="270" font-family="Arial, sans-serif" font-size="40" font-weight="bold" fill="#ffffff" text-anchor="middle">Bite For Less</text>` +
      `<text x="400" y="330" font-family="Arial, sans-serif" font-size="26" fill="#ffffff" text-anchor="middle">${safe}</text>` +
      `<text x="400" y="520" font-family="Arial, sans-serif" font-size="20" fill="rgba(255,255,255,0.85)" text-anchor="middle">Zambia · ZMW</text>` +
    `</svg>`
  );
}

async function ensureImage(fileName, label, rgb, unsplashId) {
  const filePath = path.join(imagesDir, fileName);
  if (fs.existsSync(filePath)) return `/uploads/products/${fileName}`;
  const svg = localSvgPlaceholder(label, rgb);
  if (unsplashId) {
    const url = `https://images.unsplash.com/photo-${unsplashId}?auto=format&fit=crop&w=800&q=70`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        // Basic magic-byte check: only accept real JPEG/PNG/WebP bytes.
        const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
        const isPng = buf[0] === 0x89 && buf[1] === 0x50;
        if ((isJpg || isPng) && buf.length > 5000) {
          fs.writeFileSync(filePath, buf);
          console.log(`  image: downloaded ${fileName}`);
          return `/uploads/products/${fileName}`;
        }
      }
    } catch { /* offline — fall through to SVG */ }
  }
  fs.writeFileSync(filePath, svg);
  console.log(`  image: placeholder ${fileName}`);
  return `/uploads/products/${fileName}`;
}

const CATEGORIES = [
  ['Bakery', 'bread'], ['Meals', 'food'], ['Fruits & Vegetables', 'leaf'],
  ['Groceries', 'bag'], ['Snacks', 'cookie'], ['Drinks', 'cup'], ['Other', 'dot']
];

function ensureCategories() {
  const insert = db.prepare('INSERT INTO categories (id, name, icon, status) VALUES (?, ?, ?, ?)');
  for (const [name, icon] of CATEGORIES) {
    const exists = db.prepare('SELECT id FROM categories WHERE LOWER(name) = LOWER(?)').get(name);
    if (!exists) insert.run(makeId('category'), name, icon, 'active');
  }
}

function ensureUser({ email, name, phone, role, status = 'active', password = 'password123' }) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return existing.id;
  const id = makeId(role === 'admin' ? 'admin' : 'user');
  db.prepare('INSERT INTO users (id, name, email, phone, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, name, email, phone, bcrypt.hashSync(password, 10), role, status, nowIso());
  console.log(`  user: ${email} (${role}/${status})`);
  return id;
}

function ensureShop({ ownerEmail, ownerName, name, email, phone, city, area, address, businessType, description, status, openingHours, pickupInstructions }) {
  const ownerId = ensureUser({ email: ownerEmail, name: ownerName, phone: '+260 97 000 0000', role: 'shop_owner', status: 'active' });
  // One owner owns exactly one shop (UNIQUE owner_id): reuse what exists —
  // first by owner, then by email (covers orphan guest applications). Names
  // below are only used on FRESH databases; existing data wins everywhere.
  const existingByOwner = db.prepare('SELECT id FROM shops WHERE owner_id = ?').get(ownerId);
  if (existingByOwner) return existingByOwner.id;
  const existingByEmail = db.prepare('SELECT id FROM shops WHERE email = ?').get(email);
  if (existingByEmail) return existingByEmail.id;
  const id = makeId('shop');
  db.prepare(`INSERT INTO shops (id, owner_id, name, email, phone, city, area, address, business_type, business_info, description, opening_hours, pickup_instructions, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, ownerId, name, email, phone, city, area, address, businessType, description, description, openingHours, pickupInstructions, status, nowIso());
  console.log(`  shop: ${name} (${status})`);
  return id;
}

const createdImages = new Map();
const imageFor = async (fileName, label, rgb, unsplash) => {
  if (!createdImages.has(fileName)) createdImages.set(fileName, await ensureImage(fileName, label, rgb, unsplash));
  return createdImages.get(fileName);
};

function ensureDeal(shopId, deal) {
  const shopName = db.prepare('SELECT name FROM shops WHERE id = ?').get(shopId)?.name || '';
  const existing = db.prepare('SELECT id FROM deals WHERE shop_id = ? AND food_name = ?').get(shopId, deal.food_name);
  if (existing) return existing.id;
  const id = makeId('deal');
  const discount = Math.max(0, Math.min(100, Math.round(((deal.original_price - deal.discounted_price) / deal.original_price) * 100)));
  const created = new Date(Date.now() - deal.hoursOld * 3600 * 1000).toISOString();
  const expires = new Date(Date.now() + deal.hoursLeft * 3600 * 1000).toISOString();
  db.prepare(`INSERT INTO deals (id, shop_id, shop_name, food_name, description, category, original_price, discounted_price, discount_percentage, quantity, quantity_remaining, image_url, image_path, created_at, expires_at, pickup_window_start, pickup_window_end, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?)`)
    .run(id, shopId, shopName, deal.food_name, deal.description, deal.category, deal.original_price, deal.discounted_price, discount, deal.quantity, deal.quantity, deal.image_path, created, expires, deal.pickup_window_start || '09:00', deal.pickup_window_end || '19:00', 'active');
  console.log(`  deal: ${deal.food_name} (${shopName})`);
  return id;
}

function ensureReview(userId, dealId, shopId, rating, comment) {
  const existing = db.prepare('SELECT id FROM reviews WHERE deal_id = ? AND user_id = ?').get(dealId, userId);
  if (existing) return;
  db.prepare('INSERT INTO reviews (id, user_id, shop_id, deal_id, rating, comment, moderation_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(makeId('review'), userId, shopId, dealId, rating, comment, 'published', nowIso());
}

function ensureAnnouncement(title, body) {
  const existing = db.prepare('SELECT id FROM announcements WHERE title = ?').get(title);
  if (existing) return;
  const id = makeId('announcement');
  db.prepare('INSERT INTO announcements (id, created_by_admin_id, title, body, audience, status, created_at) VALUES (?, NULL, ?, ?, ?, ?, ?)')
    .run(id, title, body, 'all', 'published', nowIso());
}

// ---------------------------------------------------------------------------

if (!config.seedDemoData) {
  console.log('SEED_DEMO_DATA=false — skipped demo seed.');
  process.exit(0);
}

console.log('Seeding Bite For Less demo data…');
ensureCategories();

const adminEmail = config.adminEmail;
ensureUser({ email: adminEmail, name: 'Platform Admin', phone: '+260 96 000 0000', role: 'admin', password: config.adminPassword });

const customerId = ensureUser({ email: 'customer@example.com', name: 'Customer Demo', phone: '+260 97 111 1111', role: 'customer' });
const customerId2 = ensureUser({ email: 'chisomo@example.com', name: 'Chisomo Banda', phone: '+260 97 222 2222', role: 'customer' });

const bakedId = ensureShop({
  ownerEmail: 'shopowner@example.com', ownerName: 'Shop Owner Demo',
  name: "Mama Chanda's Bakery", email: 'bakery@example.com',
  phone: '+260 97 333 3333', city: 'Lusaka', area: 'Kabwata',
  address: '12 Kabwata Road, Lusaka', businessType: 'Bakery',
  description: 'Family bakery saving end-of-day bread and pastries at fair Zambian prices.',
  status: 'approved', openingHours: 'Mon–Sat 07:00–19:00', pickupInstructions: 'Ask for Mama Chanda at the counter.'
});
const veggieId = ensureShop({
  ownerEmail: 'veggie@example.com', ownerName: 'Veggieland Owner',
  name: 'Lusaka Veggie Market', email: 'veggie@example.com',
  phone: '+260 96 444 4444', city: 'Lusaka', area: 'Soweto Market area',
  address: 'Corner Los Angeles Rd, Lusaka', businessType: 'Grocery',
  description: 'Fresh produce market stall rescuing surplus fruit and vegetables daily.',
  status: 'approved', openingHours: 'Mon–Sun 06:00–18:00', pickupInstructions: 'Stall 44, green awning.'
});
const grillId = ensureShop({
  ownerEmail: 'grill@example.com', ownerName: 'Chanda Grill Owner',
  name: 'Chanda Chicken Grill', email: 'grill@example.com',
  phone: '+260 97 555 5555', city: 'Lusaka', area: 'Northmead',
  address: '5 Alindo Crescent, Northmead, Lusaka', businessType: 'Restaurant',
  description: 'Flame-grilled chicken and chips. Pending — awaiting platform approval.',
  status: 'pending', openingHours: 'Tue–Sun 11:00–21:00', pickupInstructions: 'Drive-through window.'
});

const images = {
  bread: await imageFor('seed-bread.jpg', 'Fresh Bread', [124, 87, 51], '1509440159596-0249088772ff'),
  samosa: await imageFor('seed-samosa.jpg', 'Samosas', [164, 108, 44], '1601050690597-df0568f70950'),
  cake: await imageFor('seed-banana-bread.jpg', 'Banana Bread', [122, 82, 38], '1578985545062-69928b1d9587'),
  veg: await imageFor('seed-veg-basket.jpg', 'Vegetables', [46, 105, 62], '1540420773420-3366772f4999'),
  fruit: await imageFor('seed-fruit-tray.jpg', 'Fruit Tray', [163, 74, 50], '1464965911861-746a04b4bca6'),
  rice: await imageFor('seed-rice-bag.jpg', 'Rice', [143, 128, 100], '1586201375761-83865001e31c'),
  milk: await imageFor('seed-milk.jpg', 'Fresh Milk', [92, 118, 146], '1550583724-b2692b85b150'),
  chicken: await imageFor('seed-chicken.jpg', 'Grilled Chicken', [140, 70, 40], '1600891964092-4316c288032e'),
  pancakes: await imageFor('seed-pancakes.jpg', 'Pancakes', [166, 112, 48], '1567620905732-2d1ec7ab7445')
};

// NOTE: ensureImage before ensureDeal changes deal.image_path assignment BELOW.
const DEALS = [
  { shopId: bakedId, shopName: "Mama Chanda's Bakery", food_name: 'Fresh Bread Loaves', description: 'End-of-day white and brown loaves, still warm.', category: 'Bakery', original_price: 25.00, discounted_price: 15.00, quantity: 10, hoursOld: 5, hoursLeft: 4, image_path: images.bread },
  { shopId: bakedId, shopName: "Mama Chanda's Bakery", food_name: 'Vegetable Samosas (pack of 4)', description: 'Crispy vegetable samosas made this morning.', category: 'Snacks', original_price: 20.00, discounted_price: 12.00, quantity: 8, hoursOld: 3, hoursLeft: 6, image_path: images.samosa },
  { shopId: bakedId, shopName: "Mama Chanda's Bakery", food_name: 'Banana Bread Slices', description: 'Slices of classic Zambian-style banana bread.', category: 'Bakery', original_price: 30.00, discounted_price: 18.00, quantity: 6, hoursOld: 2, hoursLeft: 8, image_path: images.cake },
  { shopId: bakedId, shopName: "Mama Chanda's Bakery", food_name: 'Pancake Stack (3 pcs)', description: ' fluffy pancakes with syrup packet.', category: 'Meals', original_price: 35.00, discounted_price: 22.00, quantity: 5, hoursOld: 1, hoursLeft: 5, image_path: images.pancakes },
  { shopId: veggieId, shopName: 'Lusaka Veggie Market', food_name: 'Mixed Vegetable Basket', description: '2kg of surplus seasonal vegetables (tomatoes, rape, onion).', category: 'Fruits & Vegetables', original_price: 45.00, discounted_price: 28.00, quantity: 12, hoursOld: 6, hoursLeft: 7, image_path: images.veg },
  { shopId: veggieId, shopName: 'Lusaka Veggie Market', food_name: 'Seasonal Fruit Tray', description: 'Tray of mangoes, bananas and oranges — rescued surplus.', category: 'Fruits & Vegetables', original_price: 60.00, discounted_price: 38.00, quantity: 8, hoursOld: 4, hoursLeft: 9, image_path: images.fruit },
  { shopId: veggieId, shopName: 'Lusaka Veggie Market', food_name: 'Rice Bag (2kg)', description: 'Sealed 2kg rice bags from a cancelled bulk order.', category: 'Groceries', original_price: 70.00, discounted_price: 55.00, quantity: 15, hoursOld: 10, hoursLeft: 24, image_path: images.rice },
  { shopId: veggieId, shopName: 'Lusaka Veggie Market', food_name: 'Fresh Milk (1L)', description: 'Chilled 1L milk, best before tomorrow.', category: 'Drinks', original_price: 18.00, discounted_price: 12.00, quantity: 20, hoursOld: 2, hoursLeft: 12, image_path: images.milk },
  { shopId: grillId, shopName: 'Chanda Chicken Grill', food_name: 'Grilled Chicken Family Pack', description: 'Half chicken + chips + drink. Visible after approval.', category: 'Meals', original_price: 180.00, discounted_price: 120.00, quantity: 5, hoursOld: 1, hoursLeft: 30, image_path: images.chicken }
];

const dealIds = {};
for (const deal of DEALS) dealIds[deal.food_name] = ensureDeal(deal.shopId, deal);

// ---------------------------------------------------------------------------
// Idempotent demo refresh: expired demo listings (only shops seeded by this
// script — emails @example.com) with stock remaining are revived with a fresh
// window so the marketplace always shows live deals at presentation time.
// Genuine user data and deliberately expired/sold-out/paused examples are
// never touched; hosting the same rule for the hosted DB is a separate,
// approval-gated proposal (see DEMO_REFRESH_PROPOSAL.sql).
// ---------------------------------------------------------------------------
const revived = db.prepare(`
  UPDATE deals
  SET status = 'active',
      expires_at = ?,
      updated_at = ?
  WHERE status = 'expired'
    AND quantity_remaining > 0
    AND shop_id IN (SELECT id FROM shops WHERE email LIKE '%@example.com')
`).run(new Date(Date.now() + 6 * 3600 * 1000).toISOString(), nowIso());
if (revived.changes > 0) console.log(`  refresh: ${revived.changes} expired demo listing(s) revived with a fresh 6h window.`);

// A sold-out demo listing (stock 0 / sold 0 remaining) so admins see the state.
const soldOutExisting = db.prepare("SELECT id FROM deals WHERE shop_id = ? AND food_name = 'Daily Soup Special'").get(bakedId);
if (!soldOutExisting && DEALS.length) {
  const id = makeId('deal');
  const discount = Math.round(((40.00 - 25.00) / 40.00) * 100);
  db.prepare(`INSERT INTO deals (id, shop_id, shop_name, food_name, description, category, original_price, discounted_price, discount_percentage, quantity, quantity_remaining, image_url, image_path, created_at, expires_at, pickup_window_start, pickup_window_end, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, '10:00', '18:00', ?)`)
    .run(id, bakedId, "Mama Chanda's Bakery", 'Daily Soup Special', 'Sold out demo listing — shows the sold-out state.', 'Meals', 40.00, 25.00, discount, 8, 0, images.bread, nowIso(), new Date(Date.now() + 10 * 3600 * 1000).toISOString(), 'sold_out');
  console.log('  deal: Daily Soup Special (sold_out)');
}

ensureReview(customerId, dealIds['Fresh Bread Loaves'], bakedId, 5, 'Bread was fresh and cheap — great initiative!');
ensureReview(customerId2, dealIds['Mixed Vegetable Basket'], veggieId, 4, 'Big basket for the price. Will come again.');
ensureReview(customerId, dealIds['Seasonal Fruit Tray'], veggieId, 5, 'Mangoes were sweet. Pickup took two minutes.');

ensureAnnouncement('Welcome to Bite For Less', 'Rescue surplus food at fair prices — reserve online, pay at pickup.');

console.log('Seed complete (existing data preserved).');
process.exit(0);
