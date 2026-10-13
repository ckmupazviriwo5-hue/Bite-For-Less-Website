// Bite For Less — shared page chrome: header, footer, auth state, reveal motion.
// All URLs are root-absolute (/deals.html, /js/…): the Express static mount and
// the future Vercel Root Directory both serve frontend/ at the site root.
import { tokenStore, currentUser } from './api.js';

const NAV = [
  ['/index.html', 'Home'],
  ['/deals.html', 'Deals'],
  ['/how-it-works.html', 'How It Works'],
  ['/partner.html', 'Become a Partner']
];

function pagePath() {
  return location.pathname === '/' ? '/index.html' : location.pathname;
}

function headerHTML(active, user) {
  const links = NAV.map(([href, label]) =>
    `<a href="${href}"${href === active ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  const auth = user
    ? `<span class="muted small">Hi, ${escapeHTML(user.name.split(' ')[0])}</span>
       <a class="btn btn-secondary btn-sm" href="${dashboardFor(user.role)}">Dashboard</a>
       <button class="btn btn-ghost btn-sm" id="logoutBtn" type="button">Log out</button>`
    : `<a class="btn btn-ghost btn-sm" href="/login.html">Log in</a>
       <a class="btn btn-primary btn-sm" href="/signup.html">Sign up</a>`;
  return `
    <div class="container nav-bar">
      <a class="brand" href="/index.html" aria-label="Bite For Less home">
        <img class="brand-logo" src="/assets/brand/logo-mark.svg" width="36" height="36" alt="" aria-hidden="true" /><span>Bite for <em>Less</em></span>
      </a>
      <button class="nav-toggle" id="navToggle" type="button" aria-expanded="false" aria-controls="siteNav">Menu</button>
      <nav class="nav-links" id="siteNav" aria-label="Main">${links}</nav>
      <div class="nav-auth" id="navAuth">${auth}</div>
    </div>`;
}

function footerHTML() {
  return `
    <div class="container">
      <div class="footer-grid">
        <div>
          <a class="brand" href="/index.html"><img class="brand-logo" src="/assets/brand/logo-mark.svg" width="36" height="36" alt="" aria-hidden="true" /><span>Bite for <em>Less</em></span></a>
          <p class="small mt">Rescuing surplus food with local businesses — demo marketplace for school evaluation.</p>
        </div>
        <div class="footer-nav">
          <div><h4>Explore</h4><a href="/deals.html">Browse deals</a><a href="/how-it-works.html">How it works</a></div>
          <div><h4>Vendors</h4><a href="/partner.html">Become a partner</a><a href="/login.html">Vendor login</a></div>
          <div><h4>Account</h4><a href="/login.html">Log in</a><a href="/signup.html">Sign up</a></div>
        </div>
      </div>
      <div class="footer-base"><span>© ${new Date().getFullYear()} Bite For Less (demo).</span><span id="apkFooterSlot"></span></div>
    </div>`;
}

export function dashboardFor(role) {
  if (role === 'shop_owner') return '/dashboards/vendor.html';
  if (role === 'admin') return '/dashboards/admin.html';
  return '/dashboards/customer.html';
}

export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function renderChrome() {
  const active = pagePath();
  let user = null;
  if (tokenStore.get()) {
    try { user = await currentUser(); }
    catch { tokenStore.clear(); }
  }
  const header = document.getElementById('site-header');
  if (header) {
    header.innerHTML = headerHTML(active, user);
    header.querySelector('#navToggle')?.addEventListener('click', (e) => {
      const btn = e.currentTarget;
      const open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!open));
      header.querySelector('#siteNav')?.classList.toggle('open', !open);
      header.querySelector('#navAuth')?.classList.toggle('open', !open);
    });
    header.querySelector('#logoutBtn')?.addEventListener('click', () => {
      tokenStore.clear();
      location.href = '/index.html';
    });
  }
  const footer = document.getElementById('site-footer');
  if (footer) {
    footer.innerHTML = footerHTML();
    renderApkFooterSlot();
  }
  initReveal();
  return user;
}

// Guards a dashboard page: requires a live session + one of the allowed roles
// (roles re-checked against the backend on every load).
export async function requireRole(roles) {
  let user = null;
  try { user = await currentUser(); } catch { /* no session */ }
  if (!user) {
    location.href = `/login.html?next=${encodeURIComponent(location.pathname.split('/').pop())}`;
    return null;
  }
  if (!roles.includes(user.role)) {
    location.href = dashboardFor(user.role);
    return null;
  }
  return user;
}

function initReveal() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
}

export function setStatus(el, message, kind = '') {
  if (!el) return;
  el.textContent = message;
  el.className = `status ${kind}`;
}

// APK download: configurable URL, honest coming-soon state otherwise.
function renderApkFooterSlot() {
  const slot = document.getElementById('apkFooterSlot');
  if (!slot) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-ghost btn-sm';
  btn.textContent = 'Android app';
  btn.addEventListener('click', () => showApkModal());
  slot.appendChild(btn);
}

export function showApkModal(cfg = window.BFL_CONFIG || {}) {
  const url = ((cfg.APK_URL || '')).trim();
  if (url) { window.open(url, '_blank', 'noopener'); return; }
  const releases = cfg.APK_RELEASES_URL || 'https://github.com/ckmupazviriwo5-hue/BiteForLess-/releases';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-label', 'Android app coming soon');
  modal.innerHTML = `
    <div class="modal-card">
      <button class="modal-close" type="button" aria-label="Close">×</button>
      <span class="eyebrow">Android app</span>
      <h3>Coming soon</h3>
      <p class="muted">The verified Android build will be published as a versioned GitHub Release. Nothing to download yet — no demo file, no placeholders.</p>
      <div class="row-actions">
        <button class="btn btn-primary btn-sm" type="button" data-act="releases">View Releases page</button>
        <button class="btn btn-secondary btn-sm" type="button" data-act="close">Close</button>
      </div>
    </div>`;
  const close = () => modal.remove();
  modal.querySelector('[data-act="close"]').addEventListener('click', close);
  modal.querySelector('.modal-close').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.querySelector('[data-act="releases"]').addEventListener('click', () => {
    window.open(releases, '_blank', 'noopener');
    close();
  });
  document.body.appendChild(modal);
}
