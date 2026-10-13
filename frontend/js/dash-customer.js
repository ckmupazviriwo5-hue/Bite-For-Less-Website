// Customer dashboard: overview, active reservations + pickup codes, history, profile.
import { api, formatZMW, esc } from './api.js';
import { renderChrome, requireRole } from './layout.js';

const user = await renderChrome().then(() => requireRole(['customer']));
if (!user) throw new Error('redirecting');

function resCard(r, showCancel) {
  return `
    <div class="card" style="margin-bottom:0.8rem">
      <div class="row-actions" style="justify-content:space-between;align-items:center">
        <div>
          <strong>${esc(r.reservation_code)}</strong>
          <span class="pill ${r.status === 'reserved' ? 'hot' : r.status === 'collected' ? 'ok' : ''}">${esc(r.status)}</span>
          <div class="small muted">Qty ${r.quantity} · ${formatZMW(r.total_amount)} · PIN <strong>${esc(r.pickup_pin || '—')}</strong></div>
          <div class="small muted">Valid until ${esc(new Date(r.expires_at).toLocaleString())}</div>
        </div>
        ${showCancel ? `<button class="btn btn-danger btn-sm" type="button" data-cancel="${r.id}">Cancel</button>` : ''}
      </div>
    </div>`;
}

try {
  const [{ reservations }, me] = await Promise.all([
    api('/reservations', { auth: true }),
    api('/auth/me', { auth: true }).then((p) => p.user)
  ]);
  const active = reservations.filter((r) => r.status === 'reserved');
  const past = reservations.filter((r) => r.status !== 'reserved');

  document.getElementById('dashTitle').textContent = `Welcome, ${esc(me.name.split(' ')[0])}`;
  document.getElementById('statGrid').innerHTML = `
    <div class="stat"><div class="k">Active</div><div class="v">${active.length}</div></div>
    <div class="stat"><div class="k">Collected</div><div class="v">${reservations.filter((r) => r.status === 'collected').length}</div></div>
    <div class="stat"><div class="k">Total</div><div class="v">${reservations.length}</div></div>`;

  document.getElementById('currentList').innerHTML = active.length
    ? active.map((r) => resCard(r, true)).join('')
    : '<div class="empty">No active reservations. <a href="/deals.html">Find a deal</a>.</div>';
  document.getElementById('historyList').innerHTML = past.length
    ? past.map((r) => resCard(r, false)).join('')
    : '<div class="empty">No past reservations yet.</div>';
  document.getElementById('profileBox').innerHTML = `
    <ul class="fact-list">
      <li><span>Name</span><span>${esc(me.name)}</span></li>
      <li><span>Email</span><span>${esc(me.email)}</span></li>
      <li><span>Role</span><span>${esc(me.role)}</span></li>
    </ul>
    <p class="small muted">Profile editing is not supported by the current backend.</p>`;

  document.querySelectorAll('[data-cancel]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Cancel this reservation? The items return to the listing.')) return;
      try {
        await api(`/reservations/${btn.dataset.cancel}/cancel`, { method: 'POST', auth: true });
        location.reload();
      } catch (err) { alert(err.message); }
    });
  });
} catch (err) {
  document.getElementById('currentList').innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
}
