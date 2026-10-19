# PROJECT_AUDIT.md — Bite For Less Website (Phase 1)

Date: 2026-10-12 (UTC)

---

# ADDENDUM — Local-mode audit update (2026-10-18)

This addendum supersedes sections 4 (proposal) with what was actually executed, and
records this phase's root-caused defects. Everything below refers to
`C:\Users\Rog Strix\Desktop\Bite-For-Less-Website`.

## A. Where the project stands now

- **Architecture chosen:** Option A — the Express + better-sqlite3 backend is the ONE
  active data plane; the premium frontend design was preserved and wired to it.
  Hosted Supabase (`ktvlytdmjqkcdeahgdqy`) is untouched and retired from every active
  code path (documented fallback only).
- **Tests: 42/42 green** (`node --test`): workflows (:5001), vendor-onboarding (:5002),
  core, pages, supabase-catalog suites. Integration coverage spans the whole lifecycle:
  register/login, reservations (over-reserve, double-cancel, expiry-restore, double-collect,
  ownership), vendor deal ownership, admin approval/suspension, canonical six-step
  onboarding, multipart uploads (real PNG accepted; spoofed text rejected; >5 MB rejected),
  favorites idempotency, announcement fan-out, category management, admin visibility.
- **Real demo DB verified clean:** 8 users / 6 shops / 17 deals / 10 categories / 1
  announcement / 3 reviews / 0 reservations — all genuine seed data; no test artifacts
  (via `backend/scripts/check-runner-rows.mjs`; backups exist in `backend/data/backups/`).
- **Dozens of files changed + new files exist as UNCOMMITTED work in the working tree.**
  Per instructions, nothing has been committed or pushed this phase.

## B. Root-caused and fixed this phase (the interesting ones)

1. **Test suite silently opened the REAL demo database.** ESM hoisted the whole
   import graph above `process.env.DATABASE_URL = …`, so test seeding (Shop One/Two,
   `Food ####` deals, `@bfl.test` users) landed in `backend/data/biteforless.db`.
   Fixed by env-before-dynamic-import in every suite **plus** a hard guard in
   `config/db.js`: a test run (`NODE_TEST_CONTEXT`/argv/--test) that loads the module
   without an explicit `DATABASE_URL` now throws instead of polluting. A ghost "Food
   22e4"-style row set seen in a mid-session read was an uncommitted WAL artifact from
   the pre-fix era and vanished on checkpoint/recovery — current file verified clean.
2. **`config/db.js` rebuilt `users` + `deals` on EVERY boot.** The CHECK-constraint
   rebuild detector read `table_info` (missing added columns) instead of
   `sqlite_master.sql`, so two core tables were copy-dropped-renamed each boot.
   Now rebuilds only when the declared schema genuinely lacks the widened words.
3. **`routes/vendors.js` half-upgraded state killed every server boot.** It referenced
   removed helpers (`uploadGuard`/`saveImage`/`removeUpload`), wasn't mounted in
   `server.js`, and didn't export `signToken` that `auth.js` imports — the source of
   the historic `ECONNREFUSED` on :5000 after API changes. All fixed: disk-based
   upload path (multer → magic-byte sniff → `/uploads/<kind>/<hex>`), exports
   aligned, `/api/vendors` mounted.
4. **Admin approval didn't activate wizard-created pending ownships** (only orphan
   applications were linked by email). Approval now activates the pending owner
   account in both paths inside the same transaction.
5. **Admin visibility gaps:** categories and reviews lists only ever returned ACTIVE /
   PUBLISHED rows, so suspended categories and hidden reviews were unrecoverable from
   the dashboard. Added `?all=1` admin branches (optional-token middleware) on
   `/api/categories` and `/api/reviews`.
6. **Reservation create response** now uses the join select so `food_name`/`shop_name`
   are present in the immediate POST payload (was `r.*` raw).
