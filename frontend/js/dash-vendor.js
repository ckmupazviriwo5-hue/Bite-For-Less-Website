// Vendor dashboard: listings CRUD, inventory, incoming reservations, PIN verify.
import { api, formatZMW, countdown, esc } from './api.js';
import { renderChrome, requireRole, setStatus } from './layout.js';

const user = await renderChrome().then(() => requireRole(['shop_owner', 'admin']));
if (!user) throw new Error('redirecting');

const CATS = ['Bakery', 'Restaurant', 'Grocery', 'Fruits & Vegetables', 'Meals', 'Drinks', 'Snacks', 'Other'];
let shop = null;
let myDeals = [];

async function refresh() {
  ({ shop } = await api('/shops/me', { auth: true }));
  document.getElementById('shopTitle').textContent = shop.name;
  document.getElementById('bizBox').innerHTML = `
    <ul class="fact-list">
      <li><span>Shop</span><span>${esc(shop.name)}</span></li>
      <li><span>Status</span><span>${esc(shop.status)}</span></li>
      <li><span>Address</span><span>${esc(shop.address || '—')}</span></li>
    </ul>`;
  const { deals } = await api('/deals');
  myDeals = (deals || []).filter((d) => d.shop_id === shop.id);
  const { reservations } = await api('/shops/me/reservations', { auth: true });

  const active = myDeals.filter((d) => d.status === 'active');
  document.getElementById('statGrid').innerHTML = `
    <div class="stat"><div class="k">Active listings</div><div class="v">${active.length}</div></div>
    <div class="stat"><div class="k">Reservations</div><div class="v">${reservations.length}</div></div>
    <div class="stat"><div class="k">Collected</div><div class="v">${reservations.filter((r) => r.status === 'collected').length}</div></div>
    <div class="stat"><div class="k">Est. sales</div><div class="v">${formatZMW(reservations.filter((r) => r.status === 'collected').reduce((s, r) => s + Number(r.total_amount), 0))}</div></div>`;

  document.querySelector('#listingTable tbody').innerHTML = myDeals.length ? myDeals.map((d) => `
    <tr>
      <td>${esc(d.food_name)}</td>
      <td>${formatZMW(d.discounted_price)}</td>
      <td>${d.quantity_remaining}/${d.quantity}</td>
      <td>${esc(countdown(d.expires_at))}</td>
      <td><span class="pill ${d.status === 'active' ? 'ok' : ''}">${esc(d.status)}</span></td>
      <td><div class="row-actions">
        <button class="btn btn-secondary btn-sm" data-edit="${d.id}" type="button">Edit</button>
        ${d.status === 'active' ? `<button class="btn btn-danger btn-sm" data-deactivate="${d.id}" type="button">Deactivate</button>` : ''}
      </div></td>
    </tr>`).join('') : '<tr><td colspan="6" class="muted">No listings yet — publish your first below.</td></tr>';

  document.querySelector('#resTable tbody').innerHTML = reservations.length ? reservations.map((r) => `
    <tr>
      <td>${esc(r.reservation_code)}</td><td>${r.quantity}</td><td>${formatZMW(r.total_amount)}</td>
      <td><span class="pill ${r.status === 'reserved' ? 'hot' : r.status === 'collected' ? 'ok' : ''}">${esc(r.status)}</span></td>
      <td class="muted small">${esc(new Date(r.expires_at).toLocaleString())}</td>
    </tr>`).join('') : '<tr><td colspan="5" class="muted">No reservations yet.</td></tr>';

  document.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => startEdit(b.dataset.edit)));
  document.querySelectorAll('[data-deactivate]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Deactivate this listing? It will disappear from the marketplace.')) return;
    await api(`/deals/${b.dataset.deactivate}`, { method: 'DELETE', auth: true });
    await refresh();
  }));
}

function startEdit(id) {
  const d = myDeals.find((x) => x.id === id);
  if (!d) return;
  const f = document.getElementById('dealForm');
  f.dealId.value = d.id;
  f.food_name.value = d.food_name;
  f.category.value = CATS.includes(d.category) ? d.category : 'Other';
  f.original_price.value = d.original_price;
  f.discounted_price.value = d.discounted_price;
  f.quantity.value = d.quantity;
  if (d.expires_at) {
    const dt = new Date(new Date(d.expires_at).getTime() - new Date().getTimezoneOffset() * 60000);
    f.expires_at.value = dt.toISOString().slice(0, 16);
  }
  f.image_url.value = d.image_url || '';
  f.description.value = d.description || '';
  document.getElementById('dealSubmit').textContent = 'Save changes';
  document.getElementById('dealReset').hidden = false;
  document.getElementById('createH').scrollIntoView({ behavior: 'smooth' });
}

function resetForm() {
  const f = document.getElementById('dealForm');
  f.reset();
  f.dealId.value = '';
  document.getElementById('dealSubmit').textContent = 'Publish listing';
  document.getElementById('dealReset').hidden = true;
}

document.getElementById('dealReset').addEventListener('click', resetForm);

document.getElementById('dealForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('dealStatus');
  const f = e.target;
  const payload = {
    food_name: f.food_name.value.trim(),
    shop_name: shop.name,
    category: f.category.value,
    original_price: Number(f.original_price.value),
    discounted_price: Number(f.discounted_price.value),
    quantity: Number(f.quantity.value),
    expires_at: new Date(f.expires_at.value).toISOString(),
    image_url: f.image_url.value.trim(),
    description: f.description.value.trim()
  };
  try {
    setStatus(status, 'Saving…');
    if (f.dealId.value) {
      await api(`/deals/${f.dealId.value}`, { method: 'PUT', auth: true, body: payload });
      setStatus(status, 'Listing updated.', 'ok');
    } else {
      await api('/deals', { method: 'POST', auth: true, body: payload });
      setStatus(status, 'Listing published.', 'ok');
    }
    resetForm();
    await refresh();
  } catch (err) {
    setStatus(status, err.message, 'err');
  }
});

document.getElementById('verifyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('verifyStatus');
  const ref = e.target.reservation_ref.value.trim();
  const pickup_pin = e.target.pickup_pin.value.trim();
  try {
    setStatus(status, 'Verifying…');
    // Look up the reservation id: accept a reservation code or a raw id.
    let id = ref;
    if (!ref.startsWith('reservation_')) {
      const { reservations } = await api('/shops/me/reservations', { auth: true });
      const found = reservations.find((r) => r.reservation_code === ref || r.id === ref);
      if (!found) throw new Error('No reservation with that code in your shop.');
      id = found.id;
    }
    await api(`/reservations/${id}/verify`, { method: 'POST', auth: true, body: { pickup_pin } });
    setStatus(status, 'Pickup confirmed.', 'ok');
    e.target.reset();
    await refresh();
  } catch (err) {
    setStatus(status, err.message, 'err');
  }
});

try {
  await refresh();
} catch (err) {
  document.getElementById('statGrid').innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
}
