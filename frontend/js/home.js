// Homepage: featured carousel (real listings), honest impact panel, APK modal.
import { api, countdown, dealCardHTML } from './api.js';
import { renderChrome, escapeHTML, showApkModal } from './layout.js';

async function loadFeatured() {
  const box = document.getElementById('featuredCarousel');
  try {
    const { deals } = await api('/deals');
    if (!deals.length) {
      box.innerHTML = '<div class="empty">No live deals right now — check back soon.</div>';
      return;
    }
    const top = [...deals]
      .sort((a, b) => (b.discount_percentage || 0) - (a.discount_percentage || 0))
      .slice(0, 8);
    box.innerHTML = top.map((d) => dealCardHTML(d)).join('');
  } catch (err) {
    box.innerHTML = `<div class="error-box">${escapeHTML(err.message)}</div>`;
  }
}

async function loadImpact() {
  const grid = document.getElementById('impactGrid');
  try {
    const { statistics } = await api('/admin/statistics');
    grid.innerHTML = `
      <div class="card reveal in"><h3>${statistics.active_deals}</h3><p>Active listings right now</p></div>
      <div class="card reveal in"><h3>${statistics.total_shops}</h3><p>Vendors on the platform</p></div>
      <div class="card reveal in"><h3>${statistics.food_rescued}</h3><p>Orders collected so far</p></div>`;
  } catch {
    grid.innerHTML = `
      <div class="card"><h3>Mission first</h3><p>Live rescue metrics will be published here once verified platform data exists.</p></div>
      <div class="card"><h3>No invented figures</h3><p>We would rather show nothing than a number we cannot prove.</p></div>
      <div class="card"><h3>Vendor-powered</h3><p>Every figure on this page will trace back to a real listing or pickup.</p></div>`;
  }
}

await renderChrome();
document.getElementById('apkHeroBtn')?.addEventListener('click', () => showApkModal());
await loadFeatured();
await loadImpact();
// Lightweight countdown refresh (30s); full re-render only on user action.
setInterval(() => {
  document.querySelectorAll('[data-expires]').forEach((el) => {
    const pct = el.textContent.split('·')[0];
    el.textContent = `${pct}· ${countdown(el.dataset.expires)}`;
  });
}, 30000);
