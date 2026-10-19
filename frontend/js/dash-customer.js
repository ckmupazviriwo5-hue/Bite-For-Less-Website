// Customer dashboard: reservations (active + history, with cancel), saved
// deals (favorites), notifications, profile + password change. Everything is
// a real SQLite record through the shared Express API.
import { api, formatZMW, esc, dealImage } from './api.js';
import { renderChrome, requireRole, setStatus } from './layout.js';

const $ = (id) => document.getElementById(id);
const user = await renderChrome().then(() => requireRole(['customer']));
if (!user) throw new Error('redirecting');

function resCard(r, showCancel) {
  const expiredSoon = r.status === 'reserved' && new Date(r.expires_at) < new Date(Date.now() + 30 * 60000);
  return `
    <div class="card" style="margin-bottom:0.8rem">
      <div class="row-actions" style="justify-content:space-between;align-items:center">
        <div>
          <strong>${esc(r.reservation_code)}</strong>
          <span class="pill ${r.status === 'reserved' ? (expiredSoon ? 'bad' : 'hot') : r.status === 'collected' ? 'ok' : ''}">${esc(r.status)}</span>
          <div class="small muted">${esc(r.food_name || '')} · Qty ${r.quantity} · ${formatZMW(r.total_amount)}${r.shop_name ? ' · ' + esc(r.shop_name) : ''}</div>
          <div class="small muted">Pickup PIN <strong>${esc(r.pickup_pin || '—')}</strong>${r.status === 'reserved' ? ' · valid until ' + esc(new Date(r.expires_at).toLocaleString()) : ''}</div>
        </div>
        ${showCancel && !expiredSoon ? `<button class="btn btn-danger btn-sm" type="button" data-cancel="${r.id}">Cancel</button>` : ''}
      </div>
    </div>`;
}

function statRow(label, value) {
  return `<div class="stat"><div class="k">${label}</div><div class="v">${value}</div></div>`;
}

let lastStats = null;
function renderStats(reservations, favCount, unread) {
  $('statGrid').innerHTML =
    statRow('Active', reservations.filter((r) => r.status === 'reserved').length) +
    statRow('Collected', reservations.filter((r) => r.status === 'collected').length) +
    statRow('Total', reservations.length) +
    statRow('Saved deals', favCount) +
    statRow('Unread alerts', unread);
}

async function refresh() {
  const [{ reservations }, { favorites }, { notifications, unread }, me] = await Promise.all([
    api('/reservations', { auth: true }),
    api('/favorites', { auth: true }),
    api('/notifications?limit=10', { auth: true }),
    api('/auth/me', { auth: true }).then((p) => p.user)
  ]);

  renderStats(reservations, favorites.length, unread);

  const active = reservations.filter((r) => r.status === 'reserved');
  const past = reservations.filter((r) => r.status !== 'reserved');
  $('currentList').innerHTML = active.length
    ? active.map((r) => resCard(r, true)).join('')
    : '<div class="empty">No active reservations. <a href="/deals.html">Find a deal</a>.</div>';
  $('historyList').innerHTML = past.length
    ? past.map((r) => resCard(r, false)).join('')
    : '<div class="empty">No past reservations yet.</div>';
  $('historyList').querySelectorAll('[data-cancel]').forEach(() => { /* history rows have no cancel button */ });

  $('savedList').innerHTML = favorites.length
    ? favorites.map((f) => `
      <article class="deal-card">
        <div class="img-wrap"><img src="${esc(dealImage(f))}" alt="${esc(f.food_name)}" loading="lazy" onerror="this.style.display='none'" /></div>
        <div class="deal-body">
          <span class="deal-vendor">${esc(f.shop_name || '')}</span>
          <h3 class="deal-name">${esc(f.food_name)}</h3>
          <div class="deal-price"><strong>${formatZMW(f.discounted_price)}</strong><s>${formatZMW(f.original_price)}</s></div>
          <span class="deal-meta">${f.quantity_remaining} available${f.deal_status !== 'active' ? ' · ' + esc(f.deal_status) : ''}</span>
          <div class="row-actions">
            ${f.deal_status === 'active' ? `<a class="btn btn-primary btn-sm" href="/deal.html?id=${encodeURIComponent(f.deal_id)}">View deal</a>` : ''}
            <button class="btn btn-danger btn-sm" type="button" data-unfav="${f.deal_id}">Remove</button>
          </div>
        </div>
      </article>`).join('')
    : '<div class="empty">Nothing saved yet — tap “Save” on any deal.</div>';
  $('savedList').querySelectorAll('[data-unfav]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/favorites/${b.dataset.unfav}`, { method: 'DELETE', auth: true });
      await refresh();
    } catch (err) { alert(err.message); }
  }));

  $('notifList').innerHTML = notifications.length ? notifications.map((n) => `
    <div class="card" style="margin-bottom:0.6rem">
      <div class="row-actions" style="justify-content:space-between">
        <div><strong>${esc(n.title)}</strong>${n.is_read ? '' : ' <span class="pill hot">new</span>'}
          <div class="small muted">${esc(n.message)}</div>
          <div class="small muted">${esc(new Date(n.created_at).toLocaleString())}</div>
        </div>
        ${n.is_read ? '' : `<button class="btn btn-ghost btn-sm" type="button" data-read="${n.id}">Mark read</button>`}
      </div>
    </div>`).join('') : '<div class="empty">No notifications yet.</div>';
  $('notifList').querySelectorAll('[data-read]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/notifications/${b.dataset.read}/read`, { method: 'PATCH', auth: true });
      await refresh();
    } catch (err) { alert(err.message); }
  }));

  $('dashTitle').textContent = `Welcome, ${esc(me.name.split(' ')[0])}`;
  $('profileBox').innerHTML = `
    <ul class="fact-list">
      <li><span>Name</span><span>${esc(me.name)}</span></li>
      <li><span>Email</span><span>${esc(me.email)}</span></li>
      <li><span>Phone</span><span>${esc(me.phone || '—')}</span></li>
      <li><span>Role</span><span>${esc(me.role)}</span></li>
    </ul>`;

  $('currentList').querySelectorAll('[data-cancel]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Cancel this reservation? The items return to the listing.')) return;
      try {
        await api(`/reservations/${btn.dataset.cancel}/cancel`, { method: 'POST', auth: true });
        await refresh();
      } catch (err) { alert(err.message); }
    });
  });
}

$('readAllBtn').addEventListener('click', async () => {
  try {
    await api('/notifications/read-all', { method: 'POST', auth: true });
    await refresh();
  } catch (err) { alert(err.message); }
});

// change-password is verified server-side against the stored bcrypt hash;
// the current session token stays valid (no forced re-login needed).
$('passwordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = $('passwordStatus');
  const f = e.target;
  if (f.current_password.value === f.new_password.value) {
    return setStatus(status, 'The new password must be different.', 'err');
  }
  try {
    setStatus(status, 'Updating…');
    await api('/auth/change-password', {
      method: 'POST', auth: true,
      body: { current_password: f.current_password.value, new_password: f.new_password.value }
    });
    setStatus(status, 'Password changed.', 'ok');
    f.reset();
  } catch (err) {
    setStatus(status, err.message, 'err');
  }
});

try {
  await refresh();
} catch (err) {
  $('currentList').innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
}
