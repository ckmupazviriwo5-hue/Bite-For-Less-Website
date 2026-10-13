const API_BASE = '/api';

const state = {
  authToken: localStorage.getItem('biteForLessToken') || '',
  currentUser: JSON.parse(localStorage.getItem('biteForLessUser') || 'null'),
  deals: [],
  dashboardData: {
    reservations: [],
    shop: null,
    stats: null,
    applications: []
  }
};

async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');

  if (state.authToken) {
    headers.set('Authorization', `Bearer ${state.authToken}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? await response.json() : { success: false, message: 'Something went wrong. Please try again.' };

  if (!response.ok) {
    throw new Error(payload.message || 'Something went wrong. Please try again.');
  }

  return payload;
}

function formatPrice(value) {
  return Number(value).toLocaleString('en-ZM', { style: 'currency', currency: 'ZMW' });
}

function calculateCountdown(expiresAt) {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'Expired';

  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${hours}h ${minutes}m ${seconds}s`;
}

function setStatus(element, message, isError = false) {
  if (!element) return;
  element.textContent = message;
  element.style.color = isError ? '#ff6b6b' : '#ffca70';
}

function renderDeals() {
  const grid = document.getElementById('dealGrid');
  if (!grid) return;

  const filterValue = document.getElementById('dealCategoryFilter')?.value || 'all';
  const visibleDeals = state.deals.filter((deal) => {
    if (filterValue === 'all') return true;
    return deal.category === filterValue;
  });

  if (!visibleDeals.length) {
    grid.innerHTML = '<div class="empty-state">No flash deals available right now.</div>';
    return;
  }

  grid.innerHTML = visibleDeals.map((deal) => `
    <article class="deal-card">
      <img src="${deal.image_url || 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=700&q=80'}" alt="${deal.food_name}" loading="lazy" />
      <div class="deal-body">
        <div class="deal-meta">${deal.shop_name}</div>
        <h3 class="deal-name">${deal.food_name}</h3>
        <div class="price-row">
          <strong>${formatPrice(deal.discounted_price)}</strong>
          <span>${formatPrice(deal.original_price)}</span>
        </div>
        <div class="deal-quantity">${deal.quantity_remaining} left · ${deal.category}</div>
        <div class="deal-timer">Ends in <strong>${calculateCountdown(deal.expires_at)}</strong></div>
        <div class="deal-actions">
          <button class="btn btn-primary reserve-button" type="button" data-deal-id="${deal.id}">Reserve & Get QR</button>
        </div>
      </div>
    </article>
  `).join('');

  grid.querySelectorAll('.reserve-button').forEach((button) => {
    button.addEventListener('click', async () => {
      const dealId = button.dataset.dealId;
      try {
        setStatus(document.getElementById('customerLoginStatus'), '');
        const payload = await apiRequest('/reservations', {
          method: 'POST',
          body: JSON.stringify({ deal_id: dealId, quantity: 1 })
        });

        const reservation = payload.reservation;
        const qrcodeText = `${reservation.qr_token}|${reservation.pickup_pin}|${reservation.reservation_code}`;
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
          <div class="modal-card">
            <button class="modal-close" type="button" aria-label="Close reservation details">×</button>
            <h3>Reservation Confirmed</h3>
            <p><strong>Food:</strong> ${state.deals.find((deal) => deal.id === dealId)?.food_name || 'Flash Deal'}</p>
            <p><strong>Shop:</strong> ${state.deals.find((deal) => deal.id === dealId)?.shop_name || 'Local shop'}</p>
            <p><strong>Quantity:</strong> ${reservation.quantity}</p>
            <p><strong>Amount:</strong> ${formatPrice(reservation.total_amount)}</p>
            <p><strong>Pickup PIN:</strong> ${reservation.pickup_pin}</p>
            <p><strong>Reservation ID:</strong> ${reservation.id}</p>
            <p><strong>Expiry:</strong> ${new Date(reservation.expires_at).toLocaleString()}</p>
            <div id="qrCodeCanvas" style="display:flex; justify-content:center; margin:1rem 0;"></div>
            <button class="btn btn-primary close-modal" type="button">Close</button>
          </div>
        `;

        document.body.appendChild(modal);
        const canvas = modal.querySelector('#qrCodeCanvas');
        if (window.QRCode && canvas) {
          new window.QRCode(canvas, {
            text: qrcodeText,
            width: 170,
            height: 170,
            colorDark: '#ff9800',
            colorLight: '#111111'
          });
        }

        modal.querySelector('.close-modal').addEventListener('click', () => modal.remove());
        modal.querySelector('.modal-close').addEventListener('click', () => modal.remove());
        window.location.hash = '#deals';
      } catch (error) {
        alert(error.message);
      }
    });
  });
}

async function loadDeals() {
  try {
    const response = await apiRequest('/deals');
    state.deals = response.deals || [];
    renderDeals();
  } catch (error) {
    document.getElementById('dealGrid').innerHTML = '<div class="empty-state">No flash deals available right now.</div>';
  }
}

async function loadLandingReviews() {
  try {
    const response = await apiRequest('/reviews');
    const reviews = response.reviews || [];
    const container = document.getElementById('landingReviews');
    if (!container) return;
    if (!reviews.length) {
      container.innerHTML = '<div class="empty-state">No reviews yet.</div>';
      return;
    }

    container.innerHTML = reviews.slice(0, 4).map((review) => `
      <article class="review-card">
        <div class="review-stars">${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}</div>
        <h3>${review.user_name || 'Customer'}</h3>
        <p>“${review.comment || 'Great experience.'}”</p>
      </article>
    `).join('');
  } catch (error) {
    document.getElementById('landingReviews').innerHTML = '<div class="empty-state">No reviews yet.</div>';
  }
}

function syncAuthButtons() {
  const loginNavBtn = document.getElementById('loginNavBtn');
  const signupNavBtn = document.getElementById('signupNavBtn');
  if (!loginNavBtn || !signupNavBtn) return;

  if (state.currentUser) {
    loginNavBtn.textContent = `Hi, ${state.currentUser.name.split(' ')[0]}`;
    signupNavBtn.textContent = 'Logout';
    loginNavBtn.onclick = () => {
      document.getElementById('dashboardSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    signupNavBtn.onclick = () => {
      localStorage.removeItem('biteForLessToken');
      localStorage.removeItem('biteForLessUser');
      state.authToken = '';
      state.currentUser = null;
      window.location.reload();
    };
    return;
  }

  loginNavBtn.textContent = 'Login';
  signupNavBtn.textContent = 'Sign Up';
  loginNavBtn.onclick = () => {
    const modal = document.getElementById('authModal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
    }
  };
  signupNavBtn.onclick = () => {
    const modal = document.getElementById('authModal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
      document.querySelectorAll('.tab').forEach((tab) => {
        const isSignup = tab.dataset.authTab === 'customer-signup';
        tab.classList.toggle('is-active', isSignup);
      });
      document.querySelectorAll('.auth-panel').forEach((panel) => {
        panel.classList.toggle('is-active', panel.id === 'customer-signup');
      });
    }
  };
}

function bindAuthModal() {
  const modal = document.getElementById('authModal');
  const closeBtn = document.getElementById('modalCloseBtn');

  if (!modal) return;

  function openModal() { modal.classList.remove('hidden'); modal.setAttribute('aria-hidden', 'false'); }
  function closeModal() { modal.classList.add('hidden'); modal.setAttribute('aria-hidden', 'true'); }

  closeBtn?.addEventListener('click', closeModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((item) => item.classList.toggle('is-active', item === tab));
      document.querySelectorAll('.auth-panel').forEach((panel) => {
        panel.classList.toggle('is-active', panel.id === tab.dataset.authTab);
      });
    });
  });

  syncAuthButtons();
}

function bindCustomerSignup() {
  const form = document.getElementById('customerSignupForm');
  const status = document.getElementById('customerSignupStatus');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    try {
      const response = await apiRequest('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: formData.get('name'),
          email: formData.get('email'),
          phone: formData.get('phone'),
          password: formData.get('password')
        })
      });
      state.authToken = response.token;
      state.currentUser = response.user;
      localStorage.setItem('biteForLessToken', state.authToken);
      localStorage.setItem('biteForLessUser', JSON.stringify(state.currentUser));
      setStatus(status, 'Account created successfully.');
      document.getElementById('authModal')?.classList.add('hidden');
      syncAuthButtons();
      renderDashboard();
      setTimeout(() => window.location.reload(), 300);
    } catch (error) {
      setStatus(status, error.message, true);
    }
  });
}

function bindCustomerLogin() {
  const form = document.getElementById('customerLoginForm');
  const status = document.getElementById('customerLoginStatus');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    try {
          const response = await apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: formData.get('email'),
          password: formData.get('password')
        })
      });
      state.authToken = response.token;
      state.currentUser = response.user;
      localStorage.setItem('biteForLessToken', state.authToken);
      localStorage.setItem('biteForLessUser', JSON.stringify(state.currentUser));
      setStatus(status, 'Login successful.');
      document.getElementById('authModal')?.classList.add('hidden');
      syncAuthButtons();
      renderDashboard();
      setTimeout(() => window.location.reload(), 300);
    } catch (error) {
      setStatus(status, error.message, true);
    }
  });
}

function bindShopLogin() {
  const form = document.getElementById('shopLoginForm');
  const status = document.getElementById('shopLoginStatus');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    try {
      const response = await apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: formData.get('email'),
          password: formData.get('password')
        })
      });
      if (response.user.role !== 'shop_owner') {
        throw new Error('This account is not registered as a shop owner.');
      }
      state.authToken = response.token;
      state.currentUser = response.user;
      localStorage.setItem('biteForLessToken', state.authToken);
      localStorage.setItem('biteForLessUser', JSON.stringify(state.currentUser));
      setStatus(status, 'Shop login successful.');
      document.getElementById('authModal')?.classList.add('hidden');
      syncAuthButtons();
      renderDashboard();
      setTimeout(() => window.location.reload(), 300);
    } catch (error) {
      setStatus(status, error.message, true);
    }
  });
}

function bindAdminLogin() {
  const form = document.getElementById('adminLoginForm');
  const status = document.getElementById('adminLoginStatus');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    try {
      const response = await apiRequest('/auth/admin/login', {
        method: 'POST',
        body: JSON.stringify({
          email: formData.get('email'),
          password: formData.get('password')
        })
      });
      state.authToken = response.token;
      state.currentUser = response.user;
      localStorage.setItem('biteForLessToken', state.authToken);
      localStorage.setItem('biteForLessUser', JSON.stringify(state.currentUser));
      setStatus(status, 'Admin login successful.');
      document.getElementById('authModal')?.classList.add('hidden');
      syncAuthButtons();
      renderDashboard();
      setTimeout(() => window.location.reload(), 300);
    } catch (error) {
      setStatus(status, error.message, true);
    }
  });
}

function bindShopApplication() {
  const form = document.getElementById('shopApplicationForm');
  const status = document.getElementById('shopApplicationStatus');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    try {
      const payload = await apiRequest('/shops/apply', {
        method: 'POST',
        body: JSON.stringify({
          shop_name: formData.get('shop_name'),
          owner_name: formData.get('owner_name'),
          email: formData.get('email'),
          phone: formData.get('phone'),
          address: formData.get('address'),
          business_info: formData.get('business_info')
        })
      });
      setStatus(status, payload.message);
      form.reset();
    } catch (error) {
      setStatus(status, error.message, true);
    }
  });
}

function bindCategoryFilter() {
  const filter = document.getElementById('dealCategoryFilter');
  if (!filter) return;
  filter.addEventListener('change', renderDeals);
}

function getApkConfig() {
  const config = window.BFL_CONFIG || {};
  const url = (config.APK_URL || '').trim();
  return { url: url || '', releasesUrl: config.RELEASES_URL || config.APK_RELEASES_URL || '' };
}

function showApkModal() {
  const { url, releasesUrl } = getApkConfig();
  if (url) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-label', 'Android app coming soon');
  modal.innerHTML = `
    <div class="modal-card">
      <button class="modal-close" type="button" aria-label="Close Android app notice">×</button>
      <span class="eyebrow">Android app</span>
      <h3>Coming soon</h3>
      <p>The verified Bite For Less Android build isn't published yet. It will ship as a versioned asset on GitHub Releases in the Android repository — never as a source-code ZIP or an unverified file.</p>
      <ul class="apk-modal-list">
        <li>No APK exists yet — nothing to download today.</li>
        <li>Watch the Releases page for the first verified build.</li>
      </ul>
      <div class="dashboard-actions">
        <button class="btn btn-primary open-releases" type="button">View Releases page</button>
        <button class="btn btn-secondary close-modal" type="button">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.close-modal').addEventListener('click', () => modal.remove());
  modal.querySelector('.modal-close').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (event) => { if (event.target === modal) modal.remove(); });
  modal.querySelector('.open-releases').addEventListener('click', () => {
    if (releasesUrl) window.open(releasesUrl, '_blank', 'noopener');
    modal.remove();
  });
}

function bindApkButtons() {
  document.getElementById('apkDownloadBtn')?.addEventListener('click', showApkModal);
  document.getElementById('apkFooterBtn')?.addEventListener('click', showApkModal);
  // If a verified APK_URL is ever configured, hide the coming-soon note.
  if (getApkConfig().url) document.getElementById('apkComingSoonNote')?.remove();
}

async function loadDashboardData() {
  if (!state.currentUser) return;

  try {
    if (state.currentUser.role === 'customer') {
      const response = await apiRequest('/reservations');
      state.dashboardData.reservations = response.reservations || [];
    }

    if (state.currentUser.role === 'shop_owner') {
      const shopResponse = await apiRequest('/shops/me');
      const dealsResponse = await apiRequest('/deals');
      state.dashboardData.shop = shopResponse.shop || null;
      state.dashboardData.reservations = (dealsResponse.deals || []).filter((deal) => {
        return deal.shop_id === shopResponse.shop?.id;
      });
    }

    if (state.currentUser.role === 'admin') {
      const statsResponse = await apiRequest('/admin/statistics');
      const appsResponse = await apiRequest('/admin/applications');
      state.dashboardData.stats = statsResponse.statistics || null;
      state.dashboardData.applications = appsResponse.applications || [];
    }
  } catch (error) {
    console.warn('Dashboard load failed:', error.message);
  }
}

async function renderDashboard() {
  const dashboardSection = document.getElementById('dashboardSection');
  const dashboardContent = document.getElementById('dashboardContent');

  if (!dashboardSection || !dashboardContent) return;

  if (!state.currentUser) {
    dashboardSection.classList.add('hidden');
    return;
  }

  await loadDashboardData();
  dashboardSection.classList.remove('hidden');

  const role = state.currentUser.role;

  if (role === 'admin') {
    const stats = state.dashboardData.stats || {
      total_users: 0,
      total_shops: 0,
      pending_applications: 0,
      active_deals: 0,
      total_reservations: 0,
      food_rescued: 0,
      total_revenue: 0
    };

    const applications = state.dashboardData.applications || [];
    dashboardContent.innerHTML = `
      <div class="dashboard-grid">
        <div class="dashboard-card">
          <h3>Admin Dashboard</h3>
          <p>Welcome, ${state.currentUser.name}</p>
          <ul class="dashboard-list">
            <li><strong>Users:</strong> ${stats.total_users}</li>
            <li><strong>Shops:</strong> ${stats.total_shops}</li>
            <li><strong>Pending apps:</strong> ${stats.pending_applications}</li>
            <li><strong>Active deals:</strong> ${stats.active_deals}</li>
            <li><strong>Reservations:</strong> ${stats.total_reservations}</li>
            <li><strong>Revenue:</strong> K${Number(stats.total_revenue || 0).toFixed(2)}</li>
          </ul>
        </div>
        <div class="dashboard-card">
          <h3>Review Applications</h3>
          <ul class="dashboard-list">
            ${applications.length ? applications.map((shop) => `
              <li>
                <strong>${shop.name}</strong><br>
                ${shop.email}<br>
                <span class="dashboard-pill">${shop.status}</span>
                <div class="dashboard-actions">
                  <button type="button" data-application-id="${shop.id}" data-action="approved">Approve</button>
                  <button type="button" class="danger" data-application-id="${shop.id}" data-action="rejected">Reject</button>
                </div>
              </li>
            `).join('') : '<li>No applications yet.</li>'}
          </ul>
        </div>
      </div>
    `;

    dashboardContent.querySelectorAll('[data-application-id]').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = button.dataset.applicationId;
        const action = button.dataset.action;
        try {
          await apiRequest(`/admin/applications/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: action })
          });
          await renderDashboard();
        } catch (error) {
          alert(error.message);
        }
      });
    });
    return;
  }

  if (role === 'shop_owner') {
    const shop = state.dashboardData.shop || { name: 'Your shop', status: 'pending' };
    const deals = (state.deals || []).filter((deal) => deal.shop_id === shop.id || deal.shop_name === shop.name).slice(0, 6);

    dashboardContent.innerHTML = `
      <div class="dashboard-grid">
        <div class="dashboard-card">
          <h3>Shop Dashboard</h3>
          <p>Welcome back, ${state.currentUser.name}</p>
          <ul class="dashboard-list">
            <li><strong>Shop:</strong> ${shop.name}</li>
            <li><strong>Active deals:</strong> ${deals.length}</li>
            <li><strong>Status:</strong> ${shop.status || 'approved'}</li>
            <li><strong>Pickup workflow:</strong> QR + PIN</li>
          </ul>
        </div>

        <div class="dashboard-card">
          <h3>Create flash deal</h3>
          <form id="shopDealsForm" class="dashboard-form">
            <input type="text" name="food_name" placeholder="Food name" required />
            <input type="text" name="shop_name" value="${shop.name}" placeholder="Shop name" required />
            <input type="number" step="0.01" name="original_price" placeholder="Original price" required />
            <input type="number" step="0.01" name="discounted_price" placeholder="Sale price" required />
            <input type="number" min="1" name="quantity" placeholder="Quantity" required />
            <input type="datetime-local" name="expires_at" required />
            <select name="category">
              <option>Bakery</option>
              <option>Restaurant</option>
              <option>Grocery</option>
              <option>Fruits & Vegetables</option>
              <option>Meals</option>
              <option>Drinks</option>
              <option>Snacks</option>
              <option>Other</option>
            </select>
            <input type="url" name="image_url" placeholder="Image URL" />
            <textarea name="description" rows="3" placeholder="Description"></textarea>
            <button class="btn btn-primary" type="submit">Publish Flash Deal</button>
            <div id="shopDealStatus" class="status-banner" role="status"></div>
          </form>
        </div>

        <div class="dashboard-card">
          <h3>Verify Pickup</h3>
          <form id="reservationVerifyForm" class="dashboard-form">
            <input type="text" name="reservation_id" placeholder="Reservation ID" required />
            <input type="text" name="pickup_pin" placeholder="Pickup PIN" required />
            <button class="btn btn-primary" type="submit">Verify Reservation</button>
            <div id="reservationVerifyStatus" class="status-banner" role="status"></div>
          </form>
        </div>
      </div>
    `;

    const shopForm = document.getElementById('shopDealsForm');
    if (shopForm) {
      shopForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(shopForm);
        const statusEl = document.getElementById('shopDealStatus');

        try {
          const payload = await apiRequest('/deals', {
            method: 'POST',
            body: JSON.stringify({
              food_name: formData.get('food_name'),
              shop_name: formData.get('shop_name'),
              original_price: formData.get('original_price'),
              discounted_price: formData.get('discounted_price'),
              quantity: formData.get('quantity'),
              expires_at: formData.get('expires_at'),
              category: formData.get('category'),
              image_url: formData.get('image_url'),
              description: formData.get('description')
            })
          });
          setStatus(statusEl, payload.message || 'Deal created successfully.');
          shopForm.reset();
          await loadDeals();
          await renderDashboard();
        } catch (error) {
          setStatus(statusEl, error.message, true);
        }
      });
    }

    const verifyForm = document.getElementById('reservationVerifyForm');
    if (verifyForm) {
      verifyForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(verifyForm);
        const statusEl = document.getElementById('reservationVerifyStatus');

        try {
          const reservationId = formData.get('reservation_id');
          const pickupPin = formData.get('pickup_pin');
          const payload = await apiRequest(`/reservations/${reservationId}/verify`, {
            method: 'POST',
            body: JSON.stringify({ pickup_pin: pickupPin })
          });
          setStatus(statusEl, payload.message || 'Reservation verified.');
          verifyForm.reset();
          await renderDashboard();
        } catch (error) {
          setStatus(statusEl, error.message, true);
        }
      });
    }
    return;
  }

  const reservations = state.dashboardData.reservations || [];
  dashboardContent.innerHTML = `
    <div class="dashboard-grid">
      <div class="dashboard-card">
        <h3>My Account</h3>
        <ul class="dashboard-list">
          <li><strong>Name:</strong> ${state.currentUser.name}</li>
          <li><strong>Email:</strong> ${state.currentUser.email}</li>
          <li><strong>Role:</strong> ${state.currentUser.role}</li>
        </ul>
      </div>
      <div class="dashboard-card">
        <h3>My Reservations</h3>
        <ul class="dashboard-list">
          ${reservations.length ? reservations.map((reservation) => `
            <li>
              <strong>${reservation.reservation_code}</strong><br>
              ${reservation.status}<br>
              <span class="dashboard-pill">PIN ${reservation.pickup_pin || '—'}</span>
              <div class="dashboard-actions">
                <button type="button" data-reservation-id="${reservation.id}" data-action="cancel">Cancel</button>
              </div>
            </li>
          `).join('') : '<li>No reservations yet.</li>'}
        </ul>
      </div>
    </div>
  `;

  dashboardContent.querySelectorAll('[data-reservation-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.reservationId;
      try {
        await apiRequest(`/reservations/${id}/cancel`, { method: 'POST' });
        await renderDashboard();
      } catch (error) {
        alert(error.message);
      }
    });
  });
}

async function initialize() {
  bindAuthModal();
  bindApkButtons();
  bindCustomerSignup();
  bindCustomerLogin();
  bindShopLogin();
  bindAdminLogin();
  bindShopApplication();
  bindCategoryFilter();
  await renderDashboard();
  loadDeals();
  loadLandingReviews();
  setInterval(() => {
    if (state.deals.length) renderDeals();
  }, 1000);
}

document.addEventListener('DOMContentLoaded', initialize);
