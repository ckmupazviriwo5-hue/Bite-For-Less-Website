# IMPLEMENTATION_PLAN.md — Bite For Less Website

Date: 2026-10-12. Status: **Phase 1 (audit) done; implementation NOT started.** No commits/pushes/deploys. Awaiting architecture + stack/design decisions (§1).

## 1. Decisions needed before building (please answer)

1. **Architecture — biggest fork.** Master prompt §5/§8 says local-only, no backend/auth/payments. The repo already ships an Express + SQLite + JWT backend (~80% of customer/vendor/admin flows). Options:
   - **A (recommended): keep + repair backend.** Least rewrite, preserves seed/auth/reserve/verify logic, matches README + `server.js`. "Reset demo" = `migrate`+`seed` re-run.
   - **B: rewrite to local-only `localStorage` prototype.** Matches prompt §5 literally but discards working backend, auth, seed, tests; rebuilds lifecycle/notifications/persistence behind a data-service. 2–3× work.
   - Default if you don't answer: proceed with **A**, and implement the prompt's *behaviors* (validation, lifecycle Exactly-once, reset-demo, demo labels) on top of SQLite rather than `localStorage`.
2. **Course stack/design constraints.** Any required languages/frameworks? Is plain HTML/CSS/JS + Express allowed, or is React (or something else) required? Is Framer Motion allowed? Any supplied mockups/screenshots/spec docs? (None found in repo — only `README.md`.)
3. **Canonical UI.** Is `frontend/` canonical and `Bite For Less Food Bridge 2.html` just an old reference to keep (or delete)?
4. **Android APK.** Confirm expected APK path/URL + Vercel plan so the landing button can be wired with a coming-soon state (no APK will be fabricated).

## 2. Target architecture (under option A)

- Keep: `frontend/` static app (no framework) served by Express; `backend/` routes as API; SQLite via `better-sqlite3` behind `backend/config/db.js`; JWT auth; `migrate`/`seed` for known demo state.
- Add: `frontend/js/config.js` (single `APK_URL` + API base + demo flags); `frontend/js/store.js` if needed to centralize fetch + auth + toasts; `frontend/assets/` for local icons/images (reduce CDN dependence); `TECH_STACK.md` (deps + licenses); APK served from `frontend/downloads/` (dev) with prod URL override.
- Do NOT add: cloud DB, real payments, server-verified QR/PIN security claims, backend rewrite, Android code in this repo.
- Reservation lifecycle (enforced in SQLite transactions): `active deal → reserved → collected | cancelled | expired`; reserve decrements once, cancel/expire restores exactly once, collect never restores, repeats idempotent; expiry via periodic job + lazy checks; reload persistence = SQLite (demo only, not multi-user safe).

## 3. Phases (local-only, no push/deploy without approval)

- **Phase 1 — done:** recovery + `PROJECT_AUDIT.md` + this plan. Next: install Node 20+, `npm install`, `npm run migrate`, `npm run seed`, `npm test`, smoke-run `npm run dev`.
- **Phase 2 — design foundation:** tokens/utilities from existing orange-on-black theme; fix `.vscode/launch.json`; responsive shell + nav; toast/empty/error/loading patterns; reduced-motion respect; footer/contact/trust sections; APK button + config + coming-soon state.
- **Phase 3 — customer marketplace:** text search, category/discount/price/availability filters, sorting, deal-detail view (price/savings/qty/vendor/window/expiry), quantity picker, confirm + pickup code modal, history (active/past: completed/cancelled/expired), cancel with restore, profile edit.
- **Phase 4 — vendor tools:** summary cards (active listings/reservations/collected/sales est.), create/edit/deactivate with validation (name/desc/category/prices/qty/location/deadline), qty/status display, per-listing reservations + confirm/complete pickup, local sales/waste estimates.
- **Phase 5 — admin tools:** overview metrics, vendor approve/suspend, customer directory, listing + reservation management, review/complaint moderation, categories/status, activity log, analytics from real local data, search/filter/empty states. Sidebar layout.
- **Phase 6 — functionalization:** wire shared state; fix §4 bugs (cancel-restore, expiry, idempotency, deal-update guards, `/shops/me` order, orphan apply); validation + notifications (read/unread) + reset-demo-data; label all demo/QR content as prototype.
- **Phase 7 — QA/release-prep:** `npm test`, lint, `npm start` build check, responsive + keyboard/a11y pass, broken-link/console/asset sweep, document local run + APK placement. Vercel direction confirmed — see `DEPLOYMENT.md` (Root Directory `frontend`, static, no env vars, no backend claims on static). No deploy without approval.

## 4. Must-fix bug list (from audit)
1. `POST /reservations/:id/cancel` must restore `quantity_remaining` exactly once (and un-`sold_out` if applicable).
2. Add expiry sweep for deals + reservations + qty restore; keep lazy guards.
3. Idempotent verify/cancel/complete (repeat returns prior result, no double stock moves).
4. `PUT /deals/:id` guards (no negative/bypassed qty, `discounted ≤ original`, future expiry, status transitions).
5. Move `GET /api/shops/me` above `GET /:id` in `backend/routes/shops.js`.
6. Link `POST /api/shops/apply` to a user (or document orphan flow); unify admin emails (`admin@biteforless.test` vs `.app`).
7. Remove committed binaries + WAL (`node-v20.17.0-win-x64.zip`, `node-v20/`, `backend/data/*.db-shm|wal`); extend `.gitignore`; fix `launch.json` absolute path.

## 5. Directory plan (minimal, preserves history)
- Keep `frontend/{index.html,css/styles.css,js/app.js}`; add `frontend/js/config.js`, `frontend/downloads/.gitkeep` (+ `APK_README.md`), `frontend/assets/` as needed.
- Keep `backend/` layout; add `backend/scripts/reset.js` (migrate+seed alias) if useful; extend `backend/tests/` (lifecycle tests).
- Add at root: `PROJECT_AUDIT.md` (done), `IMPLEMENTATION_PLAN.md` (this file), `TECH_STACK.md` (Phase 2), `APK_README.md` (APK placement).
- Delete only with approval: `Bite For Less Food Bridge 2.html` (or keep as `docs/reference/`), committed binaries/WAL (via `git rm`).

## 6. Risks
- Slow network + 100 MB committed binaries → keep sparse-checkout exclusions until binaries are `git rm`'d; full clone/CI will fail otherwise.
- No Node on this machine → nothing can be executed/tested until Node 20+ installed.
- Scope conflict (§1.1) — building before answer risks rework; Phase 1 stops at planning for that reason.
- Committed `.db-shm/.db-wal` + default secrets → demo-only hygiene issues; no real user data to be stored.

## 7. Definition of done (maps to master prompt §11)
Local run documented + works; customer/vendor/admin share one demo state; reserve/cancel/expiry/complete consistent + idempotent; tests + smoke checks pass (failures reported honestly); reset-to-demo works; APK button configured with unavailable-state; no new backend/infra beyond repair without approval; docs + limitations updated; no commits/pushes without approval.
