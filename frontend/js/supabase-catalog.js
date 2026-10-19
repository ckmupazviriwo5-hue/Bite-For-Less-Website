// Bite For Less — public Supabase catalog adapter (read-only storefront).
// Uses the shared Android/Supabase schema: categories, vendors, listings.
// Only the publishable key is used; RLS stays enforced server-side.
// Pure mapping/eligibility helpers are exported for node regression tests.

export function supabaseConfig() {
  const cfg = (typeof window !== 'undefined' && window.BFL_CONFIG) || {};
  const url = (cfg.SUPABASE_URL || '').trim();
  const key = (cfg.SUPABASE_ANON_KEY || '').trim();
  if (!url || !key) {
    throw new Error(
      'Marketplace is not configured yet. The demo catalog cannot load without Supabase settings.'
    );
  }
  return { url: url.replace(/\/$/, ''), key };
}

async function sbGet(path, timeoutMs = 15000) {
  const { url, key } = supabaseConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${url}/rest/v1/${path}`, {
      signal: controller.signal,
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' }
    });
  } catch {
    throw new Error('Cannot reach the marketplace server. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error('Marketplace access was refused. Please try again later.');
  }
  if (res.status === 404) {
    throw new Error('Marketplace endpoint not found. Please try again later.');
  }
  if (!res.ok) {
    throw new Error('The marketplace is temporarily unavailable. Please try again later.');
  }
  try {
    return await res.json();
  } catch {
    throw new Error('The marketplace returned an unreadable response. Please try again later.');
  }
}

// Eligible storefront rows: active + in stock + approved vendor.
// Deadline-freshness is enforced client-side (see isBookable) so the
// storefront never shows an expired listing as reservable.
const LISTING_SELECT =
  'select=*,vendors!inner(name,status),categories(name)' +
  '&status=eq.active&stock=gt.0&vendors.status=eq.approved&order=deadline.asc.nullslast&limit=100';

export async function fetchCatalogRows() {
  const rows = await sbGet(`listings?${LISTING_SELECT}`);
  return Array.isArray(rows) ? rows : [];
}

export async function fetchListingRow(id) {
  const rows = await sbGet(
    `listings?select=*,vendors!inner(name,status),categories(name)&id=eq.${encodeURIComponent(id)}&limit=1`
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('That deal is no longer available. Browse deals for similar pickups.');
  }
  return rows[0];
}

// Verified (HTTP 200, image/jpeg, Oct 2026) Unsplash food photography per
// listing. Unsplash License allows free use; attribution in MEDIA_PLAN.
// image_url stays NULL in the database (unchanged by this fix); the mapping
// below is the presentation fallback chain: listing photo -> category photo
// -> generic. The BFL logo is never used as a dish photo.
const U = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=800&q=70`;

export const PRODUCT_IMAGES = {
  l1: U('photo-1509440159596-0249088772ff'), // sourdough loaves
  l2: U('photo-1555507036-ab1f4038808a'), // butter croissants
  l3: U('photo-1542838132-92c53300491e'), // veggie box
  l4: U('photo-1519996529931-28324d5a630e'), // fruit cups
  l5: U('photo-1585937421612-70a008356fbe'), // chicken curry
  l6: U('photo-1547592180-85f173990554'), // bean stew pot
  l7: U('photo-1607958996333-41aef7caefaa'), // muffins
  l8: U('photo-1509365465985-25d11c17e812'), // cinnamon rolls
  l9: U('photo-1550583724-b2692b85b150'), // fresh milk
  l10: U('photo-1601050690597-df0568f70950'), // samosas
  l11: U('photo-1571212515416-fef01fc43637'), // yoghurt
  l12: U('photo-1600271886742-f049cd451bba') // orange juice
};

export const CATEGORY_IMAGES = {
  Bakery: U('photo-1509440159596-0249088772ff'),
  Produce: U('photo-1542838132-92c53300491e'),
  Dairy: U('photo-1550583724-b2692b85b150'),
  Meals: U('photo-1585937421612-70a008356fbe'),
  Beverages: U('photo-1600271886742-f049cd451bba'),
  Snacks: U('photo-1601050690597-df0568f70950')
};

export const GENERIC_FOOD_IMAGE = U('photo-1547592180-85f173990554');

export function productImage(deal) {
  if (deal && deal.image_url) return deal.image_url;
  if (deal && deal.id && PRODUCT_IMAGES[deal.id]) return PRODUCT_IMAGES[deal.id];
  if (deal && deal.category && CATEGORY_IMAGES[deal.category]) {
    return CATEGORY_IMAGES[deal.category];
  }
  return GENERIC_FOOD_IMAGE;
}

// PostgREST serializes timestamptz as ISO-8601, but some transports render
// a space separator or short zone (`+00`). Normalize once so every
// `new Date(expires_at)` in the UI parses identically across browsers.
export function toISODate(value) {
  if (!value) return null;
  let s = String(value).trim().replace(' ', 'T');
  s = s.replace(/([+-]\d{2})$/, '$1:00');
  return Number.isNaN(new Date(s).getTime()) ? null : s;
}

// Supabase row -> website deal model used by cards + detail page.
export function normalizeListing(row) {
  const vendor = row.vendors || {};
  const category = row.categories || {};
  const original = Number(row.original_price);
  const discounted = Number(row.discounted_price);
  const stock = Math.max(0, Number(row.stock) || 0);
  return {
    id: row.id,
    food_name: row.name || 'Surplus food',
    shop_name: vendor.name || 'Demo vendor',
    description: row.description || '',
    original_price: original,
    discounted_price: discounted,
    discount_percentage: original > 0
      ? Math.max(0, Math.round((1 - discounted / original) * 100))
      : 0,
    // Schema tracks remaining stock only; show it honestly as availability.
    quantity: stock,
    quantity_remaining: stock,
    category: category.name || row.category_id || 'Other',
    image_url: row.image_url || null,
    expires_at: toISODate(row.deadline),
    address: row.location || '',
    city: '',
    collection_window: row.collection_window || '',
    vendor_status: vendor.status || 'unknown',
    listing_status: row.status || 'unknown',
    is_demo: row.is_demo === true
  };
}

export function eligibilityState(deal, now = Date.now()) {
  if (!deal) return 'missing';
  // Both data models must evaluate correctly:
  //  - Supabase rows carry listing_status + vendor_status (RLS-verified).
  //  - Express/SQLite rows carry status and NO vendor_status; the public
  //    catalog endpoint already restricts rows to approved shops, so a missing
  //    vendor_status must NOT fail the check (it would wrongly disable every
  //    express-mode Reserve button).
  const listingActive = (deal.listing_status || deal.status) === 'active';
  const vendorApproved = deal.vendor_status === undefined || deal.vendor_status === null || deal.vendor_status === 'approved';
  if (!listingActive || !vendorApproved) return 'paused';
  if (deal.expires_at && !(new Date(deal.expires_at).getTime() > now)) return 'expired';
  if (!(Number(deal.quantity_remaining) > 0)) return 'soldout';
  return 'bookable';
}

export function isBookable(deal, now = Date.now()) {
  return eligibilityState(deal, now) === 'bookable';
}

export function eligibilityLabel(deal, now = Date.now()) {
  switch (eligibilityState(deal, now)) {
    case 'bookable': return 'Available for reservation';
    case 'soldout': return 'Sold out';
    case 'expired': return 'Collection window passed';
    case 'paused': return 'Temporarily unavailable';
    default: return 'Unavailable';
  }
}
