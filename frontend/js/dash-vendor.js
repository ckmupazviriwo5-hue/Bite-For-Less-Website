// Vendor dashboard: approval state, listings CRUD with genuine image uploads,
// incoming reservations, PIN verification, business profile editing, alerts.
import { api, apiUpload, formatZMW, countdown, esc } from './api.js';
import { renderChrome, requireRole, setStatus } from './layout.js';

const $ = (id) => document.getElementById(id);
const user = await renderChrome().then(() => requireRole(['shop_owner', 'admin']));
if (!user) throw new Error('redirecting');

const CATS = ['Bakery', 'Restaurant', 'Grocery', 'Fruits & Vegetables', 'Meals', 'Drinks', 'Snacks', 'Other'];
let shop = null;
let myDeals = [];

const APPROVAL_COPY = {
  pending: {
    title: '⏳ Pending approval',
    text: 'Your application is with the administrators. You can complete your business profile now, but new listings unlock the moment your shop is approved.'
  },
  rejected: {
    title: 'Application not approved',
    text: 'Your application was rejected. Update your details and reapply — the listing rules need explicit agreement.'
  },
  suspended: {
    title: '🛑 Shop suspended',
    text: 'An administrator suspended this shop. Your listings are paused and new reservations are blocked. Contact the platform for next steps.'
  }
};

function renderApprovalBanner() {
  const key = APPROVAL_COPY[shop.status] ? shop.status : null;
  const submitted = new URLSearchParams(location.search).get('application') === 'submitted';
  const box = $('approvalBanner');
  if (submitted && shop.status === 'pending') {
    box.innerHTML = `<div class="banner ok">✅ Application received! Your shop is now <strong>pending administrator approval</strong> — listings unlock once approved. This page updates automatically after approval.</div>`;
  } else if (key) {
    box.innerHTML = `<div class="banner warn"><strong>${esc(APPROVAL_COPY[key].title)}</strong><p class="small mt">${esc(APPROVAL_COPY[key].text)}</p></div>`;
  } else {
    box.innerHTML = '';
  }
}

