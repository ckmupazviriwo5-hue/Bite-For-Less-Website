// Pure helper tests — still isolated: helpers.js imports config/db.js, so the
// temp DATABASE_URL must be set BEFORE that module graph is loaded (ESM static
// imports are hoisted; see PROJECT_AUDIT.md). bcrypt-free, no HTTP server.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATABASE_URL = `sqlite:${path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bfl-core-')), 'test.db')}`;

const { calculateDiscount, generateReservationCode, generatePickupPin } = await import('../utils/helpers.js');
const { validateDealInput } = await import('../utils/validation.js');

test('calculateDiscount returns percent from original and sale price', () => {
  assert.equal(calculateDiscount(100, 60), 40);
  assert.equal(calculateDiscount(50, 50), 0);
});

test('validateDealInput rejects invalid deal values', () => {
  const invalid = validateDealInput({
    food_name: 'Bread',
    shop_name: 'Bakery',
    category: 'Bakery',
    original_price: 10,
    discounted_price: 12,
    quantity: 0,
    expires_at: new Date(Date.now() - 1000).toISOString()
  });

  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.length > 0);
});

test('generateReservationCode and generatePickupPin produce valid values', () => {
  const code = generateReservationCode();
  const pin = generatePickupPin();

  assert.match(code, /^BFL-[A-F0-9]+$/);
  assert.equal(pin.length, 4);
  assert.ok(!Number.isNaN(Number(pin)));
});
