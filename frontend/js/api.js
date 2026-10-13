// Bite For Less — shared API client (Express REST; Supabase-ready via config).
// Reads window.BFL_CONFIG.API_BASE so the target can move without code edits.
const base = () => (window.BFL_CONFIG && window.BFL_CONFIG.API_BASE) || '/api';

export const tokenStore = {
  get: () => localStorage.getItem('bfl_token') || '',
  set: (t) => localStorage.setItem('bfl_token', t),
  clear: () => localStorage.removeItem('bfl_token')
};

export async function api(path, { method = 'GET', body, auth = false } = {}) {
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

// Trusted role, always from the backend — never from editable client storage.
export async function currentUser() {
  const payload = await api('/auth/me', { auth: true });
  return payload.user;
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
        <span class="deal-vendor">${esc(deal.shop_name)}</span>
        <h3 class="deal-name">${esc(deal.food_name)}</h3>
        <div class="deal-price"><strong>${formatZMW(deal.discounted_price)}</strong><s>${formatZMW(deal.original_price)}</s></div>
        <span class="pill hot" data-expires="${esc(deal.expires_at)}">−${pct}% · ${esc(countdown(deal.expires_at))}</span>
        <span class="deal-meta">${deal.quantity_remaining} available · ${esc(deal.category || '')}</span>
        <a class="btn btn-secondary btn-sm" href="${detailBase}?id=${encodeURIComponent(deal.id)}">View Deal</a>
      </div>
    </article>`;
}