async function refresh() {
  ({ shop } = await api('/shops/me', { auth: true }));
  renderApprovalBanner();
  $('shopTitle').textContent = shop.name;

  const [{ statistics }, { deals }, { reservations }, { notifications, unread }] = await Promise.all([
    api('/shops/me/dashboard', { auth: true }),
    api('/deals/mine', { auth: true }),
    api('/shops/me/reservations', { auth: true }),
    api('/notifications?limit=8', { auth: true })
  ]);
  myDeals = deals || [];

  $('bizBox').innerHTML = `
    <ul class="fact-list">
      <li><span>Shop</span><span>${esc(shop.name)}</span></li>
      <li><span>Status</span><span>${esc(shop.status)}${shop.status === 'approved' ? ' ✅' : ''}</span></li>
      <li><span>Location</span><span>${esc(shop.address || '—')}${shop.city ? ', ' + esc(shop.city) : ''}</span></li>
      <li><span>Hours</span><span>${esc(shop.opening_hours || '—')}</span></li>
      <li><span>Pickup</span><span>${esc(shop.pickup_instructions || '—')}</span></li>
      <li><span>Card imagery</span><span>${shop.logo_path ? 'logo ✓' : 'logo —'} · ${shop.cover_image_path ? 'cover ✓' : 'cover —'}</span></li>
    </ul>`;

  $('statGrid').innerHTML = `
    <div class="stat"><div class="k">Active listings</div><div class="v">${statistics.listings_active}/${statistics.listings_total}</div></div>
    <div class="stat"><div class="k">Active reservations</div><div class="v">${statistics.reservations_incoming}</div></div>
    <div class="stat"><div class="k">Completed pickups</div><div class="v">${statistics.pickup_completed}</div></div>
    <div class="stat"><div class="k">Reserved (estimate)</div><div class="v">${formatZMW(statistics.estimated_reserved_value)}</div></div>
    <div class="stat"><div class="k">Collected sales</div><div class="v">${formatZMW(statistics.estimated_collected_value)}</div></div>
    <div class="stat"><div class="k">Unread alerts</div><div class="v">${unread}</div></div>`;

  $('listingTable').querySelector('tbody').innerHTML = myDeals.length ? myDeals.map((d) => `
    <tr>
      <td>${esc(d.food_name)}</td>
      <td>${formatZMW(d.discounted_price)}</td>
      <td>${d.quantity_remaining}/${d.quantity}</td>
      <td>${esc(countdown(d.expires_at))}</td>
      <td><span class="pill ${d.status === 'active' ? 'ok' : d.status === 'paused' ? 'warn' : ''}">${esc(d.status)}</span></td>
      <td><div class="row-actions">
        <button class="btn btn-secondary btn-sm" data-edit="${d.id}" type="button" ${shop.status === 'approved' ? '' : 'disabled'}>Edit</button>
        ${d.status === 'active' ? `<button class="btn btn-danger btn-sm" data-deactivate="${d.id}" type="button" ${shop.status === 'approved' ? '' : 'disabled'}>Deactivate</button>` : ''}
      </div></td>
    </tr>`).join('') : '<tr><td colspan="6" class="muted">No listings yet — publish your first below.</td></tr>';

  $('resTable').querySelector('tbody').innerHTML = reservations.length ? reservations.map((r) => `
    <tr>
      <td>${esc(r.reservation_code)}</td>
      <td>${esc(r.customer_name || '—')}</td>
      <td>${r.quantity}</td>
      <td>${formatZMW(r.total_amount)}</td>
      <td><span class="pill ${r.status === 'reserved' ? 'hot' : r.status === 'collected' ? 'ok' : ''}">${esc(r.status)}</span></td>
      <td class="muted small">${esc(new Date(r.expires_at).toLocaleString())}</td>
    </tr>`).join('') : '<tr><td colspan="6" class="muted">No reservations yet.</td></tr>';

  $('alertList').innerHTML = notifications.length ? notifications.map((n) => `
    <div class="card" style="margin-bottom:0.6rem">
      <div class="row-actions" style="justify-content:space-between">
        <div><strong>${esc(n.title)}</strong>${n.is_read ? '' : ' <span class="pill hot">new</span>'}
          <div class="small muted">${esc(n.message)}</div>
          <div class="small muted">${esc(new Date(n.created_at).toLocaleString())}</div>
        </div>
        ${n.is_read ? '' : `<button class="btn btn-ghost btn-sm" data-read="${n.id}" type="button">Mark read</button>`}
      </div>
    </div>`).join('') : '<div class="empty">No notifications yet.</div>';
  $('alertList').querySelectorAll('[data-read]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/notifications/${b.dataset.read}/read`, { method: 'PATCH', auth: true });
      await refresh();
    } catch (err) { alert(err.message); }
  }));

  // Publish gate: non-approved shops cannot create or edit listings.
  const approved = shop.status === 'approved';
  $('dealForm').style.opacity = approved ? '1' : '0.65';
  $('dealSubmit').disabled = !approved;
  $('dealSubmit').title = approved ? '' : 'Your shop must be approved before you can publish.';

  $('listingTable').querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => startEdit(b.dataset.edit)));
  $('listingTable').querySelectorAll('[data-deactivate]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Deactivate this listing? It will disappear from the marketplace.')) return;
    try {
      await api(`/deals/${b.dataset.deactivate}`, { method: 'DELETE', auth: true });
      await refresh();
    } catch (err) { alert(err.message); }
  }));
}

function resetForm() {
  const f = $('dealForm');
  f.reset();
  f.dealId.value = '';
  $('imageFileField').hidden = false;
  $('imageUrlField').hidden = true;
  $('dealSubmit').textContent = 'Publish listing';
  $('dealReset').hidden = true;
}

function startEdit(id) {
  const d = myDeals.find((x) => x.id === id);
  if (!d) return;
  const f = $('dealForm');
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
  // Edits go through the JSON channel: keep any current photo unless the URL
  // field is changed; new photos are attached on the next create.
  $('imageFileField').hidden = true;
  $('imageUrlField').hidden = false;
  $('dealSubmit').textContent = 'Save changes';
  $('dealReset').hidden = false;
  $('createH').scrollIntoView({ behavior: 'smooth' });
}

$('dealReset').addEventListener('click', resetForm);

$('dealForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = $('dealStatus');
  const f = e.target;
  try {
    setStatus(status, 'Saving…');
    if (f.dealId.value) {
      // JSON edit path.
      const payload = {
        food_name: f.food_name.value.trim(),
        shop_name: shop.name,
        category: f.category.value,
        original_price: f.original_price.value,
        discounted_price: f.discounted_price.value,
        quantity: f.quantity.value,
        expires_at: new Date(f.expires_at.value).toISOString(),
        image_url: f.image_url.value.trim(),
        description: f.description.value.trim()
      };
      await api(`/deals/${f.dealId.value}`, { method: 'PUT', auth: true, body: payload });
      setStatus(status, 'Listing updated.', 'ok');
    } else {
      // Multipart create: fields + optional genuine photo upload.
      const fd = new FormData();
      fd.append('food_name', f.food_name.value.trim());
      fd.append('shop_name', shop.name);
      fd.append('category', f.category.value);
      fd.append('original_price', f.original_price.value);
      fd.append('discounted_price', f.discounted_price.value);
      fd.append('quantity', f.quantity.value);
      fd.append('expires_at', new Date(f.expires_at.value).toISOString());
      fd.append('description', f.description.value.trim());
      const file = $('dealImage').files && $('dealImage').files[0];
      if (file) fd.append('image', file);
      await apiUpload('/deals', fd);
      setStatus(status, 'Listing published.', 'ok');
    }
    resetForm();
    await refresh();
  } catch (err) {
    setStatus(status, err.message, 'err');
  }
});

