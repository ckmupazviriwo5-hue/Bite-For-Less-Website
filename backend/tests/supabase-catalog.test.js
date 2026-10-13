// Supabase catalog adapter regression tests (pure functions, no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeListing, isBookable, eligibilityState, eligibilityLabel,
  productImage, toISODate, PRODUCT_IMAGES, GENERIC_FOOD_IMAGE
} from '../../frontend/js/supabase-catalog.js';
import { formatZMW, discountPct, countdown, esc } from '../../frontend/js/api.js';

const NOW = new Date('2026-10-13T20:00:00Z').getTime();
const row = (over = {}) => ({
  id: 'l1', name: 'Sourdough', description: 'd', original_price: 60,
  discounted_price: 29, stock: 8, location: 'Matero, Lusaka',
  deadline: '2026-10-14T01:00:00+00:00', collection_window: 'w',
  status: 'active', category_id: 'bakery', image_url: null, is_demo: true,
  vendors: { name: 'Mama Chanda', status: 'approved' },
  categories: { name: 'Bakery' },
  ...over
});

test('normalizeListing maps Supabase row to website deal model', () => {
  const d = normalizeListing(row());
  assert.equal(d.food_name, 'Sourdough');
  assert.equal(d.shop_name, 'Mama Chanda');
  assert.equal(d.quantity_remaining, 8);
  assert.equal(d.quantity, 8);
  assert.equal(d.expires_at, '2026-10-14T01:00:00+00:00');
  assert.equal(d.category, 'Bakery');
  assert.equal(d.discount_percentage, 52);
  assert.equal(d.is_demo, true);
});

test('eligibility: bookable vs soldout vs expired vs paused', () => {
  assert.equal(eligibilityState(normalizeListing(row()), NOW), 'bookable');
  assert.ok(isBookable(normalizeListing(row()), NOW));
  assert.equal(eligibilityState(normalizeListing(row({ stock: 0 })), NOW), 'soldout');
  assert.equal(
    eligibilityState(normalizeListing(row({ deadline: '2026-10-13T19:00:00+00:00' })), NOW),
    'expired'
  );
  assert.equal(eligibilityState(normalizeListing(row({ status: 'inactive' })), NOW), 'paused');
  assert.equal(
    eligibilityState(normalizeListing(row({ vendors: { name: 'X', status: 'suspended' } })), NOW),
    'paused'
  );
  assert.equal(eligibilityState(null, NOW), 'missing');
  for (const s of ['bookable', 'soldout', 'expired', 'paused']) {
    void s;
  }
  assert.equal(eligibilityLabel(normalizeListing(row()), NOW), 'Available for reservation');
  assert.equal(eligibilityLabel(normalizeListing(row({ stock: 0 })), NOW), 'Sold out');
});

test('productImage: listing photo, then category, then generic; never empty', () => {
  assert.ok(PRODUCT_IMAGES.l1.startsWith('https://images.unsplash.com/'));
  assert.equal(Object.keys(PRODUCT_IMAGES).length, 12);
  assert.equal(productImage({ id: 'l1', category: 'Bakery' }), PRODUCT_IMAGES.l1);
  assert.equal(
    productImage({ id: 'unknown', category: 'Bakery' }),
    PRODUCT_IMAGES.l1 // Bakery category fallback
  );
  assert.equal(productImage({ id: 'unknown', category: 'Nope' }), GENERIC_FOOD_IMAGE);
  assert.equal(productImage({ image_url: 'https://x/y.jpg' }), 'https://x/y.jpg');
});

test('toISODate normalizes transport variants and rejects garbage', () => {
  assert.equal(toISODate('2026-10-14T01:27:57.268916+00:00'), '2026-10-14T01:27:57.268916+00:00');
  assert.equal(toISODate('2026-10-14 01:27:57.268916+00'), '2026-10-14T01:27:57.268916+00:00');
  assert.equal(toISODate(null), null);
  assert.equal(toISODate('not-a-date'), null);
});

test('price formatting is ZMW and discount math is consistent', () => {
  const formatted = formatZMW(29);
  assert.match(formatted, /29(\.00)?/);
  assert.ok(!formatted.startsWith('R'));
  assert.equal(discountPct(60, 29), 52);
  assert.equal(discountPct(50, 50), 0);
});

test('countdown and esc behave safely', () => {
  assert.equal(countdown(new Date(Date.now() + 7200e3).toISOString()), '2h 0m left');
  assert.equal(countdown(new Date(NOW - 1000).toISOString()), 'Expired');
  assert.equal(countdown(null), 'Expired');
  assert.equal(esc('<b>"x"&'), '&lt;b&gt;&quot;x&quot;&amp;');
});
