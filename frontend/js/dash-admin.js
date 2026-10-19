// Admin dashboard: platform statistics, vendor approvals, listing moderation,
// user management (suspend/restore), reservations, categories, announcements,
// review moderation and the audit trail. Everything reads the trusted admin
// contract only; the last active admin is protected server-side.
import { api, formatZMW, esc } from './api.js';
import { renderChrome, requireRole, setStatus } from './layout.js';

const $ = (id) => document.getElementById(id);
const user = await renderChrome().then(() => requireRole(['admin']));
if (!user) throw new Error('redirecting');

let vendorFilter = '';

function pill(status) {
  const cls = status === 'approved' || status === 'active' || status === 'collected' || status === 'published'
    ? 'ok'
    : status === 'pending' || status === 'reserved' ? 'hot' : status === 'suspended' || status === 'disabled' || status === 'rejected' ? 'bad' : '';
  return `<span class="pill ${cls}">${esc(status)}</span>`;
}

async function loadStats() {
  const { statistics: s } = await api('/admin/statistics', { auth: true });
  $('statGrid').innerHTML = `
    <div class="stat"><div class="k">Users (active)</div><div class="v">${s.users_total} (${s.users_active})</div></div>
    <div class="stat"><div class="k">Customers</div><div class="v">${s.customers}</div></div>
    <div class="stat"><div class="k">Shop owners</div><div class="v">${s.shop_owners}</div></div>
    <div class="stat"><div class="k">Shops (pending)</div><div class="v">${s.shops_total} (${s.shops_pending})</div></div>
    <div class="stat"><div class="k">Active listings</div><div class="v">${s.listings_active}</div></div>
    <div class="stat"><div class="k">Reservations</div><div class="v">${s.reservations_total}</div></div>
    <div class="stat"><div class="k">Pickups completed</div><div class="v">${s.pickup_completed}</div></div>
    <div class="stat"><div class="k">Units rescued</div><div class="v">${s.units_rescued}</div></div>
    <div class="stat"><div class="k">Reserved (estimate)</div><div class="v">${formatZMW(s.estimated_reserved_value)}</div></div>
    <div class="stat"><div class="k">Collected value</div><div class="v">${formatZMW(s.estimated_collected_value)}</div></div>`;
}

async function loadVendors() {
  const query = vendorFilter ? `?status=${encodeURIComponent(vendorFilter)}` : '';
  const { vendors } = await api(`/admin/vendors${query}`, { auth: true });
  $('appList').innerHTML = vendors.length ? vendors.map((a) => `
    <div class="card" style="margin-bottom:0.8rem">
      <div class="row-actions" style="justify-content:space-between;align-items:center">
        <div>
          <strong>${esc(a.name)}</strong> ${pill(a.status)}
          <div class="small muted">${esc(a.email)} · ${esc(a.address || '')} · owner: ${esc(a.owner_name || '—')}${a.owner_status ? ` (${esc(a.owner_status)})` : ''}</div>
          <div class="small muted">${a.listings_total} listing(s), ${a.listings_active} active</div>
        </div>
        <div class="row-actions">
          ${['approved', 'rejected', 'suspended', 'pending'].filter((st) => st !== a.status).map((st) =>
            `<button class="btn btn-secondary btn-sm" data-vendor="${a.id}" data-st="${st}" type="button">${st}</button>`).join('')}
        </div>
      </div>
    </div>`).join('') : '<div class="empty">No vendors with this status.</div>';
  $('appList').querySelectorAll('[data-vendor]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`Set vendor status to "${b.dataset.st}"?`)) return;
    try {
      await api(`/admin/vendors/${b.dataset.vendor}/status`, { method: 'PATCH', auth: true, body: { status: b.dataset.st } });
      await loadVendors();
      await loadStats();
    } catch (err) { alert(err.message); }
  }));
}

