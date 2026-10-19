// Vendor onboarding + uploads + favorites/notifications/categories integration.
// Isolated temp database + throwaway server on port 5002 — never touches
// backend/data/biteforless.db. DATABASE_URL is set BEFORE any db-touching
// module loads (ESM static-import hoisting fixed earlier — keep this order).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import bcrypt from 'bcryptjs';

const TEST_PORT = 5002;
const TEST_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bfl-onboard-')), 'test.db');
process.env.DATABASE_URL = `sqlite:${TEST_DB}`;

const { default: db } = await import('../config/db.js');
const { makeId } = await import('../utils/helpers.js');

let server;
const BASE = `http://localhost:${TEST_PORT}`;
const uploadedSpills = []; // /uploads/products files created here — cleaned in after()

async function api(method, url, { token, body, expect, multipart } = {}) {
  const headers = {};
  let payload;
  if (multipart instanceof FormData) {
    payload = multipart;
  } else {
    headers['Content-Type'] = 'application/json';
    payload = body ? JSON.stringify(body) : undefined;
  }
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${url}`, { method, headers, body: payload });
  const json = await res.json().catch(() => ({}));
  if (expect && res.status !== expect) {
    throw new Error(`expected ${expect}, got ${res.status}: ${url} → ${JSON.stringify(json).slice(0, 240)}`);
  }
  return { status: res.status, payload: json };
}

const future = (ms) => new Date(Date.now() + ms).toISOString();
// 1x1 red PNG — real magic bytes so the server's sniff accepts it.
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

let admin;
let vendorToken;

before(async () => {
  // Fresh temp DB: seed the PLATFORM ADMIN directly (same shape as seed.js).
  const adminHash = await bcrypt.hash('admin123', 4);
  db.prepare('INSERT INTO users (id, name, email, phone, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(makeId('user'), 'Platform Admin', 'admin@biteforless.test', '+260 96 000 0000', adminHash, 'admin', 'active');

  server = spawn(process.execPath, ['backend/server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(TEST_PORT), DATABASE_URL: `sqlite:${TEST_DB}` },
    stdio: 'ignore'
  });
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) break;
    } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  const { payload } = await api('POST', '/api/auth/admin/login', {
    body: { email: 'admin@biteforless.test', password: 'admin123' },
    expect: 200
  });
  admin = payload;
});

after(async () => {
  server?.kill();
  await new Promise((r) => setTimeout(r, 500));
  // Clean image spills from the shared uploads dir (products/ is gitignored).
  for (const rel of uploadedSpills) {
    const abs = path.join(process.cwd(), rel.replace('/uploads/', 'backend/uploads/').replace(/\//g, path.sep));
    try { fs.unlinkSync(abs); } catch { /* already gone */ }
  }
  try { db.close(); } catch { /* ok */ }
  fs.rmSync(path.dirname(TEST_DB), { recursive: true, force: true });
});

test('canonical onboarding: six-step payload → pending shop + pending owner', async () => {
  const payloadBody = {
    owner_name: 'Nchimunya Mwale',
    shop_name: 'Kabwe Street Kitchen',
    email: 'owner-onboard@bfl.test',
    phone: '+260 97 700 0102',
    whatsapp_number: '+260 97 700 0102',
    business_type: 'Meals',
    description: 'Home-style nshima meals surplus from the lunch window.',
    address: 'Plot 84 Church Road, Kabwe',
    city: 'Kabwe',
    area: 'Town Centre',
    opening_hours: 'Mon–Fri 09:00–18:00',
    pickup_instructions: 'Knock at the back kitchen door.',
    pickup_window_start: '15:00',
    pickup_window_end: '18:30',
    password: 'safepass9',
    agree_terms: true
  };
  const missingAgree = await api('POST', '/api/vendors/register', { body: { ...payloadBody, agree_terms: false }, expect: 400 });
  assert.ok(missingAgree.payload.message.includes('agree'));
  await api('POST', '/api/vendors/register', {
    body: { ...payloadBody, password: 'short' },
    expect: 400
  });
  const created = await api('POST', '/api/vendors/register', { body: payloadBody, expect: 201 });
  assert.equal(created.payload.user.role, 'shop_owner');
  assert.equal(created.payload.user.status, 'pending');
  vendorToken = created.payload.token;
  await api('POST', '/api/vendors/register', { body: payloadBody, expect: 409 });

  const { payload: me } = await api('GET', '/api/vendors/me', { token: vendorToken, expect: 200 });
  assert.equal(me.shop.status, 'pending');
  assert.equal(me.shop.city, 'Kabwe');
});

test('pending vendor cannot publish listings (approval gate)', async () => {
  const res = await api('POST', '/api/deals', {
    token: vendorToken,
    body: { food_name: 'Solo Nshima', category: 'Meals', original_price: 15, discounted_price: 8, quantity: 4, expires_at: future(3 * 3600e3) },
    expect: 403
  });
  assert.ok(res.payload.message.includes('approved'));
});

test('admin approves; pending owner becomes active; dashboard unlocked', async () => {
  const { payload } = await api('GET', '/api/admin/vendors?status=pending', { token: admin.token, expect: 200 });
  const vendor = payload.vendors.find((v) => v.email === 'owner-onboard@bfl.test');
  assert.ok(vendor, 'pending application listed');
  const ownerBefore = db.prepare('SELECT status FROM users WHERE email = ?').get('owner-onboard@bfl.test');
  assert.equal(ownerBefore.status, 'pending');
  await api('PATCH', `/api/admin/vendors/${vendor.id}/status`, { token: admin.token, body: { status: 'suspended' }, expect: 200 });
  await api('PATCH', `/api/admin/vendors/${vendor.id}/status`, { token: admin.token, body: { status: 'approved' }, expect: 200 });
  const afterRow = db.prepare('SELECT status, id FROM shops WHERE id = ?').get(vendor.id);
  assert.equal(afterRow.status, 'approved');
  const ownerAfter = db.prepare('SELECT id, status FROM users WHERE email = ?').get('owner-onboard@bfl.test');
  assert.equal(ownerAfter.status, 'active');

  const { payload: dash } = await api('GET', '/api/vendors/me/dashboard', { token: vendorToken, expect: 200 });
  assert.equal(dash.shop.id, vendor.id);
  assert.equal(dash.counts.listings_total, 0);
  const { payload: alias } = await api('GET', '/api/vendors/dashboard', { token: vendorToken, expect: 200 });
  assert.equal(alias.shop.id, vendor.id);
});

test('approved vendor uploads a REAL image with the listing; spoofed file is rejected', async () => {
  // Real PNG magic bytes must pass.
  const good = new FormData();
  good.append('food_name', 'Evening Nshima Plates');
  good.append('shop_name', 'Kabwe Street Kitchen');
  good.append('category', 'Meals');
  good.append('original_price', '20');
  good.append('discounted_price', '12');
  good.append('quantity', '6');
  good.append('expires_at', future(5 * 3600e3));
  good.append('description', 'Surplus nshima meals.');
  good.append('image', new Blob([PNG_BYTES], { type: 'image/png' }), 'dish.png');
  const created = await api('POST', '/api/deals', { token: vendorToken, expect: 201, multipart: good });
  assert.ok(created.payload.deal.id);
  assert.match(String(created.payload.deal.image_path || ''), /^\/uploads\/products\/[a-f0-9]+\.png$/);
  uploadedSpills.push(created.payload.deal.image_path);
  assert.ok(fs.existsSync(path.join(process.cwd(), 'backend', 'uploads', 'products', path.basename(created.payload.deal.image_path))));

  // Spoofed text claiming to be a PNG must fail magic-byte sniffing.
  const spoof = new FormData();
  spoof.append('food_name', 'Fake Meal');
  spoof.append('shop_name', 'Kabwe Street Kitchen');
  spoof.append('category', 'Other');
  spoof.append('original_price', '10');
  spoof.append('discounted_price', '5');
  spoof.append('quantity', '1');
  spoof.append('expires_at', future(2 * 3600e3));
  spoof.append('image', new Blob(['#!/bin/sh echo deleted'.toString('binary')], { type: 'image/png' }), 'evil.png');
  await api('POST', '/api/deals', { token: vendorToken, expect: 400, multipart: spoof });

  // >5MB is rejected by the multer cap.
  const big = new FormData();
  big.append('food_name', 'Too Big');
  big.append('shop_name', 'Kabwe Street Kitchen');
  big.append('category', 'Other');
  big.append('original_price', '10');
  big.append('discounted_price', '5');
  big.append('quantity', '1');
  big.append('expires_at', future(2 * 3600e3));
  big.append('image', new Blob([Buffer.alloc(6 * 1024 * 1024, 7)], { type: 'image/png' }), 'big.png');
  await api('POST', '/api/deals', { token: vendorToken, expect: 400, multipart: big });
});

test('favorites are idempotent and removable; saved deals join the dashboard', async () => {
  const { payload: customer } = await api('POST', '/api/auth/register', {
    body: { name: 'Reg Saver', email: 'saver@bfl.test', phone: '+260 97 700 9999', password: 'password123' },
    expect: 201
  });
  await api('POST', '/api/deals', {
    token: vendorToken,
    body: { food_name: 'Morning Bread Baskets', shop_name: 'Kabwe Street Kitchen', category: 'Bakery', original_price: 25, discounted_price: 15, quantity: 8, expires_at: future(6 * 3600e3) },
    expect: 201
  });
  const { payload: mine } = await api('GET', '/api/deals/mine', { token: vendorToken, expect: 200 });
  const target = mine.deals[0];
  assert.ok(target);

  const add = await api('POST', '/api/favorites', { token: customer.token, body: { deal_id: target.id }, expect: 201 });
  assert.equal(add.payload.favorited, true);
  const again = await api('POST', '/api/favorites', { token: customer.token, body: { deal_id: target.id }, expect: 200 });
  assert.equal(again.payload.favorited, true);
  const { payload: list } = await api('GET', '/api/favorites', { token: customer.token, expect: 200 });
  assert.equal(list.favorites.length, 1);
  assert.equal(list.favorites[0].food_name, target.food_name);
  await api('DELETE', `/api/favorites/${target.id}`, { token: customer.token, expect: 200 });
  const { payload: afterRemove } = await api('GET', '/api/favorites', { token: customer.token, expect: 200 });
  assert.equal(afterRemove.favorites.length, 0);
});

test('announcement fan-out creates notifications; read + read-all work', async () => {
  await api('POST', '/api/admin/announcements', {
    token: admin.token,
    body: { title: 'Onboarding wave', body: 'New vendors approved this week — welcome!', audience: 'shop_owners' },
    expect: 201
  });
  const { payload: inbox } = await api('GET', '/api/notifications', { token: vendorToken, expect: 200 });
  const announcementCopy = inbox.notifications.find((n) => n.title.includes('Onboarding wave'));
  assert.ok(announcementCopy, 'owner received the announcement');
  assert.equal(inbox.unread > 0, true);
  await api('PATCH', `/api/notifications/${announcementCopy.id}/read`, { token: vendorToken, expect: 200 });
  await api('POST', '/api/notifications/read-all', { token: vendorToken, expect: 200 });
  const { payload: inbox2 } = await api('GET', '/api/notifications', { token: vendorToken, expect: 200 });
  assert.equal(inbox2.unread, 0);
});

test('category management: create, duplicate rejection, deactivate + admin-only visibility', async () => {
  await api('POST', '/api/categories', { token: admin.token, body: { name: 'Street Food' }, expect: 201 });
  await api('POST', '/api/categories', { token: admin.token, body: { name: 'street food' }, expect: 409 });
  const { payload: adminList } = await api('GET', '/api/categories?all=1', { token: admin.token, expect: 200 });
  const target = adminList.categories.find((c) => c.name === 'Street Food');
  assert.equal(target.status, 'active');
  await api('PATCH', `/api/categories/${target.id}`, { token: admin.token, body: { status: 'inactive' }, expect: 200 });
  const { payload: publicList } = await api('GET', '/api/categories', { expect: 200 });
  assert.equal(publicList.categories.find((c) => c.name === 'Street Food'), undefined);
  const { payload: adminList2 } = await api('GET', '/api/categories?all=1', { token: admin.token, expect: 200 });
  assert.equal(adminList2.categories.find((c) => c.name === 'Street Food').status, 'inactive');
  await api('PATCH', `/api/categories/${target.id}`, { token: admin.token, body: { status: 'active' }, expect: 200 });
});

test('suspension pauses active listings immediately (admin path)', async () => {
  const { payload: vendors } = await api('GET', '/api/admin/vendors?status=approved', { token: admin.token, expect: 200 });
  const vendor = vendors.vendors.find((v) => v.email === 'owner-onboard@bfl.test');
  await api('PATCH', `/api/admin/vendors/${vendor.id}/status`, { token: admin.token, body: { status: 'suspended' }, expect: 200 });
  const rows = db.prepare('SELECT status FROM deals WHERE shop_id = ?').all(vendor.id);
  assert.ok(rows.length >= 1);
  assert.ok(rows.every((r) => r.status !== 'active'), 'no active listings remain after suspension');
  // Locked-out vendor: suspended shop blocks reservation-driven POST /deals too.
  const res = await api('POST', '/api/deals', {
    token: vendorToken,
    body: { food_name: 'Blocked', category: 'Other', original_price: 9, discounted_price: 5, quantity: 1, expires_at: future(3600e3) },
    expect: 403
  });
  assert.ok(res.payload.message.includes('approved'));
});
