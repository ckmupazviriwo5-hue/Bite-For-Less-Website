# PROJECT_AUDIT.md — Bite For Less Website (Phase 1)

Date: 2026-10-12 (UTC)
Workspace: `C:\Users\Rog Strix\Desktop\Bite-For-Less-Website` (sibling of Android repo at `C:\Users\Rog Strix\Desktop\BITEFORLESS`)
Remote: `https://github.com/ckmupazviriwo5-hue/Bite-For-Less-Website.git`, branch `main`
Local HEAD: `d0c063f Initial Bite For Less project` (plus `224809b`, `b015eb7` in history)
Status at audit time: clean (`git status --short` empty on website repo), sparse-checkout active (excludes `node-v20/` + `node-v20.17.0-win-x64.zip`)

> This audit is read-only. No commits, pushes, deploys, or production changes were made.

## 1. How the repo was recovered

- Working directory `BITEFORLESS` is the **Android** project (`origin: https://github.com/ckmupazviriwo5-hue/BiteForLess-`, branch `main`), not the website. Left untouched.
- Website repo verified via `git ls-remote` (HEAD `d0c063f`, `refs/heads/main`).
- Full `git clone` failed repeatedly on slow network (stuck at ~39/56 objects, HTTP/2 disconnect / `Recv failure`, ~11 MB transferred). Root cause: large binaries committed (see §5).
- Recovered with blobless sparse clone:
  - `git config --global http.version HTTP/1.1`
  - `git clone --filter=blob:none --sparse <website-url> Bite-For-Less-Website`
  - `git sparse-checkout set --no-cone '/*' '!/*/' 'backend/' 'frontend/' '.vscode/' '!node-v20/' '!node-v20.17.0-win-x64.zip'`
- Result: full source tree except the two Node binary paths. No history rewrite.

## 2. Confirmed findings (evidence-backed)

### 2.1 Stack / entry points (from actual files)
- **Frontend:** plain HTML + CSS + JS, no framework, no bundler. Entry: `frontend/index.html` → `frontend/css/styles.css` + `frontend/js/app.js` (ES module). Brand: orange (`#ff9800`) on near-black. Responsive breakpoints at 760px / 520px.
- **Backend:** Node 20+, ES modules (`"type": "module"` in `package.json`), Express 4 + `better-sqlite3` (SQLite/WAL), `jsonwebtoken`, `bcryptjs`, `helmet`, `cors`, `express-rate-limit`, `dotenv`, `uuid`. Entry: `backend/server.js` (`GET /api/health`, `/api/auth|deals|reservations|reviews|shops|admin`, static serve of `frontend/`, SPA fallback `GET *`).
- **Scripts (`package.json`):** `dev` (nodemon), `start` (node), `migrate`, `seed`, `test` (`node --test`). Deps pinned in `package-lock.json`.
- **Config:** `.env.example` (PORT, JWT_SECRET, ADMIN_EMAIL/PASSWORD, DATABASE_URL, NODE_ENV, FRONTEND_URL). `backend/config/env.js` defaults match. `backend/config/db.js` creates `backend/data/` + 8 tables (users, shops, deals, reservations, reviews, favorites, notifications, payments).
- **Docs present:** only `README.md` (setup: `npm install`, copy `.env`, `npm run migrate`, `npm run seed`, `npm run dev`, open `http://localhost:5000`). **Missing:** `AGENTS.md`, `PROJECT_CONTEXT.md` (recorded as missing per operating rules).
- **Tests present:** `backend/tests/core.test.js` (3 unit tests: `calculateDiscount`, `validateDealInput`, reservation code/PIN format). No frontend tests, no integration tests.
- **VSCode:** `.vscode/launch.json` points at an absolute local path (`c:\Users\Rog Strix\Documents\GitHub\...Bite For Less Food Bridge 2.html`) — broken on this machine.
- **Legacy/reference file:** `Bite For Less Food Bridge 2.html` (~55 KB single-file page, inline CSS, same QRCode.js CDN). Appears to be an earlier static prototype; `frontend/` is the newer split-out version. No doc states which is canonical.

