# TECH_STACK.md — Bite For Less Website

Date: 2026-10-12. Canonical UI: `frontend/`. No frontend framework (plain HTML/CSS/vanilla JS per owner decision).

## Runtime / tooling
- **Node 20+** required (repo pins `node-v20.17.0-win-x64` binaries, currently excluded from checkout via sparse-checkout — install official Node LTS instead). **Not installed on this machine** — `npm install / migrate / seed / test / dev` are blocked until installed.
- **Git 2.45.1** OK. Sparse-checkout active to skip committed binaries (`node-v20/`, `node-v20.17.0-win-x64.zip`); full clone fails on slow links until those are `git rm`'d (proposed, not done).

## Frontend (no build step)
| Dep | Source | License | Notes |
|---|---|---|---|
| Plain HTML/CSS/JS | repo | — | `frontend/index.html`, `css/styles.css`, `js/app.js`; new `js/config.js` holds `APK_URL`/API base. |
| QRCode.js 1.0.0 | cdnjs CDN | MIT | `qrcodejs` — client-side QR render only (demo, not secure proof). Needs offline fallback (planned). |
| Unsplash images | remote URLs | Unsplash license | Deal fallbacks + future food imagery; plan local `assets/` copies. |

## Backend (Express + SQLite, preserved)
| Dep | Version | License | Notes |
|---|---|---|---|
| express | ^4.19.2 | MIT | REST API + static `frontend/` serve. |
| better-sqlite3 | ^11.7.0 | MIT | Local demo DB (WAL). Requires build tools on install. |
| jsonwebtoken | ^9.0.2 | MIT | Custom 7-day JWT — to be replaced by Supabase Auth at migration. |
| bcryptjs | ^2.4.3 | MIT | Password hashing — same replacement note. |
| helmet / cors / express-rate-limit | ^7/2/7 | MIT/ISC | Hardening + 300 req/15 min limit. |
| dotenv | ^16.4.5 | BSD-2 | `.env` (untracked) from `.env.example`. |
| uuid | ^10.0.0 | MIT | Only `makeId` uses `crypto.randomUUID`; `uuid` pkg currently unused by code — removal candidate (proposed). |
| nodemon (dev) | ^3.1.14 | MIT | `npm run dev`. |
| Node test runner | built-in | — | `npm test` → `backend/tests/core.test.js` (3 unit tests). |

## Planned (not yet added)
- **Supabase** (Postgres + Auth, anon key only client-side) as shared backend — see `SUPABASE_MIGRATION.md`. No keys in repo.
- **Vercel** static hosting for `frontend/` (eventual, not configured/deployed).
- **APK distribution:** Android-repo **GitHub Releases** versioned assets; website `APK_URL` empty → coming-soon state until a verified URL is supplied.

## Removals proposed (need approval, not done)
- `git rm` committed binaries (`node-v20.17.0-win-x64.zip`, `node-v20/...`, incl. `node.exe` ~70 MB) — bloats clones, third-party license surface.
- `git rm` committed `backend/data/*.db-shm|*.db-wal`; extend `.gitignore` with `*.db-shm`, `*.db-wal`, `node-v20/`.
