import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDiscount, generateReservationCode, generatePickupPin } from '../utils/helpers.js';
import { validateDealInput } from '../utils/validation.js';

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