### 2.2 What actually works in code (static reading, not executed — Node is not installed)
- Customer auth (register/login/me/logout), shop-owner register, admin login (`backend/routes/auth.js`).
- Public deals list (active, non-expired, ordered by expiry) + deal detail; shop-owner/admin create/update/cancel deal with validation (`backend/routes/deals.js`, `backend/utils/validation.js`).
- Reserve flow with stock check + SQLite transaction, sold_out flip, payment row (`backend/routes/reservations.js`); verify pickup via PIN or QR token; cancel endpoint exists.
- Shop application (`POST /api/shops/apply`), shop fetch, admin statistics + application approve/reject (`backend/routes/admin.js`, `shops.js`).
- Reviews list + create (gated on a `collected` reservation) (`backend/routes/reviews.js`).
- Seed creates admin + `customer@example.com / password123` + `shopowner@example.com / password123` (Sunrise Bakery + 1 deal, 90-min expiry) (`backend/scripts/seed.js`).
- Frontend renders deals grid, category filter, countdown timers, landing reviews, auth modal (4 tabs), shop application form, and role-based dashboard section (customer reservations + cancel, shop create-deal + verify, admin stats + applications) (`frontend/js/app.js`, ~685 lines).

### 2.3 Gaps / bugs found (file:line)
- **Spec §6.B (customer):** no text search, no sort, no price/discount/availability/location filters (only `dealCategoryFilter` → `renderDeals()` in `frontend/js/app.js:61-69`); no deal-detail view/modal; no quantity picker (always `quantity: 1`, `app.js:102`); no reservation history states (expired/cancelled/completed not shown, `app.js:627-654` lists code+status+PIN only); no profile edit; no loading/empty/error states beyond one generic empty string (`app.js:72,153`); full grid re-render every 1s (`setInterval`, `app.js:680-682`).
- **Spec §6.C (vendor):** no edit/deactivate listing UI, no pickup-location / collection-deadline fields beyond `expires_at`, no remaining-qty/status display, no reservations-for-vendor list (dashboard filters `state.deals` client-side, `app.js:517`), no confirm/complete pickup list, no sales/waste estimates.
- **Spec §6.D (admin):** only stats + applications (`app.js:452-513`, `backend/routes/admin.js`); missing vendor directory + suspend, customer directory, listing management, reservation overview, review/complaint moderation, categories/status management, activity log, analytics. `GET /api/admin/users|shops|deals` exist but have no UI.
- **Spec §6.E:** reviews are read-only on landing (`loadLandingReviews`, `app.js:157`); no review form, no moderation states, no notifications UI (table exists in schema, zero routes/UI).
- **Spec §6.F (lifecycle):** `POST /:id/cancel` sets `cancelled` but **never restores `deals.quantity_remaining`** (`backend/routes/reservations.js:116-128`); no expiry job (expired deals only flipped lazily on reserve attempt, `reservations.js:17-20`; reservations never expire); repeated cancel/verify not idempotent-safe; `PUT /deals/:id` accepts arbitrary `quantity_remaining`/`status` with no invariant checks (`deals.js:106-139`).
- **Routing bug:** `backend/routes/shops.js:28` (`GET /:id`) is registered **before** `GET /me` (`:36`), so `/api/shops/me` matches `:id='me'` and 404s — shop dashboard `loadDashboardData()` (`app.js:417`) will fail.
- **Orphan shops:** `POST /api/shops/apply` inserts `owner_id = makeId('shop_owner')` random value with no user link (`shops.js:21-23`); admin approval therefore never activates a login.
- **Hard-coded demo content:** hero/impact stats (`2,400+`, `86`, `42%`, `8,600`, `1,520`, `6.8 t` in `frontend/index.html:47-57,139-145`); demo creds in modal (`index.html:232,253,263` — note admin email here is `admin@biteforless.app` but seed/README use `admin@biteforless.test`); Unsplash fallback image (`app.js:78`).
- **Landing gaps (spec §6.A/§7):** no Browse Deals / Download Android App CTA pair (only Browse + Join-as-Shop, `index.html:40-43`); no categories section, no vendor/community benefits section, no trust/safety, no contact/about, minimal footer (`index.html:202-214`); external QRCode.js CDN with no offline fallback (`index.html:12`).
- **Auth gaps:** `GET /api/auth/me` does manual JWT verify instead of `authenticate` middleware (`auth.js:77-94`); shop-login UI rejects non-`shop_owner` but admin login is a separate endpoint — role confusion possible.