$('verifyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = $('verifyStatus');
  const ref = e.target.reservation_ref.value.trim();
  const pickup_pin = e.target.pickup_pin.value.trim();
  try {
    setStatus(status, 'Verifying…');
    let id = ref;
    if (!ref.startsWith('reservation_')) {
      const { reservations } = await api('/shops/me/reservations', { auth: true });
      const found = reservations.find((r) => r.reservation_code === ref || r.id === ref);
      if (!found) throw new Error('No reservation with that code in your shop.');
      id = found.id;
    }
    await api(`/reservations/${id}/verify`, { method: 'POST', auth: true, body: { pickup_pin } });
    setStatus(status, 'Pickup confirmed — stock reduced and value recorded.', 'ok');
    e.target.reset();
    await refresh();
  } catch (err) {
    setStatus(status, err.message, 'err');
  }
});

// ----------------------------------------------------- business profile -----
const profileForm = $('profileForm');
$('editProfileBtn').addEventListener('click', () => {
  profileForm.hidden = false;
  $('profileCancel').hidden = false;
  const f = profileForm;
  f.name.value = shop.name || '';
  f.phone.value = shop.phone || '';
  f.whatsapp_number.value = shop.whatsapp_number || '';
  f.business_type.value = shop.business_type || '';
  f.description.value = shop.description || '';
  f.address.value = shop.address || '';
  f.city.value = shop.city || '';
  f.area.value = shop.area || '';
  f.opening_hours.value = shop.opening_hours || '';
  f.pickup_window_start.value = (shop.pickup_window_start || '').slice(0, 5);
  f.pickup_window_end.value = (shop.pickup_window_end || '').slice(0, 5);
  f.pickup_instructions.value = shop.pickup_instructions || '';
  $('profileCancel').addEventListener('click', () => { profileForm.hidden = true; $('profileCancel').hidden = true; }, { once: true });
});

profileForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = $('profileStatus');
  const f = e.target;
  try {
    setStatus(status, 'Saving…');
    await api('/shops/me', {
      method: 'PATCH', auth: true,
      body: {
        name: f.name.value.trim(),
        phone: f.phone.value.trim(),
        whatsapp_number: f.whatsapp_number.value.trim(),
        business_type: f.business_type.value.trim(),
        description: f.description.value.trim(),
        address: f.address.value.trim(),
        city: f.city.value.trim(),
        area: f.area.value.trim(),
        opening_hours: f.opening_hours.value.trim(),
        pickup_window_start: f.pickup_window_start.value,
        pickup_window_end: f.pickup_window_end.value,
        pickup_instructions: f.pickup_instructions.value.trim()
      }
    });
    setStatus(status, 'Business profile saved.', 'ok');
    profileForm.hidden = true;
    $('profileCancel').hidden = true;
    await refresh();
  } catch (err) {
    setStatus(status, err.message, 'err');
  }
});

$('imageUploadBtn').addEventListener('click', async () => {
  const status = $('imageStatus');
  const logo = $('logoFile').files[0];
  const cover = $('coverFile').files[0];
  if (!logo && !cover) return setStatus(status, 'Pick a logo or cover file first.', 'err');
  try {
    if (logo) {
      const fd = new FormData();
      fd.append('image', logo);
      await apiUpload('/shops/me/logo', fd);
    }
    if (cover) {
      const fd = new FormData();
      fd.append('image', cover);
      await apiUpload('/shops/me/cover', fd);
    }
    setStatus(status, 'Images updated.', 'ok');
    $('logoFile').value = '';
    $('coverFile').value = '';
    await refresh();
  } catch (err) {
    setStatus(status, err.message, 'err');
  }
});

$('readAllBtn').addEventListener('click', async () => {
  try {
    await api('/notifications/read-all', { method: 'POST', auth: true });
    await refresh();
  } catch (err) { alert(err.message); }
});

try {
  await refresh();
} catch (err) {
  $('statGrid').innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
}
