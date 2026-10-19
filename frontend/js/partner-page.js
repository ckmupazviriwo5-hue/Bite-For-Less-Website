// Shop-owner onboarding wizard (six steps → one canonical submit).
// Implements the LOCAL_API_CONTRACT "VENDOR ONBOARDING" group:
//   POST /api/vendors/register   (transactional account + shop application)
//   POST /api/vendors/me/logo    (multipart, after sign-in)
//   POST /api/vendors/me/cover   (multipart, after sign-in)
// Draft state persists in localStorage (passwords and files never persist).
import { api, apiUpload, tokenStore } from './api.js';
import { renderChrome, escapeHTML, setStatus } from './layout.js';

const $ = (sel, root = document) => root.querySelector(sel);
const mount = document.getElementById('onboardingApp');
await renderChrome();

const DRAFT_KEY = 'bfl_vendor_draft_v1';

const STEPS = [
  { id: 'identity', title: 'Business identity', icon: '🏪' },
  { id: 'contact', title: 'Contact', icon: '📞' },
  { id: 'location', title: 'Location', icon: '📍' },
  { id: 'operations', title: 'Operations', icon: '🕒' },
  { id: 'account', title: 'Owner account', icon: '👤' },
  { id: 'review', title: 'Review & submit', icon: '✅' }
];

// ---------------------------------------------------------------------------
// State — text fields persist in a draft; files stay in memory for this visit.
// ---------------------------------------------------------------------------
const state = {
  step: 0,
  values: {
    shop_name: '', business_type: 'Bakery', description: '',
    phone: '', whatsapp_number: '', preferred_contact: 'phone',
    city: '', area: '', address: '',
    opening_hours: '', pickup_window_start: '09:00', pickup_window_end: '19:00', pickup_instructions: '',
    owner_name: '', email: '', password: '', confirm_password: '',
    owner_phone: ''
  },
  agree_terms: false,
  logo: null, cover: null
};

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return 0;
    const saved = JSON.parse(raw);
    for (const [k, v] of Object.entries(saved.values || {})) {
      if (k in state.values && k !== 'password' && k !== 'confirm_password') state.values[k] = v ?? state.values[k];
    }
    state.step = Number(saved.step) || 0;
    return state.step;
  } catch {
    return 0;
  }
}

