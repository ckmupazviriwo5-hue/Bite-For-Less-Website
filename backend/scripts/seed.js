import bcrypt from 'bcryptjs';
import db from '../config/db.js';
import { config } from '../config/env.js';
import { makeId } from '../utils/helpers.js';

const adminId = makeId('admin');
const hash = await bcrypt.hash(config.adminPassword, 10);

const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(config.adminEmail);
if (!existing) {
  db.prepare(`INSERT INTO users (id, name, email, phone, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    adminId,
    'Platform Admin',
    config.adminEmail,
    '+0000000000',
    hash,
    'admin',
    'active'
  );
}

const exampleUser = db.prepare('SELECT id FROM users WHERE email = ?').get('customer@example.com');
if (!exampleUser) {
  db.prepare(`INSERT INTO users (id, name, email, phone, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    makeId('customer'),
    'Customer Demo',
    'customer@example.com',
    '+123456789',
    await bcrypt.hash('password123', 10),
    'customer',
    'active'
  );
}

const shopOwnerId = makeId('shopowner');
const shopOwner = db.prepare('SELECT id FROM users WHERE email = ?').get('shopowner@example.com');
if (!shopOwner) {
  db.prepare(`INSERT INTO users (id, name, email, phone, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    shopOwnerId,
    'Shop Owner Demo',
    'shopowner@example.com',
    '+987654321',
    await bcrypt.hash('password123', 10),
    'shop_owner',
    'active'
  );

  const shopId = makeId('shop');
  db.prepare('INSERT INTO shops (id, owner_id, name, email, phone, address, city, business_info, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(shopId, shopOwnerId, 'Sunrise Bakery', 'shopowner@example.com', '+987654321', '123 Main Street', 'Lusaka', 'Fresh breads and pastries rescued daily.', 'approved');

  db.prepare(`INSERT INTO deals (id, shop_id, shop_name, food_name, description, category, original_price, discounted_price, discount_percentage, quantity, quantity_remaining, image_url, created_at, expires_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      makeId('deal'),
      shopId,
      'Sunrise Bakery',
      'Fresh Baguettes',
      'Perfect for soup or breakfast.',
      'Bakery',
      18,
      7,
      61,
      10,
      10,
      'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=700&q=80',
      new Date().toISOString(),
      new Date(Date.now() + 1000 * 60 * 90).toISOString(),
      'active'
    );
}

console.log('Seed completed.');
process.exit(0);