async function loadDeals() {
  const { deals } = await api('/admin/deals', { auth: true });
  $('dealTable').querySelector('tbody').innerHTML = deals.length ? deals.map((d) => `
    <tr><td>${esc(d.food_name)}</td><td>${esc(d.shop_name)}</td><td>${formatZMW(d.discounted_price)}</td>
    <td>${d.quantity_remaining}/${d.quantity}</td>
    <td>${pill(d.status)}</td>
    <td><div class="row-actions">
      ${d.status === 'active'
        ? `<button class="btn btn-danger btn-sm" data-dst="${d.id}" data-pause="1" type="button">Pause</button>`
        : `<button class="btn btn-secondary btn-sm" data-dst="${d.id}" data-pause="0" type="button">Restore</button>`}
    </div></td></tr>`).join('') : '<tr><td colspan="6" class="muted">No listings.</td></tr>';
  $('dealTable').querySelectorAll('[data-dst]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/admin/deals/${b.dataset.dst}/status`, { method: 'PATCH', auth: true, body: { status: b.dataset.pause === '1' ? 'paused' : 'active' } });
      await loadDeals();
      await loadStats();
    } catch (err) { alert(err.message); }
  }));
}

async function loadUsers(query = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) params.set(k, v);
  const { users } = await api(`/admin/users${params.toString() ? '?' + params.toString() : ''}`, { auth: true });
  $('userTable').querySelector('tbody').innerHTML = users.length ? users.map((u) => `
    <tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.role)}</td><td>${pill(u.status)}</td>
    <td><div class="row-actions">
      ${u.role !== 'admin' && u.status === 'active' ? `<button class="btn btn-danger btn-sm" data-us="${u.id}" data-ust="suspended" type="button">Suspend</button>` : ''}
      ${u.role !== 'admin' && u.status !== 'active' ? `<button class="btn btn-secondary btn-sm" data-us="${u.id}" data-ust="active" type="button">Restore</button>` : ''}
    </div></td></tr>`).join('') : '<tr><td colspan="5" class="muted">No users match.</td></tr>';
  $('userTable').querySelectorAll('[data-us]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`Set account status to "${b.dataset.ust}"?`)) return;
    try {
      await api(`/admin/users/${b.dataset.us}/status`, { method: 'PATCH', auth: true, body: { status: b.dataset.ust } });
      await loadUsers(currentQuery);
      await loadStats();
    } catch (err) { alert(err.message); }
  }));
}

let currentQuery = {};
$('userSearch').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = e.target.q.value.trim();
  currentQuery = { q, role: e.target.role.value };
  loadUsers(currentQuery);
});

async function loadReservations() {
  const { reservations } = await api('/admin/reservations', { auth: true });
  $('resTable').querySelector('tbody').innerHTML = reservations.length ? reservations.map((r) => `
    <tr><td>${esc(r.reservation_code)}</td><td>${esc(r.customer_name || '—')}</td><td>${esc(r.shop_name || '—')}</td>
    <td>${r.quantity}</td><td>${formatZMW(r.total_amount)}</td><td>${pill(r.status)}</td></tr>`).join('')
    : '<tr><td colspan="6" class="muted">No reservations yet.</td></tr>';
}