function saveDraft() {
  const persisted = {
    step: state.step,
    values: Object.fromEntries(Object.entries(state.values).filter(([k]) => k !== 'password' && k !== 'confirm_password')),
    agree_terms: state.agree_terms
  };
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(persisted)); } catch { /* storage full/private */ }
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Per-step validation. Returns an error string or null.
// ---------------------------------------------------------------------------
function validateStep(i) {
  const v = state.values;
  if (i === 0) {
    if (v.shop_name.trim().length < 2) return 'Give your business a name (at least 2 characters).';
    if (v.description.trim().length < 10) return 'Add a short description (at least 10 characters) so shoppers know what you sell.';
    return null;
  }
  if (i === 1) {
    if (v.phone.trim().length < 7) return 'Enter a reachable phone number (this becomes the login phone too).';
    return null;
  }
  if (i === 2) {
    if (v.city.trim().length < 2) return 'Which city is your shop in?';
    if (v.address.trim().length < 5) return 'Give a pickup address shoppers can find.';
    return null;
  }
  if (i === 3) {
    if (!/^\d{2}:\d{2}$/.test(v.pickup_window_start) || !/^\d{2}:\d{2}$/.test(v.pickup_window_end)) return 'Pickup windows must be times like 09:00.';
    if (v.pickup_window_start >= v.pickup_window_end) return 'The pickup window must start before it ends.';
    if (!state.agree_terms) return 'Please agree to the listing and food-safety rules.';
    return null;
  }
  if (i === 4) {
    if (v.owner_name.trim().length < 2) return 'Enter the owner\u2019s full name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) return 'Enter a valid login email address.';
    if (v.password.length < 6) return 'Password must be at least 6 characters long.';
    if (v.password !== v.confirm_password) return 'Passwords do not match.';
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function inputRow({ key, label, type = 'text', attrs = '', hint = '' }) {
  const val = escapeHTML(state.values[key] ?? '');
  return `
    <label class="field">${label}
      <input type="${type}" data-key="${key}" value="${val}" ${attrs} />
      ${hint ? `<span class="muted small">${hint}</span>` : ''}
    </label>`;
}

function render() {
  const stepDef = STEPS[state.step];
  const dots = STEPS.map((s, i) => `
    <button class="wiz-dot${i === state.step ? ' active' : ''}${i < state.step ? ' done' : ''}" type="button"
      data-goto="${i}" ${i > state.step ? 'disabled' : ''}
      title="Step ${i + 1}: ${escapeHTML(s.title)}" aria-label="Step ${i + 1}: ${escapeHTML(s.title)}">${i < state.step ? '✓' : i + 1}</button>`).join('');

  const fileWell = (key, label, preview) => `
    <div class="file-well" data-well="${key}">
      ${preview ? `<img src="${preview}" alt="" />` : '<div class="file-well-empty" aria-hidden="true">🖼️</div>'}
      <label class="btn btn-secondary btn-sm">
        ${state[key] ? label.replace('(optional)', '(picked)') : label}
        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-file="${key}" hidden />
      </label>
      <span class="muted small">JPEG, PNG, WebP or GIF · up to 5 MB</span>
    </div>`;

  const logoPreview = previewFor('logo', state.logo);
  const coverPreview = previewFor('cover', state.cover);

  let body = '';
  if (state.step === 0) {
    body = `
      ${inputRow({ key: 'shop_name', label: 'Business name', attrs: 'maxlength="80" placeholder="Mama Chanda\u2019s Bakery"' })}
      <div class="form-row">
        <label class="field">Business type
          <select data-key="business_type">
            ${['Bakery', 'Restaurant', 'Grocery', 'Fruits & Vegetables', 'Meals', 'Drinks', 'Snacks', 'Other'].map((t) =>
              `<option${state.values.business_type === t ? ' selected' : ''}>${escapeHTML(t)}</option>`).join('')}
          </select>
        </label>
        <div></div>
      </div>
      <label class="field">What do you sell? When is surplus available?
        <textarea data-key="description" rows="3" maxlength="500" placeholder="e.g. End-of-day bread and pastries at fair prices, ready from 17:00.">${escapeHTML(state.values.description)}</textarea>
      </label>
      <div class="form-row">
        ${fileWell('logo', 'Choose a logo (optional)', logoPreview)}
        ${fileWell('cover', 'Choose a cover photo (optional)', coverPreview)}
      </div>`;
  } else if (state.step === 1) {
    body = `
      ${inputRow({ key: 'phone', label: 'Business phone (also the login phone)', type: 'tel', attrs: 'maxlength="30" placeholder="+260 97 000 0000"' })}
      ${inputRow({ key: 'whatsapp_number', label: 'WhatsApp number (optional)', type: 'tel', attrs: 'maxlength="30"' })}
      <label class="field">Preferred contact method
        <select data-key="preferred_contact">
          <option value="phone"${state.values.preferred_contact === 'phone' ? ' selected' : ''}>Phone calls</option>
          <option value="whatsapp"${state.values.preferred_contact === 'whatsapp' ? ' selected' : ''}>WhatsApp</option>
        </select>
      </label>`;
  } else if (state.step === 2) {
    body = `
      <div class="form-row">
        ${inputRow({ key: 'city', label: 'City', attrs: 'maxlength="60" placeholder="Lusaka"' })}
        ${inputRow({ key: 'area', label: 'Area / neighbourhood', attrs: 'maxlength="60" placeholder="Kabwata"' })}
      </div>
      ${inputRow({ key: 'address', label: 'Pickup address', attrs: 'maxlength="160" placeholder="12 Kabwata Road, Lusaka"' })}
      <p class="muted small">Country: <strong>Zambia</strong> (transactions are listed in Zambian Kwacha).</p>`;
  } else if (state.step === 3) {
    body = `
      ${inputRow({ key: 'opening_hours', label: 'Business hours', attrs: 'maxlength="80" placeholder="Mon–Sat 07:00–19:00"' })}
      <div class="form-row">
        <label class="field">Pickup window start
          <input type="time" data-key="pickup_window_start" value="${escapeHTML(state.values.pickup_window_start)}" />
        </label>
        <label class="field">Pickup window end
          <input type="time" data-key="pickup_window_end" value="${escapeHTML(state.values.pickup_window_end)}" />
        </label>
      </div>
      <label class="field">Pickup instructions
        <textarea data-key="pickup_instructions" rows="2" maxlength="300" placeholder="e.g. Ask for Mama Chanda at the counter.">${escapeHTML(state.values.pickup_instructions)}</textarea>
      </label>
      <label class="check-terms"><input type="checkbox" data-check="agree_terms"${state.agree_terms ? ' checked' : ''} />
        <span>I agree to the listing rules and confirm the food I list is safe to sell (Zambian food-safety rules apply).</span>
      </label>`;
  } else if (state.step === 4) {
    body = `
      ${inputRow({ key: 'owner_name', label: 'Owner full name', attrs: 'maxlength="80"' })}
      ${inputRow({ key: 'email', label: 'Login email', type: 'email', attrs: 'maxlength="120" placeholder="you@example.com"' })}
      ${inputRow({ key: 'password', label: 'Password', type: 'password', attrs: 'minlength="6" placeholder="At least 6 characters"', hint: 'Passwords are hashed with bcrypt — never stored readable.' })}
      ${inputRow({ key: 'confirm_password', label: 'Confirm password', type: 'password', attrs: 'minlength="6"' })}
      <p class="muted small">Already signed in? Submitting creates a separate shop-owner account.</p>`;
  } else {
    body = `
      <ul class="review-list">
        <li><span>Business</span><span>${escapeHTML(state.values.shop_name)} · ${escapeHTML(state.values.business_type)}</span></li>
        <li><span>Description</span><span class="small">${escapeHTML(state.values.description)}</span></li>
        <li><span>Phone / WhatsApp</span><span>${escapeHTML(state.values.phone)} · ${escapeHTML(state.values.whatsapp_number || '—')}</span></li>
        <li><span>Location</span><span>${escapeHTML(state.values.address)}, ${escapeHTML(state.values.area || '—')}, ${escapeHTML(state.values.city)}</span></li>
        <li><span>Operations</span><span>${escapeHTML(state.values.opening_hours || '—')} · window ${escapeHTML(state.values.pickup_window_start)}–${escapeHTML(state.values.pickup_window_end)}</span></li>
        <li><span>Owner</span><span>${escapeHTML(state.values.owner_name)} · ${escapeHTML(state.values.email)}</span></li>
        <li><span>Images</span><span>${state.logo ? 'logo ✓' : 'logo —'} · ${state.cover ? 'cover ✓' : 'cover —'} </span></li>
        <li><span>Rules</span><span>${state.agree_terms ? 'If accepted ✓' : 'Not accepted — go back'}</span></li>
      </ul>
      ${state.logo && state.cover ? '' : '<p class="muted small">Images stay optional — you can add or replace them later in your dashboard.</p>'}`;
  }

  const isReview = state.step === 5;
  mount.innerHTML = `
    <h3>Become a partner</h3>
    <div class="wiz-progress" aria-hidden="true"><div class="wiz-progress-fill" style="width:${((state.step + 1) / STEPS.length) * 100}%"></div></div>
    <div class="wiz-steps">${dots}</div>
    <p class="eyebrow">Step ${state.step + 1} of 6 — ${escapeHTML(stepDef.title)} ${stepDef.icon}</p>
    <div class="form-grid wiz-body">${body}</div>
    <div class="status" id="wizStatus" role="status"></div>
    <div class="wiz-nav">
      <button class="btn btn-secondary" type="button" id="wizBack"${state.step === 0 ? ' hidden' : ''}>Back</button>
      <button class="btn btn-primary" type="button" id="wizNext">${isReview ? 'Submit application' : 'Next'}</button>
    </div>
    <p class="muted small mt" data-draft-note hidden>Draft saved locally — your progress is kept on this computer.</p>
  `;

  wire();
}

// Object-URL previews are created per render; stale URLs are revoked.
const previews = { logo: null, cover: null };
function previewFor(kind, file) {
  if (previews[kind]) URL.revokeObjectURL(previews[kind]);
  previews[kind] = file ? URL.createObjectURL(file) : null;
  return previews[kind];
}
function drainPreviews() {
  ['logo', 'cover'].forEach((k) => {
    if (previews[k]) { URL.revokeObjectURL(previews[k]); previews[k] = null; }
  });
}

function wire() {
  mount.querySelectorAll('[data-key]').forEach((el) => {
    el.addEventListener('change', () => {
      state.values[el.dataset.key] = el.type === 'checkbox' ? el.checked : el.value;
      saveDraft();
      showDraftNote();
    });
    el.addEventListener('input', () => {
      state.values[el.dataset.key] = el.value;
      saveDraft();
      showDraftNote();
    });
  });
  mount.querySelectorAll('[data-check]').forEach((el) => {
    el.addEventListener('change', () => {
      state.agree_terms = el.checked;
      saveDraft();
    });
  });
  mount.querySelectorAll('[data-file]').forEach((el) => {
    el.addEventListener('change', () => {
      const kind = el.dataset.file;
      const file = el.files && el.files[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        setStatus($('#wizStatus'), 'That image is larger than 5 MB — pick a smaller one.', 'err');
        return;
      }
      state[kind] = file;
      revokePreviews();
      render();
    });
  });
  mount.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => {
    const target = Number(b.dataset.goto);
    if (target >= state.step) return; // completed steps only — no skipping ahead
    state.step = target;
    saveDraft();
    render();
  }));
  $('#wizBack').addEventListener('click', () => {
    if (state.step > 0) {
      state.step -= 1;
      saveDraft();
      render();
    }
  });
  $('#wizNext').addEventListener('click', async () => {
    const err = validateStep(state.step);
    if (err) return setStatus($('#wizStatus'), err, 'err');
    if (state.step < 5) {
      state.step += 1;
      saveDraft();
      render();
      return;
    }
    await submit();
  });
}

