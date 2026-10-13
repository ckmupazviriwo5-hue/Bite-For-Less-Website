// Single login for all roles + customer signup.
// The backend's trusted role decides the destination — the page never asks for,
// and never trusts, a user-chosen role.
import { api, tokenStore } from './api.js';
import { renderChrome, dashboardFor, setStatus } from './layout.js';

await renderChrome();

const next = new URLSearchParams(location.search).get('next');
const destFor = (role) => (next && !next.includes('://') ? next : dashboardFor(role));

const loginForm = document.getElementById('loginForm');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = document.getElementById('loginStatus');
    const data = Object.fromEntries(new FormData(loginForm).entries());
    try {
      setStatus(status, 'Logging in…');
      const res = await api('/auth/login', { method: 'POST', body: data });
      tokenStore.set(res.token);
      location.href = destFor(res.user.role);
    } catch (err) {
      setStatus(status, err.message, 'err');
    }
  });
}

const signupForm = document.getElementById('signupForm');
if (signupForm) {
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = document.getElementById('signupStatus');
    const data = Object.fromEntries(new FormData(signupForm).entries());
    try {
      setStatus(status, 'Creating your account…');
      const res = await api('/auth/register', { method: 'POST', body: data });
      tokenStore.set(res.token);
      location.href = destFor(res.user.role);
    } catch (err) {
      setStatus(status, err.message, 'err');
    }
  });
}