async function loadCategories() {
  const { categories } = await api('/categories?all=1', { auth: true });
  const list = categories || [];
  $('categoryList').innerHTML = list.length ? list.map((c) => `
    <div class="row-actions" style="justify-content:space-between;margin:0.35rem 0">
      <div><strong>${esc(c.name)}</strong> <span class="muted small">${esc(c.icon || '')} · ${esc(c.status)}</span></div>
      <div>
        ${c.status === 'active'
          ? `<button class="btn btn-ghost btn-sm" data-cat="${c.id}" data-catst="inactive" type="button">Deactivate</button>`
          : `<button class="btn btn-secondary btn-sm" data-cat="${c.id}" data-catst="active" type="button">Activate</button>`}
      </div>
    </div>`).join('') : '<div class="empty">No categories.</div>';
  $('categoryList').querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/categories/${b.dataset.cat}`, { method: 'PATCH', auth: true, body: { status: b.dataset.catst } });
      await loadCategories();
    } catch (err) { alert(err.message); }
  }));
}

$('categoryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = e.target.name.value.trim();
  if (!name) return;
  try {
    await api('/categories', { method: 'POST', auth: true, body: { name } });
    e.target.reset();
    await loadCategories();
  } catch (err) { alert(err.message); }
});

async function loadAnnouncements() {
  const { announcements } = await api('/admin/announcements', { auth: true });
  const list = announcements || [];
  $('announcementList').innerHTML = list.length ? list.map((a) => `
    <div class="card" style="margin-bottom:0.6rem"><strong>${esc(a.title)}</strong> ${pill(a.status)}
      <p class="small" style="margin:0.35rem 0 0">${esc(a.body || '')}</p>
      <div class="small muted">${esc(a.audience)} · ${esc(new Date(a.created_at).toLocaleString())}</div>
    </div>`).join('') : '<div class="empty">No announcements published.</div>';
}

$('announcementForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = $('announcementStatus');
  const f = e.target;
  try {
    setStatus(status, 'Publishing…');
    await api('/admin/announcements', {
      method: 'POST', auth: true,
      body: { title: f.title.value.trim(), body: f.body.value.trim(), audience: f.audience.value }
    });
    f.reset();
    setStatus(status, 'Announcement published and delivered to recipients.', 'ok');
    await loadAnnouncements();
  } catch (err) {
    setStatus(status, err.message, 'err');
  }
});

async function loadReviews() {
  const { reviews } = await api('/reviews?all=1&limit=50', { auth: true });
  const list = reviews || [];
  const statusFor = (r) => r.moderation_status || 'published';
  $('reviewList').innerHTML = list.length ? list.slice(0, 12).map((r) => `
    <div class="card" style="margin-bottom:0.8rem"><strong>${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</strong> ${pill(statusFor(r))}
    <div class="small muted">${esc(r.user_name || '')} · ${esc(r.shop_name || '')}</div>
    <p class="small" style="margin:0.4rem 0 0.45rem">${esc(r.comment || '')}</p>
    <div class="row-actions">
      ${statusFor(r) !== 'published' ? `<button class="btn btn-secondary btn-sm" data-rev="${r.id}" data-rst="published" type="button">Publish</button>` : ''}
      ${statusFor(r) !== 'hidden' ? `<button class="btn btn-danger btn-sm" data-rev="${r.id}" data-rst="hidden" type="button">Hide</button>` : ''}
    </div></div>`).join('')
    : '<div class="empty">No reviews yet.</div>';
  $('reviewList').querySelectorAll('[data-rev]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/reviews/${b.dataset.rev}/status`, { method: 'PATCH', auth: true, body: { status: b.dataset.rst } });
      await loadReviews();
    } catch (err) { alert(err.message); }
  }));
}

async function loadActivity() {
  const { activity } = await api('/admin/activity', { auth: true });
  const list = activity || [];
  $('activityList').innerHTML = list.length ? `
    <div class="table-wrap"><table class="data">
      <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th></tr></thead>
      <tbody>${list.slice(0, 15).map((row) => `
        <tr><td class="small muted">${esc(new Date(row.created_at).toLocaleString())}</td>
        <td>${esc(row.actor_name ? `${row.actor_name} (${row.actor_role || '—'})` : 'system')}</td>
        <td>${esc(row.action)}</td>
        <td class="small muted">${esc(row.target_type || '')} ${row.target_id ? '· ' + esc(row.target_id) : ''}</td></tr>`).join('')}</tbody>
    </table></div>` : '<div class="empty">No activity recorded yet.</div>';
}

// Vendor approval filter chips.
$('vendorFilter').querySelectorAll('[data-vf]').forEach((b) => b.addEventListener('click', () => {
  vendorFilter = b.dataset.vf;
  $('vendorFilter').querySelectorAll('[data-vf]').forEach((x) => x.classList.remove('btn-primary'));
  b.classList.add('btn-primary');
  loadVendors();
}));

try {
  await Promise.all([loadStats(), loadVendors(), loadDeals(), loadUsers(), loadReservations(), loadCategories(), loadAnnouncements(), loadReviews(), loadActivity()]);
} catch (err) {
  $('statGrid').innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
}