function showDraftNote() {
  const note = mount.querySelector('[data-draft-note]');
  if (note) note.hidden = false;
}

// ---------------------------------------------------------------------------
// Submission: canonical JSON create → optional image uploads → dashboard.
// ---------------------------------------------------------------------------
async function submit() {
  const btn = $('#wizNext');
  const status = $('#wizStatus');
  btn.disabled = true;
  setStatus(status, 'Submitting…');
  const payload = {
    owner_name: state.values.owner_name.trim(),
    shop_name: state.values.shop_name.trim(),
    email: state.values.email.trim(),
    phone: state.values.phone.trim(),
    whatsapp_number: state.values.whatsapp_number.trim(),
    business_type: state.values.business_type,
    description: state.values.description.trim(),
    address: state.values.address.trim(),
    city: state.values.city.trim(),
    area: state.values.area.trim(),
    opening_hours: state.values.opening_hours.trim(),
    pickup_instructions: state.values.pickup_instructions.trim(),
    pickup_window_start: state.values.pickup_window_start,
    pickup_window_end: state.values.pickup_window_end,
    password: state.values.password,
    agree_terms: true
  };
  let session = null;
  try {
    session = await api('/vendors/register', { method: 'POST', body: payload });
  } catch (err) {
    btn.disabled = false;
    setStatus(status, err.message, 'err');
    return;
  }

  tokenStore.set(session.token);
  setStatus(status, 'Application received — uploading images…', 'ok');

  const problems = [];
  for (const [kind, path] of [['logo', '/vendors/me/logo'], ['cover', '/vendors/me/cover']]) {
    if (!state[kind]) continue;
    try {
      const fd = new FormData();
      fd.append('image', state[kind]);
      await apiUpload(path, fd);
    } catch (err) {
      problems.push(`${kind}: ${err.message}`);
    }
  }

  clearDraft();
  drainPreviews();
  setTimeout(() => {
    location.href = '/dashboards/vendor.html?application=submitted';
  }, problems.length ? 2500 : 700);
  if (problems.length) {
    setStatus(status, `Shop submitted, but image upload failed (${problems.join('; ')}). You can add images from your dashboard.`, 'err');
  }
}

// ---------------------------------------------------------------------------
// Existing-vendor notice: someone already signed in with a shop sees guidance
// instead of a duplicate application path.
// ---------------------------------------------------------------------------
mount.innerHTML = '<div class="status">Loading onboarding…</div>';
let signedInNotice = '';
try {
  const me = await api('/auth/me', { auth: true });
  if (me && me.user && me.user.role === 'shop_owner') {
    signedInNotice = `
      <h3>You are already a vendor</h3>
      <p class="muted">This account already has a shop record. Open your dashboard to view its approval status, edit the profile and publish listings once approved.</p>
      <a class="btn btn-primary" href="/dashboards/vendor.html">Open shop dashboard</a>`;
  } else if (me && me.user && me.user.role === 'admin') {
    signedInNotice = `
      <h3>Administrators cannot apply</h3>
      <p class="muted">The signed-in account is an administrator. Applications are for new shop owners:</p>
      <a class="btn btn-secondary" href="/dashboards/admin.html">Open admin dashboard</a>`;
  }
} catch { /* anonymous — wizard proceeds */ }

if (signedInNotice) {
  mount.innerHTML = signedInNotice;
} else {
  loadDraft();
  render();
}
