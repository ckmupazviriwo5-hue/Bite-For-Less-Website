// Workflow integration tests — run against an ISOLATED temp database + throwaway
// server on port 5001. Never touches backend/data/biteforless.db or :5000.
//
// IMPORTANT: DATABASE_URL is set BEFORE loading any module that imports
// config/db.js. Static ESM imports are hoisted above module code, so a static
// `import ... helpers.js` here would open the REAL database before the env
// override runs (bug fixed 2026-10; see PROJECT_AUDIT.md). All db-touching
// modules therefore load dynamically after the env is set.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import bcrypt from 'bcryptjs';

const TEST_PORT = 5001;
const TEST_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bfl-test-')), 'test.db');
process.env.DATABASE_URL = `sqlite:${TEST_DB}`;

const { default: db } = await import('../config/db.js');
const { makeId } = await import('../utils/helpers.js');

let server;
const BASE = `http://localhost:${TEST_PORT}`;

async function api(method, url, { token, body, expect } = {}) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await res.json().catch(() => ({}));
  if (expect !== undefined) assert.equal(res.status, expect, `${method} ${url} -> ${res.status} ${JSON.stringify(payload)}`);
  return { status: res.status, payload };
}

const future = (ms) => new Date(Date.now() + ms).toISOString();
const ids = {};
const tokens = {};

async function login(email, password, expect = 200) {
  const { payload } = await api('POST', '/api/auth/login', { body: { email, password }, expect });
  return payload.token;
}