7. **Stale frontend dashboards** rewritten against the live contract: vendor
   (approval banner + publish gate, real photo/logo/cover uploads, own-listings incl.
   paused via `/api/deals/mine`, profile editing, alerts), customer (favorites,
   notifications, change-password, cancel), admin (full moderation scope incl. users,
   categories, announcements, reviews, activity).
8. **Contract naming normalized:** `GET /api/admin/vendors`, `PATCH
   /api/admin/vendors/:id/status` (old `/applications` name removed from tests),
   `GET /api/vendors/me/dashboard` + alias. Sparse `get /api/shops/me` vs
   catalogue field mismatches resolved in page code.

## C. Deliverables produced this phase

- `docs/LOCAL_API_CONTRACT.md` — **LOCAL API CONTRACT READY** (the Android handoff document).
- `docs/LOCAL_DEMO_SETUP.md` — setup, demo accounts, seed/migrate, firewall guidance,
  troubleshooting.
- `docs/PRESENTATION_GUIDE.md` — 12-step demo script + manual browser QA matrix.
- `start.bat` — first-run aware launcher (migrate+seed if DB missing, nodemon, open browser).
- Ops tools: `server.js` JSON-404 for unknown `/api/*` + JSON multer error mapping
  ("Image too large — 5 MB maximum." → 400).

## D. Remaining known gaps (explicit, not hidden)

- Browser-level QA is manual (see PRESENTATION_GUIDE matrix) — no Playwright/Puppeteer
  in this environment; backend behaviours backing every matrix row ARE integration-tested.
- The empty-state media on some landing sections still references a couple of remote
  Unsplash URLs (`img-src` CSP allows them) — offline fallbacks exist where it matters
  (deal cards, seed art). Cosmetic only.
- `.env` intentionally absent (defaults documented in `.env.example`); `JWT_SECRET`
  auto-generating is the sanctioned alternative.
- Old legacy docs at repo root (`SUPABASE_MIGRATION.md`, `DEPLOYMENT.md`, `QA_REPORT.md`,
  `MEDIA_PLAN.md`, `TECH_STACK.md`) describe earlier phases and are retained as history;
  the active demos should use the three docs under `docs/`.
- Nothing committed — the entire local refactor awaits user review/approval before any
  `git add/commit` or push.

---

# PHASE 1 AUDIT (historical) — 2026-10-12

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

---

## 6. Addendum — 2026-10-18: local-first implementation executed + independent verification

Status line: decision **(A)** from §4 was taken and built out. The Express + better-sqlite3
backend is now the only active data path; hosted Supabase is retired to a non-active fallback
(config flip only — the hosted project remains untouched, per the no-hosted-mutation rule).
No commits, pushes, or deploys have been made yet.

### 6.1 What the implementation added (backend)
- Full route set: auth (unified login + admin login + change-password), vendors onboarding
  (`/api/vendors/register` single-transaction account+shop), shops (`/me`, `/me/dashboard`,
  `/me/reservations`, logo/cover uploads), deals (catalog + `/mine` + CRUD + image upload),
  reservations (stock-guarded create, PIN/QR verify, exactly-once cancel restore, sweep),
  admin (statistics, vendor/user/deal moderation, reservations, activity, announcements),
  categories (public + admin CRUD), notifications (fan-out announcements), favorites, reviews
  (collected-gated posting + admin moderation).
- `backend/config/db.js`: WAL SQLite + additive idempotent migrations 1–5; throws if a test
  run would open the real database without `DATABASE_URL` override (anti-leak guard).
- Multer disk uploads with magic-byte sniffing, 5 MB cap, randomized names under
  `backend/uploads/{products,logos,covers,profiles}`; `uploads/demo/` holds seeded art.
- JWT secret persisted to `backend/data/.jwt-secret`; bcrypt; role/server-side enforced;
  suspended/disabled accounts blocked on every authenticated request.
- `start.bat` (repo root): first-run migrate+seed, nodemon, opens http://localhost:5000.

