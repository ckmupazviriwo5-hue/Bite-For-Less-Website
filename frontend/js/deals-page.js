// Deals browsing: search + category filter + sorting over live listings.
import { api, dealCardHTML, discountPct } from './api.js';
import { renderChrome, escapeHTML } from './layout.js';

let allDeals = [];

function skeleton() {
  return `<div class="skeleton-grid" aria-hidden="true">${'<div class="skeleton"></div>'.repeat(6)}</div>`;
}

function applyView() {
  const grid = document.getElementById('dealGrid');
  const count = document.getElementById('resultCount');
  const q = document.getElementById('q').value.trim().toLowerCase();
  const cat = document.getElementById('fCategory').value;
  const sort = document.getElementById('fSort').value;

  let list = allDeals.filter((d) => {
    if (cat !== 'all' && d.category !== cat) return false;
    if (q && !`${d.food_name} ${d.shop_name}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const by = {
    ending: (a, b) => new Date(a.expires_at) - new Date(b.expires_at),
    discount: (a, b) => (b.discount_percentage || discountPct(b.original_price, b.discounted_price)) - (a.discount_percentage || discountPct(a.original_price, a.discounted_price)),
    priceAsc: (a, b) => a.discounted_price - b.discounted_price,
    priceDesc: (a, b) => b.discounted_price - a.discounted_price
  }[sort];
  list = [...list].sort(by);

  count.textContent = list.length ? `${list.length} deal${list.length === 1 ? '' : 's'} available` : '';
  grid.innerHTML = list.length
    ? list.map((d) => dealCardHTML(d)).join('')
    : '<div class="empty">No deals match your search. Try clearing filters.</div>';
}

await renderChrome();
const grid = document.getElementById('dealGrid');
grid.innerHTML = skeleton();
let loaded = false;
try {
  ({ deals: allDeals } = await api('/deals'));
  allDeals = allDeals || [];
  loaded = true;
  applyView();
} catch (err) {
  grid.innerHTML = `<div class="error-box">${escapeHTML(err.message)}</div>`;
  document.getElementById('resultCount').textContent = '';
}
if (loaded) {
  ['q', 'fCategory', 'fSort'].forEach((id) => {
    document.getElementById(id).addEventListener('input', applyView);
  });
}
