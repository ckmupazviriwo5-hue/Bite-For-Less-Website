# QA_REPORT.md — Functional QA and release readiness

Date: 2026-10-13. Server: `http://localhost:5000` (running, nodemon). Test DB: isolated temp
directory (dev database and dev server untouched by tests). No commits, pushes, or deploys.

## 1. Test results — 15/15 pass, 0 fail, 0 skipped

`npm.cmd test` (`node --test`):

- `backend/tests/core.test.js` (3 unit): discount calc, deal validation, code/PIN format.
- `backend/tests/workflows.test.js` (12 integration, temp DB + throwaway server on :5001):
  - deal list/detail + 404; login 401 + anonymous 401s;
  - reserve 2-of-3 → remaining 1; over-stock/zero/negative/`'abc'`/missing-deal rejections with stock unmoved;
  - expired-deal reserve → 400 + status flipped to `expired`;
  - cancel → stock 1→3, repeat cancel → 400 with stock unchanged;
  - verify wrong PIN → 401, correct PIN → collected, repeat → 400, cancel-after-collect → 400, stock never restored on collect;
  - ownership: other customer GET/cancel → 403, admin cancel → 200;
  - vendor create (201) / invalid-price 400 / cross-vendor edit 403 / bad-price edit 400 / rename 200 / missing 404;
  - cross-vendor deactivate 403, own deactivate → `cancelled`; new `GET /api/shops/me/reservations` scoped to own shop + 401 anonymous;
  - `/api/shops/me` resolves the right shop; admin stats 401/403/200; apply 201 → pending, duplicate 409, bad-status 400, missing-app 404, approve → `approved`.
- Frontend syntax: `node --check` on `frontend/js/app.js`, `frontend/js/config.js` — clean.
- Live smoke on :5000: `/api/health` OK, `/` + CSS/JS 200, `/api/deals` returns the seeded deal (qty 10 — dev data untouched), demo-customer login OK.

## 2. Bugs found and fixed (all covered by regression tests above)

1. **Cancel never restored stock** (`backend/routes/reservations.js`): cancel now restores
   `quantity_remaining` exactly once (conditional `UPDATE ... WHERE status='reserved'`,
   `sold_out`→`active`/`expired` corrected); non-`reserved` cancels → 400. Repeat cancel/collect-then-cancel safe.
2. **Invalid quantities accepted** (`reservations.js`): `quantity` must now be an integer ≥ 1
   (400 otherwise). Previously `0`/negative/`NaN` slipped through (`Math.max(1, NaN)` = `NaN`) and could corrupt stock.
3. **Deal edits unvalidated** (`backend/routes/deals.js` PUT): merged deal now checked with
   `validateDealInput` + `0 ≤ quantity_remaining ≤ quantity` guard.
4. **`GET /api/shops/me` shadowed by `GET /:id`** (`backend/routes/shops.js`): routes reordered;
   added `GET /api/shops/me/reservations` (own-shop scope) — the vendor dashboard previously faked this client-side.
5. **Admin stats always 500** (`backend/routes/admin.js:18`): queried `payments.total_amount`,
   column is `amount`. One-word fix; admin dashboard revenue now loads.
6. **`POST /api/shops/apply` crashed the whole server** (`shops.js:23`): fabricated
   `owner_id` violated the `shops.owner_id` FK (enforced under better-sqlite3 v12 — silent orphan
   under v11), and the `async` handler let the rejection escape Express 4 → process exit (public-endpoint DoS).
   Fixed by: nullable `owner_id` (NULL = pre-account application) + data-preserving one-time
   migration in `backend/config/db.js` + try/catch returning 500 instead of crashing.
7. **`db.js` mangled absolute SQLite paths** (`path.join` onto repo root): now `path.isAbsolute`-aware.
   Same-file relative behaviour unchanged.
8. **Async-register crash class** (`backend/routes/auth.js`): customer + shop-owner registration
   DB writes wrapped in try/catch (shop-owner: atomic transaction for user+shop rows).

## 3. Currency: USD → ZMW (no numeric conversion)

- Backend stores plain numbers (no currency column); seed demo values (18/7) read naturally as K18/K7 — plausible, no conversion or reseed needed. **Decision: existing numerics are henceforth interpreted as ZMW; do not bulk-rewrite them.**
- Changed: `formatPrice` → `toLocaleString('en-ZM', { currency: 'ZMW' })` (`frontend/js/app.js:40`);
  admin revenue `$` → `K` prefix (`app.js:524`).
- Reference-only `Bite For Less Food Bridge 2.html` keeps its `$` placeholders (not maintained).
- Supabase migration must add an explicit `currency DEFAULT 'ZMW'` column (see `SUPABASE_MIGRATION.md` follow-up).

## 4. Files changed (uncommitted — awaiting approved push)

- `backend/routes/{reservations,deals,shops,admin,auth}.js`, `backend/config/db.js` (fixes above).
- `backend/tests/workflows.test.js` (new, 12 integration tests), `frontend/js/{app,config}.js` (ZMW + APK button from prior round).
- `package.json` / `package-lock.json`: `better-sqlite3` `^11.7.0` → `^12.11.1` (Node 24 prebuild; v11 has none).
- `.gitignore`: added `*.db-shm`, `*.db-wal`, `*.db-journal`, `*.log`; committed WAL artifacts
  untracked via `git rm --cached` (**local files kept**). `node_modules/`, `.env`, `*.db` were/are ignored.
- Docs: this file; `README.md` currency line; `DEPLOYMENT.md`/`IMPLEMENTATION_PLAN.md` already current.

## 5. Known limitations (not fixed — by design in this round)

- No reservation-expiry sweeper: expired *deals* flip lazily on reserve attempt; `reserved` rows never auto-expire (test asserts the supported half only).
- Reviews placement + notifications UI still missing (tables exist); vendor sales/waste estimates still estimates-free.
- `verify` checks role but not shop-ownership of the deal (pre-existing; documented, unchanged).
- Shop approve ≠ login: applications carry `owner_id=NULL`; account linking stays a Supabase-RPC item.
- `uuid` package still unused; `prebuild-install`/`uuid@10` deprecation warnings harmless.
- Full-clone still heavy until someone pushes the binary-removal (`node-v20/` still in history).

## 6. Readiness verdict

**Ready for the previously authorized GitHub commit + push** (then separately approved Vercel deploy):
15/15 tests green, dev DB migrated with data preserved (3 users / 1 shop / 1 deal), no secrets in diff
(scanned), no customer data beyond local demo seeds, dev server healthy on :5000, docs updated.
Push will carry the staged WAL untracking + all fixes above — review `git status`/`git diff --cached` before publishing.