### 6.2 Incident record — test-suite leak into dev DB (root cause + remediation)
Root cause (fixed): `backend/tests/workflows.test.js` statically imported `helpers.js`, whose
own static import chain opened `config/db.js` BEFORE the test assigned `DATABASE_URL` (ESM
static-import hoisting). Fix: dynamic imports after env assignment; retention of the db.js
hard guard. Residual leak from earlier runs was cleaned with
`backend/scripts/remove-test-artifacts.mjs` (backup BEFORE deletes:
`backend/data/backups/biteforless-phase0-2026-10-18T11-24-58.db`): 5 `@bfl.test` users,
2 shops, 2 junk deals + child rows removed → 8 users / 6 shops / 17 deals genuine demo rows left.

### 6.3 Verification-session fixes (this audit's companion pass, 2026-10-18)
1. `backend/routes/vendors.js` — `signToken` exported (auth.js imports it); server now boots.
2. `backend/routes/reviews.js` — admin `?all=1` left an EMPTY `WHERE` clause
   (`WHERE  ORDER BY …` → SqliteError 500, empty body). Fixed to `WHERE 1=1`; this 500 was also
   silently aborting the admin dashboard's whole load chain ("API endpoint not found." UI).
3. `frontend/js/dash-vendor.js` — `Promise.all` destructure missing braces around the
   `/deals/mine` payload → `myDeals` got the envelope object (truthy but lengthless) → "My
   listings" always empty despite `200 deals=7`. Fixed (array destructured).
4. `frontend/js/supabase-catalog.js` — `eligibilityState` required Supabase-only fields
   (`listing_status`, `vendor_status`) → in express mode every deal detail showed
   "Temporarily unavailable" and disabled Reserve. Now model-aware; express-shape +
   supabase-shape regression cases added to `backend/tests/supabase-catalog.test.js`.
5. `backend/scripts/seed.js` — added idempotent demo revive: expired listings of
   `@example.com` demo shops with stock left get a fresh 6h window on re-seed, so the catalog
   is live on any presentation date (sold-out/paused/cancelled examples stay honest).

### 6.4 Verified end state (evidence)
- `npm.cmd test` → **42/42 pass** (workflows :5001, vendor-onboarding :5002, core, pages,
  supabase-catalog). Tests never touch the real DB or :5000.
- Live dev server on :5000 (`/api/health` → sqlite/local). Storefront: 15 live deals, ZMW
  pricing, `/uploads/demo/*.jpg` all 200.
- Reservation round-trip on the REAL dev DB as `customer@example.com`:
  reserve 2 croissants → `BFL-3B320454`, PIN 1887, K 70.00, stock 6→4; cancel → stock back to 6.
  CCTV: customer dashboard history shows the cancelled code+PIN; 1 unread alert created.
- Authenticated dashboard renders (Edge headless + temporary token-injection helper, files
  since removed): admin (stats + vendor approvals + moderation lists), vendor (6/7 listings,
  Edit/Deactivate), customer (history + alerts). Role guard: customer token on admin.html
  auto-redirects to the customer dashboard.
- Mobile nav false alarm closed: the "missing hamburger at 390px" is a headless-Edge DPI
  artifact (CSS viewport 492 px, screenshot crops at 390 physical px). DOM dump + computed
  style + a click-through screenshot prove the toggle renders and opens the drawer.

### 6.5 Still outstanding (unchanged policy)
- Git: large uncommitted working set; nothing committed/pushed. Hosting/deploy and any hosted
  DB writes remain approval-gated. Android repo untouched.
- `frontend/js/config.js` already local-first (`DATA_BACKEND: 'express'`, empty `APK_URL`,
  releases-driven Install button, disabled until a verified release exists).
- Historical note: `docs/LOCAL_API_CONTRACT.md` + `docs/LOCAL_DEMO_SETUP.md` carry the full
  handoff contract and setup; `docs/PRESENTATION_DEMO.md` is the live walkthrough script.
