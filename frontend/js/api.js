// Bite For Less — shared API client (Express REST; Supabase-ready via config).
// Reads window.BFL_CONFIG.API_BASE so the target can move without code edits.
import {
  fetchCatalogRows, fetchListingRow, normalizeListing, isBookable, productImage
} from './supabase-catalog.js';

const backend = () => (window.BFL_CONFIG && window.BFL_CONFIG.DATA_BACKEND) || 'express';
const useSupabase = () => backend() === 'supabase';
export const dataBackend = () => backend();
export const isSupabaseMode = () => useSupabase();
const base = () => (window.BFL_CONFIG && window.BFL_CONFIG.API_BASE) || '/api';

export const tokenStore = {
  get: () => localStorage.getItem('bfl_token') || '',
  set: (t) => localStorage.setItem('bfl_token', t),
  clear: () => localStorage.removeItem('bfl_token')
};

export async function api(path, { method = 'GET', body, auth = false } = {}) {
  if (useSupabase() && method === 'GET') {
    if (path === '/deals') return supabaseDeals();
    const detail = path.match(/^\/deals\/([^/]+)$/);
    if (detail) return supabaseDeal(decodeURIComponent(detail[1]));
  }
  if (useSupabase() && (auth || method !== 'GET')) {
    // Supabase Auth for website accounts is not wired yet: never fake it.
    throw new Error(
      'Accounts and reservations need the legacy local server for now. ' +
      'The live catalog below is real Supabase data.'
    );
  }
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = tokenStore.get();
    if (!token) throw new Error('Please log in to continue.');
    headers.Authorization = `Bearer ${token}`;
  }
  let res;
  try {
    res = await fetch(`${base()}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new Error('Cannot reach the server. Check your connection and try again.');
  }
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.message || `Request failed (${res.status}).`);
  return payload;
}

// Supabase storefront: eligible rows mapped to the website deal model.
// Inactive/sold-out/expired rows never reach the UI as reservable.
async function supabaseDeals() {
  const rows = await fetchCatalogRows();
  const now = Date.now();
  const deals = rows
    .map(normalizeListing)
    .filter((d) => isBookable(d, now))
    .map((d) => ({ ...d, image_url: productImage(d) }));
  return { deals };
}

async function supabaseDeal(id) {
  const deal = normalizeListing(await fetchListingRow(id));
  deal.image_url = productImage(deal);
  // Returned as-is: the detail page renders sold-out/expired/paused states
  // honestly and disables reservation unless bookable (see deal-page.js).
  return { deal };
}

// Trusted role, always from the backend — never from editable client storage.
export async function currentUser() {
  const payload = await api('/auth/me', { auth: true });
  return payload.user;
}

/**
 * Multipart upload helper (image files etc.). Sends FormData exactly as given
 * (never JSON-stringified) with the JSON-compatible error handling of api().
 * Used for product photos, shop logos and covers after the canonical POST
 * /api/vendors/register returns the first session token.
 */
export async function apiUpload(path, formData, { auth = true } = {}) {
  const headers = {};
  if (auth) {
    const token = tokenStore.get();
    if (!token) throw new Error('Please log in to continue.');
    headers.Authorization = `Bearer ${token}`;
  }
  let res;
  try {
    res = await fetch(`${base()}${path}`, { method: 'POST', headers, body: formData });
  } catch {
    throw new Error('Cannot reach the server. Check your connection and try again.');
  }
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.message || `Upload failed (${res.status}).`);
  return payload;
}

export function formatZMW(value) {
  return Number(value).toLocaleString('en-ZM', { style: 'currency', currency: 'ZMW' });
}

export function discountPct(original, discounted) {
  const o = Number(original);
  if (!o) return 0;
  return Math.max(0, Math.min(100, Math.round(((o - Number(discounted)) / o) * 100)));
}

export function countdown(expiresAt) {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (!(diff > 0)) return 'Expired';
  const s = Math.floor(diff / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m left`;
  if (m > 0) return `${m}m left`;
  return `${s}s left`;
}

export const FALLBACK_IMG = 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=800&q=70';

export function dealImage(deal) {
  return deal.image_url || FALLBACK_IMG;
}

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function dealCardHTML(deal, detailBase = '/deal.html') {
  const pct = deal.discount_percentage ?? discountPct(deal.original_price, deal.discounted_price);
  return `
    <article class="deal-card">
      <div class="img-wrap"><img src="${esc(dealImage(deal))}" alt="${esc(deal.food_name)}" loading="lazy" onerror="this.style.display='none'" /></div>
      <div class="deal-body">
        <span class="deal-vendor">${esc(deal.shop_name)}${deal.is_demo ? ' · Demo' : ''}</span>
        <h3 class="deal-name">${esc(deal.food_name)}</h3>
        <div class="deal-price"><strong>${formatZMW(deal.discounted_price)}</strong><s>${formatZMW(deal.original_price)}</s></div>
        <span class="pill hot" data-expires="${esc(deal.expires_at)}">−${pct}% · ${esc(countdown(deal.expires_at))}</span>
        <span class="deal-meta">${deal.quantity_remaining} available · ${esc(deal.category || '')}</span>
        <a class="btn btn-secondary btn-sm" href="${detailBase}?id=${encodeURIComponent(deal.id)}">View Deal</a>
      </div>
    </article>`;
}
