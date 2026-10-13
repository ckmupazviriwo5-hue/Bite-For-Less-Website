// Partner application → POST /api/shops/apply (public, validated server-side).
import { api } from './api.js';
import { renderChrome, setStatus } from './layout.js';

await renderChrome();
document.getElementById('partnerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('partnerStatus');
  const data = Object.fromEntries(new FormData(e.target).entries());
  try {
    setStatus(status, 'Sending…');
    const res = await api('/shops/apply', { method: 'POST', body: data });
    setStatus(status, res.message || 'Application received. We will review it shortly.', 'ok');
    e.target.reset();
  } catch (err) {
    setStatus(status, err.message, 'err');
  }
});
