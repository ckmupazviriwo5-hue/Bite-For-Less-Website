// Admin dashboard: real stats, approvals, listings, users, reviews (read-only where
// the backend offers no moderation endpoint — shown honestly).
import { api, formatZMW, esc } from './api.js';
import { renderChrome, requireRole } from './layout.js';

const user = await renderChrome().then(() => requireRole(['admin']));
if (!user) throw new Error('redirecting');

try {
  const [statsRes, appsRes, dealsRes, usersRes, reviewsRes] = await Promise.all([
    api('/admin/statistics', { auth: true }),
    api('/admin/applications', { auth: true }),
    api('/admin/deals', { auth: true }),
    api('/admin/users', { auth: true }),
    api('/reviews')
  ]);
  const s = statsRes.statistics;

  document.getElementById('statGrid').innerHTML = `
    <div class="stat"><div class="k">Users</div><div class="v">${s.total_users}</div></div>
    <div class="stat"><div class="k">Vendors</div><div class="v">${s.total_shops}</div></div>
    <div class="stat"><div class="k">Pending</div><div class="v">${s.pending_applications}</div></div>
    <div class="stat"><div class="k">Active deals</div><div class="v">${s.active_deals}</div></div>
    <div class="stat"><div class="k">Reservations</div><div class="v">${s.total_reservations}</div></div>
    <div class="stat"><div class="k">Revenue</div><div class="v">${formatZMW(s.total_revenue)}</div></div>`;

  const apps = appsRes.applications || [];
  document.getElementById('appList').innerHTML = apps.length ? apps.map((a) => `
    <div class="card" style="margin-bottom:0.8rem">
      <div class="row-actions" style="justify-content:space-between;align-items:center">
        <div><strong>${esc(a.name)}</strong> <span class="pill ${a.status === 'approved' ? 'ok' : a.status === 'pending' ? 'hot' : ''}">${esc(a.status)}</span>
        <div class="small muted">${esc(a.email)} · ${esc(a.address || '')}</div></div>
        <div class="row-actions">
          ${['approved', 'rejected', 'suspended'].map((st) =>
            `<button class="btn btn-secondary btn-sm" data-app="${a.id}" data-st="${st}" type="button">${st}</button>`).join('')}
        </div>
      </div>
    </div>`).join('') : '<div class="empty">No vendor applications.</div>';

  document.querySelectorAll('[data-app]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/admin/applications/${b.dataset.app}`, { method: 'PATCH', auth: true, body: { status: b.dataset.st } });
    location.reload();
  }));

  const deals = dealsRes.deals || [];
  document.querySelector('#dealTable tbody').innerHTML = deals.length ? deals.map((d) => `
    <tr><td>${esc(d.food_name)}</td><td>${esc(d.shop_name)}</td><td>${formatZMW(d.discounted_price)}</td>
    <td>${d.quantity_remaining}/${d.quantity}</td>
    <td><span class="pill ${d.status === 'active' ? 'ok' : ''}">${esc(d.status)}</span></td>
    <td>${d.status === 'active' ? `<button class="btn btn-danger btn-sm" data-del="${d.id}" type="button">Remove</button>` : ''}</td></tr>`).join('')
    : '<tr><td colspan="6" class="muted">No listings.</td></tr>';

  document.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Remove this listing from the marketplace?')) return;
    await api(`/deals/${b.dataset.del}`, { method: 'DELETE', auth: true });
    location.reload();
  }));

  const users = usersRes.users || [];
  document.querySelector('#userTable tbody').innerHTML = users.map((u) => `
    <tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.role)}</td><td>${esc(u.status)}</td></tr>`).join('');

  const reviews = reviewsRes.reviews || [];
  document.getElementById('reviewList').innerHTML = reviews.length ? reviews.slice(0, 10).map((r) => `
    <div class="card" style="margin-bottom:0.8rem"><strong>${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</strong>
    <div class="small muted">${esc(r.user_name || '')} · ${esc(r.shop_name || '')}</div>
    <p class="small" style="margin:0.4rem 0 0">${esc(r.comment || '')}</p></div>`).join('')
    : '<div class="empty">No reviews yet.</div>';
} catch (err) {
  document.getElementById('statGrid').innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
}
