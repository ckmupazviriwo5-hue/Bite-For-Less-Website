// Deal detail + reservation with quantity picker and pickup-code confirmation.
import { api, countdown, dealImage, discountPct, formatZMW, tokenStore, esc, isSupabaseMode } from './api.js';
import { isBookable, eligibilityLabel } from './supabase-catalog.js';
import { renderChrome, setStatus } from './layout.js';

const id = new URLSearchParams(location.search).get('id');
const box = document.getElementById('dealDetail');

function facts(d) {
  const pct = d.discount_percentage ?? discountPct(d.original_price, d.discounted_price);
  const savings = Number(d.original_price) - Number(d.discounted_price);
  const bookable = isBookable(d);
  const reservationBlock = isSupabaseMode()
    ? `<p class="small muted" style="margin-top:1rem">Reservations need an account — coming soon in this demo. ` +
      `This catalog is live Supabase data${d.is_demo ? ' (demonstration listing)' : ''}.</p>`
    : `<form id="reserveForm" class="form-grid" style="margin-top:1rem">
        <div class="form-row">
          <label class="field">Quantity
            <input type="number" id="qty" name="quantity" min="1" max="${d.quantity_remaining}" value="1" required />
          </label>
        </div>
        <div><button class="btn btn-primary" type="submit" ${bookable ? '' : 'disabled'}>Reserve now</button></div>
        <div class="status" id="reserveStatus" role="status"></div>
        ${tokenStore.get() ? '' : '<p class="small muted">You will be asked to log in to complete the reservation.</p>'}
      </form>`;
  return `
    <div class="detail-grid">
      <img class="cover" src="${esc(dealImage(d))}" alt="${esc(d.food_name)}" onerror="this.style.display='none'" />
      <div>
        <span class="eyebrow">${esc(d.shop_name)}${d.is_demo ? ' · Demo' : ''}</span>
        <h1 style="font-size:clamp(1.6rem,3vw,2.3rem)">${esc(d.food_name)}</h1>
        <p>${esc(d.description || 'Fresh surplus food, available for a limited time.')}</p>
        <div class="deal-price"><span class="price-big">${formatZMW(d.discounted_price)}</span><s class="muted">${formatZMW(d.original_price)}</s></div>
        <p class="mt"><span class="pill hot">Save ${formatZMW(savings)} (−${pct}%)</span>
        <span class="pill">${esc(bookable ? countdown(d.expires_at) : eligibilityLabel(d))}</span></p>
        <p class="mt"><button class="btn btn-secondary btn-sm" id="saveDeal" type="button"${tokenStore.get() ? '' : ' disabled'}>☆ Save to my dashboard</button></p>
        <ul class="fact-list">
          <li><span>Available</span><span>${d.quantity_remaining} of ${d.quantity}</span></li>
          <li><span>Category</span><span>${esc(d.category || 'Other')}</span></li>
          <li><span>Vendor</span><span>${esc(d.shop_name)}</span></li>
          ${d.city || d.address ? `<li><span>Pickup</span><span>${esc([d.address, d.city].filter(Boolean).join(', '))}</span></li>` : ''}
          <li><span>Collection deadline</span><span>${esc(d.expires_at ? new Date(d.expires_at).toLocaleString() : 'See vendor for times')}</span></li>
        </ul>
        ${reservationBlock}
      </div>
    </div>`;
}

function showConfirmation(res, deal) {
  const modal = document.getElementById('reserveModal');
  document.getElementById('resBody').innerHTML = `
    <ul class="fact-list">
      <li><span>Food</span><span>${esc(deal.food_name)}</span></li>
      <li><span>Quantity</span><span>${res.quantity}</span></li>
      <li><span>Total</span><span>${formatZMW(res.total_amount)}</span></li>
      <li><span>Pickup PIN</span><span><strong>${esc(res.pickup_pin)}</strong></span></li>
      <li><span>Reservation code</span><span>${esc(res.reservation_code)}</span></li>
      <li><span>Valid until</span><span>${esc(new Date(res.expires_at).toLocaleString())}</span></li>
    </ul>
    <p class="small muted">Demo pickup code — show it at the counter. It is a prototype convenience, not secure verification.</p>`;
  const qrBox = document.getElementById('qrBox');
  qrBox.innerHTML = '';
  if (window.QRCode) {
    new window.QRCode(qrBox, {
      text: `${res.qr_token}|${res.pickup_pin}|${res.reservation_code}`,
      width: 170, height: 170, colorDark: '#ffaa21', colorLight: '#111111'
    });
  } else {
    qrBox.textContent = 'QR unavailable offline — use the PIN above.';
  }
  modal.hidden = false;
  modal.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => { modal.hidden = true; });
  modal.onclick = (e) => { if (e.target === modal) modal.hidden = true; };
}

await renderChrome();

if (!id) {
  box.innerHTML = '<div class="error-box">No deal selected. <a href="/deals.html">Browse deals</a>.</div>';
} else {
  try {
    const { deal } = await api(`/deals/${encodeURIComponent(id)}`);
    box.innerHTML = facts(deal);
    document.title = `${deal.food_name} | Bite For Less`;
    const form = document.getElementById('reserveForm');
    const saveBtn = document.getElementById('saveDeal');
    if (saveBtn && tokenStore.get()) {
      // Reflect existing favorites truthfully (saved once, toggle never lies).
      const { favorites } = await api('/favorites', { auth: true }).catch(() => ({ favorites: [] }));
      if ((favorites || []).some((f) => f.deal_id === deal.id)) {
        saveBtn.textContent = '★ Saved — open dashboard';
        saveBtn.onclick = () => { location.href = '/dashboards/customer.html#saved'; };
      } else {
        saveBtn.addEventListener('click', async () => {
          try {
            await api('/favorites', { method: 'POST', auth: true, body: { deal_id: deal.id } });
            saveBtn.textContent = '★ Saved — open dashboard';
            saveBtn.onclick = () => { location.href = '/dashboards/customer.html#saved'; };
          } catch (err) {
            setStatus(document.getElementById('reserveStatus'), err.message, 'err');
          }
        });
      }
    }
    if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const status = document.getElementById('reserveStatus');
      if (!tokenStore.get()) {
        location.href = `/login.html?next=${encodeURIComponent('/deal.html?id=' + id)}`;
        return;
      }
      const quantity = Number(document.getElementById('qty').value);
      try {
        setStatus(status, 'Reserving…');
        const { reservation } = await api('/reservations', {
          method: 'POST', auth: true, body: { deal_id: id, quantity }
        });
        setStatus(status, 'Reservation confirmed.', 'ok');
        showConfirmation(reservation, deal);
      } catch (err) {
        setStatus(status, err.message, 'err');
      }
    });
    }
  } catch (err) {
    box.innerHTML = `<div class="error-box">${esc(err.message)} <a href="/deals.html">Back to deals</a>.</div>`;
  }
}
