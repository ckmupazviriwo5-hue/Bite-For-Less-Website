# DEPLOYMENT.md — Bite For Less Website

Date: 2026-10-12. Status: **documentation only — no Vercel project created, no deploys, no commits/pushes.** Source of truth stays on GitHub; history preserved.

## 1. Source control (confirmed)

- Canonical repo: `https://github.com/ckmupazviriwo5-hue/Bite-For-Less-Website`, production branch `main`.
- Workflow: develop locally → run tests/verify → review → **commit + push approved changes to GitHub** → connected Vercel project auto-deploys → verify deployed URL. Use preview deployments before promoting to production.
- Android repo (`BiteForLess-`) is untouched by website work. Website and Android share nothing at runtime today; Supabase is the planned shared backend (see `SUPABASE_MIGRATION.md`).

## 2. Frontend independence check (verified 2026-10-12 from actual files)

`frontend/` is fully self-contained and deployable as static files — no build, no framework:

| File | Role | External refs |
|---|---|---|
| `frontend/index.html` | entry | data-URI favicon (local), QRCode.js CDN (`cdnjs`, deferred), relative `./css/styles.css`, `./js/config.js`, `./js/app.js` |
| `frontend/css/styles.css` | theme | none (no `@import`, no webfonts) |
| `frontend/js/app.js` | UI logic | `fetch('/api/...')` for data; Unsplash fallback image URLs in deal cards |
| `frontend/js/config.js` | `window.BFL_CONFIG` (`API_BASE`, `APK_URL`, releases URL, `DATA_BACKEND`) | GitHub Releases URL constant only |

- All asset paths are relative — safe under any Vercel path/Root Directory choice.
- **Known gap (documented, not yet fixed):** `app.js:1` hardcodes `const API_BASE = '/api'` and does not read `BFL_CONFIG.API_BASE`. Centralizing it is a proposed code change awaiting approval — see §5.
- Failure mode on static hosting is graceful: `loadDeals`/`loadLandingReviews` catch fetch errors and render empty states; no hard crash at load. Auth/dashboard/reservation actions will error visibly (alerts/status banners) because `/api` does not exist there — which is why §4's honesty rule matters.

## 3. Recommended Vercel settings (to apply manually — NOT applied)

Import the existing GitHub repo; do not fork or re-upload:

| Setting | Value |
|---|---|
| Repository | `ckmupazviriwo5-hue/Bite-For-Less-Website` |
| Root Directory | `frontend` |
| Framework Preset | **Other** (static HTML/CSS/JS — do not select Next.js or any framework) |
| Build Command | empty / none (no build step exists) |
| Output Directory | `.` (the Root Directory itself; leave default) |
| Install Command | none |
| Production Branch | `main` |
| Preview deployments | enabled (default per-branch previews; verify preview URL before merging to `main`) |

No `vercel.json` is required for this setup. If clean-URL rewrites or security headers are wanted later, propose the file content for approval first.

## 4. Environment variables

- **Static frontend on Vercel: none required.** `config.js` ships only public constants; there are no build-time secrets.
- **Do NOT add to Vercel:** `JWT_SECRET`, `ADMIN_PASSWORD`, `DATABASE_URL`, any Supabase service-role key or DB password. Those belong to a future server/API environment, never to a static frontend.
- Future Supabase web-client keys (`SUPABASE_URL`, publishable/anon key) may be referenced by `config.js` after integration is approved and tested — public keys only, still no secrets.

## 5. Unresolved backend dependencies (why static ≠ full app)

The Express/SQLite backend (`backend/server.js`, `better-sqlite3`, JWT) **cannot be assumed persistent on Vercel**: serverless functions have no durable disk for SQLite, and this repo has no serverless API routes. Until Supabase integration is implemented and verified:

| Feature | Depends on | Static-Vercel behaviour |
|---|---|---|
| Browse deals, reviews | `GET /api/deals`, `GET /api/reviews` | empty-state text (graceful, no crash) |
| Register/login, dashboards | `/api/auth/*`, `/api/shops/me`, `/api/admin/*` | actions fail with error messages; no session |
| Reserve / cancel / verify pickup | `/api/reservations/*` | non-functional (no shared inventory) |
| Shop apply | `POST /api/shops/apply` | error message, nothing persisted |
| APK button | `BFL_CONFIG.APK_URL` (empty) | **coming-soon modal** (works fully offline — no backend needed) |

**Do not claim** the statically deployed site offers working multi-user reservations or persistent shared inventory. It is an honest UI shell + landing + coming-soon APK until a verified backend (Supabase) is wired. No conflicting live state: SQLite stays local-dev only; never run two writable backends side by side.

## 6. Proposed config changes (identified, NOT applied — awaiting approval)

1. Wire `app.js` to `BFL_CONFIG.API_BASE` (replace hardcoded `'/api'`) so the frontend can target a hosted API later without code edits per environment.
2. Optional `frontend/vercel.json` (routes/headers) — content to be proposed if wanted.
3. `.gitignore` extensions (`*.db-shm`, `*.db-wal`, `node-v20/`) + `git rm` of committed binaries/WAL — proposed in `TECH_STACK.md`, not executed.
4. Express correctness fixes (cancel-restore-qty, `/shops/me` route order, idempotency) — proposed in `SUPABASE_MIGRATION.md` §1/`IMPLEMENTATION_PLAN.md` §4, not applied.

## 7. Exact manual steps (for the owner to perform)

1. **Approve and publish source changes:** review untracked/modified files (`PROJECT_AUDIT.md`, `IMPLEMENTATION_PLAN.md`, `SUPABASE_MIGRATION.md`, `TECH_STACK.md`, `DEPLOYMENT.md`, `frontend/js/config.js`, edits to `index.html`/`styles.css`/`app.js`), then run yourself:
   `git add <approved files> && git commit -m "…" && git push origin main`
   (Assistant stops here — no commit/push without your approval.)
2. **Vercel → Add New → Project → Import** `Bite-For-Less-Website` from GitHub (grant repo access if prompted).
3. Set **Root Directory = `frontend`**, Framework = **Other**, leave Build/Output/Install empty/default (§3). No environment variables.
4. **Deploy**, open the preview/production URL, verify: landing renders, Browse Deals scrolls, category filter works on (empty) grid, APK button shows coming-soon modal, no console errors, responsive at desktop/mobile widths.
5. Confirm honestly-behaving degradations (§5 table) rather than working reservations.
6. Promote to production only after preview checks pass.

## 8. Rollback

Vercel keeps every deployment: to roll back, use Vercel dashboard → Deployments → promote the previous good deployment. GitHub history is the second safety net (`git revert` a bad commit, push, let Vercel redeploy).