before(async () => {
  const password_hash = await bcrypt.hash('pass1234', 4);
  const adminHash = await bcrypt.hash('admin123', 4);
  const now = new Date().toISOString();
  const addUser = (id, name, email, role) =>
    db.prepare('INSERT INTO users (id, name, email, phone, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, name, email, '+260000000', role === 'admin' ? adminHash : password_hash, role, 'active');
  addUser(ids.admin = makeId('u'), 'Admin', 'admin@bfl.test', 'admin');
  addUser(ids.custA = makeId('u'), 'Cust A', 'custa@bfl.test', 'customer');
  addUser(ids.custB = makeId('u'), 'Cust B', 'custb@bfl.test', 'customer');
  addUser(ids.owner1 = makeId('u'), 'Owner One', 'owner1@bfl.test', 'shop_owner');
  addUser(ids.owner2 = makeId('u'), 'Owner Two', 'owner2@bfl.test', 'shop_owner');
  const addShop = (id, owner, name, status) =>
    db.prepare('INSERT INTO shops (id, owner_id, name, email, phone, address, city, business_info, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, owner, name, `${name}@bfl.test`, '+260', 'Lusaka', 'Lusaka', 'demo', status);
  addShop(ids.shop1 = makeId('s'), ids.owner1, 'Shop One', 'approved');
  addShop(ids.shop2 = makeId('s'), ids.owner2, 'Shop Two', 'approved');
  const addDeal = (id, shopId, shopName, qty, remaining, expires, status = 'active') =>
    db.prepare(`INSERT INTO deals (id, shop_id, shop_name, food_name, description, category, original_price, discounted_price, discount_percentage, quantity, quantity_remaining, image_url, created_at, expires_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, shopId, shopName, 'Food ' + id.slice(-4), 'desc', 'Bakery', 20, 8, 60, qty, remaining, '', now, expires, status);
  addDeal(ids.deal = makeId('d'), ids.shop1, 'Shop One', 3, 3, future(2 * 3600e3));
  addDeal(ids.expiredDeal = makeId('d'), ids.shop1, 'Shop One', 5, 5, new Date(Date.now() - 3600e3).toISOString());

  server = spawn(process.execPath, ['backend/server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(TEST_PORT), DATABASE_URL: `sqlite:${TEST_DB}` },
    stdio: 'ignore'
  });
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) break;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  const health = await (await fetch(`${BASE}/api/health`)).json();
  assert.equal(health.success, true);

  tokens.admin = await login('admin@bfl.test', 'admin123');
  tokens.custA = await login('custa@bfl.test', 'pass1234');
  tokens.custB = await login('custb@bfl.test', 'pass1234');
  tokens.owner1 = await login('owner1@bfl.test', 'pass1234');
  tokens.owner2 = await login('owner2@bfl.test', 'pass1234');
});

after(async () => {
  server?.kill();
  await new Promise((r) => setTimeout(r, 500));
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(path.dirname(TEST_DB), { recursive: true, force: true });
});

// ---------- customer workflows (§1) ----------

test('deal listing shows active deals and detail works; missing deal 404s', async () => {
  const { payload } = await api('GET', '/api/deals', { expect: 200 });
  assert.ok(payload.deals.some((d) => d.id === ids.deal));
  assert.ok(!payload.deals.some((d) => d.id === ids.expiredDeal));
  const one = await api('GET', `/api/deals/${ids.deal}`, { expect: 200 });
  assert.equal(typeof one.payload.deal.discounted_price, 'number');
  await api('GET', '/api/deals/deal_missing', { expect: 404 });
});

test('login rejects bad credentials; protected routes reject anonymouscallers', async () => {
  await api('POST', '/api/auth/login', { body: { email: 'custa@bfl.test', password: 'wrong' }, expect: 401 });
  await api('GET', '/api/reservations', { expect: 401 });
  await api('POST', '/api/deals', { body: {}, expect: 401 });
});

test('reserve with sufficient stock decrements exactly once', async () => {
  const { payload } = await api('POST', '/api/reservations', {
    token: tokens.custA, body: { deal_id: ids.deal, quantity: 2 }, expect: 201
  });
  ids.res1 = payload.reservation.id;
  assert.equal(payload.reservation.quantity, 2);
  assert.equal(payload.reservation.status, 'reserved');
  const deal = (await api('GET', `/api/deals/${ids.deal}`, { expect: 200 })).payload.deal;
  assert.equal(deal.quantity_remaining, 1);
});

test('reserve rejects insufficient stock and invalid quantities', async () => {
  await api('POST', '/api/reservations', { token: tokens.custA, body: { deal_id: ids.deal, quantity: 5 }, expect: 400 });
  await api('POST', '/api/reservations', { token: tokens.custA, body: { deal_id: ids.deal, quantity: 0 }, expect: 400 });
  await api('POST', '/api/reservations', { token: tokens.custA, body: { deal_id: ids.deal, quantity: -2 }, expect: 400 });
  await api('POST', '/api/reservations', { token: tokens.custA, body: { deal_id: ids.deal, quantity: 'abc' }, expect: 400 });
  await api('POST', '/api/reservations', { token: tokens.custA, body: { deal_id: 'deal_missing', quantity: 1 }, expect: 404 });
  const deal = (await api('GET', `/api/deals/${ids.deal}`, { expect: 200 })).payload.deal;
  assert.equal(deal.quantity_remaining, 1, 'failed reservations must not move stock');
});

test('expired deal reservation is rejected and deal marked expired', async () => {
  await api('POST', '/api/reservations', { token: tokens.custA, body: { deal_id: ids.expiredDeal, quantity: 1 }, expect: 400 });
  const row = db.prepare('SELECT status FROM deals WHERE id = ?').get(ids.expiredDeal);
  assert.equal(row.status, 'expired');
});

test('cancel restores stock exactly once; repeat cancel is rejected', async () => {
  await api('POST', `/api/reservations/${ids.res1}/cancel`, { token: tokens.custA, expect: 200 });
  let deal = (await api('GET', `/api/deals/${ids.deal}`, { expect: 200 })).payload.deal;
  assert.equal(deal.quantity_remaining, 3);
  await api('POST', `/api/reservations/${ids.res1}/cancel`, { token: tokens.custA, expect: 400 });
  deal = (await api('GET', `/api/deals/${ids.deal}`, { expect: 200 })).payload.deal;
  assert.equal(deal.quantity_remaining, 3, 'repeat cancel must not restore twice');
});

test('verify completes pickup; repeat verify rejected; cancel-after-collect rejected', async () => {
  const made = await api('POST', '/api/reservations', { token: tokens.custA, body: { deal_id: ids.deal, quantity: 1 }, expect: 201 });
  const res = made.payload.reservation;
  await api('POST', `/api/reservations/${res.id}/verify`, { token: tokens.owner1, body: { pickup_pin: 'WRONG' }, expect: 401 });
  await api('POST', `/api/reservations/${res.id}/verify`, { token: tokens.owner1, body: { pickup_pin: res.pickup_pin }, expect: 200 });
  await api('POST', `/api/reservations/${res.id}/verify`, { token: tokens.owner1, body: { pickup_pin: res.pickup_pin }, expect: 400 });
  await api('POST', `/api/reservations/${res.id}/cancel`, { token: tokens.custA, expect: 400 });
  const deal = (await api('GET', `/api/deals/${ids.deal}`, { expect: 200 })).payload.deal;
  assert.equal(deal.quantity_remaining, 2, 'collect must never restore stock');
});

test('reservation ownership is enforced', async () => {
  const made = await api('POST', '/api/reservations', { token: tokens.custA, body: { deal_id: ids.deal, quantity: 1 }, expect: 201 });
  const id = made.payload.reservation.id;
  await api('GET', `/api/reservations/${id}`, { token: tokens.custB, expect: 403 });
  await api('POST', `/api/reservations/${id}/cancel`, { token: tokens.custB, expect: 403 });
  await api('POST', `/api/reservations/${id}/cancel`, { token: tokens.admin, expect: 200 });
});

// ---------- vendor + admin workflows (§2) ----------

test('vendor creates, edits own deal; cannot touch other vendor deals', async () => {
  const created = await api('POST', '/api/deals', {
    token: tokens.owner1,
    body: { food_name: 'Buns', shop_name: 'Shop One', category: 'Bakery', original_price: 10, discounted_price: 4, quantity: 6, expires_at: future(3600e3) },
    expect: 201
  });
  ids.vendorDeal = created.payload.deal.id;
  await api('POST', '/api/deals', {
    token: tokens.owner1,
    body: { food_name: 'Bad', shop_name: 'Shop One', category: 'Bakery', original_price: 4, discounted_price: 10, quantity: 6, expires_at: future(3600e3) },
    expect: 400
  });
  await api('PUT', `/api/deals/${ids.vendorDeal}`, { token: tokens.owner2, body: { food_name: 'Hijack' }, expect: 403 });
  await api('PUT', `/api/deals/${ids.vendorDeal}`, { token: tokens.owner1, body: { discounted_price: 99 }, expect: 400 });
  const updated = await api('PUT', `/api/deals/${ids.vendorDeal}`, { token: tokens.owner1, body: { food_name: 'Buns Deluxe' }, expect: 200 });
  assert.equal(updated.payload.deal.food_name, 'Buns Deluxe');
  await api('PUT', '/api/deals/deal_missing', { token: tokens.owner1, body: { food_name: 'x' }, expect: 404 });
});

test('vendor deactivates listing; vendor sees own-shop reservations', async () => {
  await api('DELETE', `/api/deals/${ids.vendorDeal}`, { token: tokens.owner2, expect: 403 });
  await api('DELETE', `/api/deals/${ids.vendorDeal}`, { token: tokens.owner1, expect: 200 });
  const row = db.prepare('SELECT status FROM deals WHERE id = ?').get(ids.vendorDeal);
  assert.equal(row.status, 'cancelled');
  const list = await api('GET', '/api/shops/me/reservations', { token: tokens.owner1, expect: 200 });
  assert.ok(Array.isArray(list.payload.reservations));
  assert.ok(list.payload.reservations.every((r) => r.shop_id === ids.shop1));
  await api('GET', '/api/shops/me/reservations', { expect: 401 });
});

test('shop profile endpoint resolves the right record', async () => {
  const me = await api('GET', '/api/shops/me', { token: tokens.owner1, expect: 200 });
  assert.equal(me.payload.shop.id, ids.shop1);
});

test('admin stats require admin; vendor apply + approve/reject/suspend flow works', async () => {
  await api('GET', '/api/admin/statistics', { expect: 401 });
  await api('GET', '/api/admin/statistics', { token: tokens.custA, expect: 403 });
  const stats = await api('GET', '/api/admin/statistics', { token: tokens.admin, expect: 200 });
  assert.equal(typeof stats.payload.statistics.users_total, 'number');

  // Guest/top-level application route (legacy alias) creates a pending shop.
  const applied = await api('POST', '/api/shops/apply', {
    body: { shop_name: 'New Shop', owner_name: 'New Owner', email: 'newshop@bfl.test', phone: '+260', address: 'Cairo Rd', business_info: 'demo' },
    expect: 201
  });
  assert.equal(applied.payload.success, true);
  await api('POST', '/api/shops/apply', {
    body: { shop_name: 'Dup', owner_name: 'X', email: 'newshop@bfl.test', phone: '+260', address: 'Y' },
    expect: 409
  });

  // Canonical contract: GET /api/admin/vendors, PATCH /api/admin/vendors/:id/status.
  const vendors = (await api('GET', '/api/admin/vendors?status=pending', { token: tokens.admin, expect: 200 })).payload.vendors;
  const pending = vendors.find((a) => a.email === 'newshop@bfl.test');
  assert.ok(pending, 'new application must appear in pending vendors');
  assert.equal(pending.status, 'pending');
  await api('PATCH', `/api/admin/vendors/${pending.id}/status`, { token: tokens.admin, body: { status: 'bogus' }, expect: 400 });
  await api('PATCH', '/api/admin/vendors/shop_missing/status', { token: tokens.admin, body: { status: 'approved' }, expect: 404 });
  await api('PATCH', `/api/admin/vendors/${pending.id}/status`, { token: tokens.admin, body: { status: 'approved' }, expect: 200 });
  assert.equal(db.prepare('SELECT status FROM shops WHERE id = ?').get(pending.id).status, 'approved');
  await api('PATCH', `/api/admin/vendors/${pending.id}/status`, { token: tokens.admin, body: { status: 'suspended' }, expect: 200 });
  const suspended = db.prepare('SELECT status FROM shops WHERE id = ?').get(pending.id);
  assert.equal(suspended.status, 'suspended');
  // Suspension pauses any active listings of that shop immediately.
  await api('GET', '/api/admin/vendors', { token: tokens.custA, expect: 403 });
});