### 2.4 Repo hygiene (from tree API + local files)
- Committed large binaries: `node-v20.17.0-win-x64.zip` (~29.5 MB) + `node-v20/.../node.exe` (~69.7 MB) + docs (~0.2 MB) — reason clones fail on slow links; licensed third-party binaries in source control with no license note.
- Committed SQLite WAL artifacts: `backend/data/biteforless.db-shm` (32 KB), `.db-wal` (181 KB) — but `.gitignore` only ignores `*.db`/`*.sqlite`, not `-shm`/`-wal`; no `.db` itself present.
- `.env.example` ships default secrets (`change_this_secret`, `admin123`); no `.env` present (correct — untracked).
- `backend/data/` directory present with only shm/wal (no canonical db) — fresh `migrate`+`seed` needed before run.

### 2.5 Toolchain (this machine)
- Git `2.45.1.windows.1` OK; `gh` present but not authed; `dotnet` present; `python`/`python3` are Microsoft-Store stubs (unusable); **Node/npm absent** (`node: command not found`) — backend cannot run/test here yet. The committed `node-v20/` folder was deliberately excluded from checkout; installing official Node 20+ is the correct fix (not fetching 70 MB blobs over this link).

## 3. Assumptions (explicitly unverified — do not treat as fact)
1. `frontend/` (not the single-file `Bite For Less Food Bridge 2.html`) is the intended canonical UI — inferred from server static path + README; needs owner confirmation.
2. Course allows the current stack (plain HTML/CSS/JS + Express/SQLite). No assignment spec or design mockup has been supplied yet.
3. `main` is the default/integration branch (only branch locally and remotely).
4. Seed demo creds are acceptable for local demo (not real users).

## 4. Proposed improvements (not yet approved — for IMPLEMENTATION_PLAN.md)
1. Decide architecture: **(A)** keep Express+SQLite backend (recommended — already ~80% built) vs **(B)** rewrite to local-only `localStorage` prototype per master-prompt §5/§8. This is the load-bearing decision; see plan.
2. Fix correctness bugs: cancel-restore-qty exactly once, expiry job, idempotent verify/cancel/complete, deal-update invariants, `/shops/me` route order, orphan shop-apply link.
3. Complete customer/vendor/admin UI to spec (search/sort/filters, detail views, history states, vendor edit/deactivate, admin directories + moderation + activity log, reviews form, notifications, profile edit, reset-demo-data).
4. Landing: add Download Android App button with central config + coming-soon state, categories, how-it-works vendors, benefits, trust/safety, contact/footer; remove/label invented stats.
5. Hygiene: git-remove binaries + WAL files, extend `.gitignore` (`*.db-shm`, `*.db-wal`, `node-v20/`), fix `.vscode/launch.json` path, document APK path + Vercel static serving, add `TECH_STACK.md` licensing notes.
6. QA: install Node 20+, run `npm install`/`migrate`/`seed`/`test`, add lifecycle tests (over-reserve, double-cancel, expiry-restore, double-collect, persistence), responsive + a11y pass.

## 5. Files inspected for this audit
`README.md`, `package.json`, `.gitignore`, `.env.example`, `frontend/index.html`, `frontend/css/styles.css`, `frontend/js/app.js`, `backend/server.js`, `backend/config/db.js`, `backend/config/env.js`, `backend/routes/{auth,deals,reservations,admin,shops,reviews}.js`, `backend/middleware/auth.js`, `backend/utils/{helpers,validation}.js`, `backend/scripts/{migrate,seed}.js`, `backend/tests/core.test.js`, `.vscode/launch.json`, `Bite For Less Food Bridge 2.html` (head), GitHub tree API, `git log/status/remote`.
