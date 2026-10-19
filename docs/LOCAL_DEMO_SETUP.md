# LOCAL DEMO SETUP — Bite For Less (single local API, port 5000)

One Express + better-sqlite3 process serves **everything**: the website, all three
dashboards, the REST API, and the uploaded/static images. There is no hosted database in
the active path — the SQLite file is the only data source.

```
backend/
  server.js                 ← the app (Express, port 5000, LAN-reachable)
  config/db.js              ← WAL SQLite + additive idempotent migrations
  data/biteforless.db       ← THE demo database (gitignored; backups in data/backups/)
  data/.jwt-secret          ← generated JWT secret (gitignored; delete = rotate)
  uploads/<kind>/           ← genuine uploaded images; uploads/demo/ holds seeded art
scripts/
  migrate.js                ← backup-then-apply schema migrations (safe to re-run)
  seed.js                   ← idempotent demo seed (never overwrites genuine user data)
  db-inspect.mjs            ← read-only DB summary
  boot-probe.mjs            ← boots a throwaway server on a probe port (diagnostics)
  remove-test-artifacts.mjs ← guard-cleanup with numbered backups
```

## 1. One-time setup

```powershell
# from the repo root (Windows PowerShell)
npm install
npm run migrate      # writes a numbered backup, then applies schema changes
npm run seed         # idempotent; inserts demo users/shops/deals in ZMW
```

`npm run seed` refreshes the deadlines of known seeded demo deals so the catalog is
always live, while preserving everything a real user created.

## 2. Run the server

Option A — double-click **`start.bat`** (repo root):
starts `npm run dev` (nodemon) and opens http://localhost:5000.

Option B — manually:
```powershell
npm run dev        # nodemon auto-restart
# or
npm start          # plain node backend/server.js
```

Server binds to `0.0.0.0:5000` so phones/Android devices on the same Wi-Fi can use
`http://<your-LAN-IP>:5000/api` (see firewall section below).

## 3. Demo accounts (password in **bold**)

| Role | Email | Used for |
|------|-------|----------|
| admin | `admin@biteforless.test` (**admin123**) | Approvals, moderation, stats |
| customer | `customer@example.com` (**password123**) | Booking, favorites, notifications |
| customer | `chisomo@example.com` (**password123**) | Second customer for two-sided demos |
| shop owner | `shopowner@example.com` (**password123**) | Sunrise Bakery — logo/cover/listings |
| shop owner | `produce@example.com` (**password123**) | Groceries shop |
| shop owner | `kapiri@example.com` (**password123**) | Kapiri shop |
| shop owner | `veggie@example.com` (**password123**) | Veggies shop |
| shop owner | `grill@example.com` (**password123**) | Grill shop |

> The demo DB admin is created by the seed with the password from
> `ADMIN_PASSWORD` (default `admin123`). Keep the default **only** on a private machine.

## 4. Firewall guidance (Windows Defender)

The first time Node listens on `0.0.0.0:5000` Windows asks for network access. To allow
phones on the LAN:

1. Open **Windows Security → Firewall & network protection → Allow an app through firewall**.
2. Find *Node.js* entries; tick **Private** (and only Private if the Wi-Fi is your home
   network). Do NOT tick Public unless you know the network is safe.
3. If the app is not in the list, run in an **elevated** PowerShell:

```powershell
New-NetFirewallRule -DisplayName "Bite For Less API (5000)" -Direction Inbound `
  -Protocol TCP -LocalPort 5000 -Action Allow -Profile Private
```

4. Find your LAN IP: `ipconfig` → IPv4 Address, e.g. `192.168.1.42`.
   Devices then use `http://192.168.1.42:5000`.

To close it down again: `Remove-NetFirewallRule -DisplayName "Bite For Less API (5000)"`.

## 5. Re-running / diagnosing

- Re-apply migrations after pulling schema changes: `npm run migrate` (auto-backup first).
- Inspect the DB without a server: `node backend/scripts/db-inspect.mjs`.
- Boot smoke test on a throwaway port: `node backend/scripts/boot-probe.mjs`.
- Full test suite (isolated temp DBs only, never the real one): `node --test`.
  - 42 tests green: workflows (:5001), vendor-onboarding (:5002), core, pages, catalog.
- Reset to a clean demo state: pick the newest numbered
  `backend/data/backups/biteforless-<date>.db`, copy it over `biteforless.db`, then
  `npm run seed`. Never delete the hosted Supabase project — it is preserved untouched.

## 6. What "local mode" means for the site

- `frontend/js/config.js`: `DATA_BACKEND: 'express'`, `API_BASE: '/api'` — every page
  (home, deals, deal detail, login/signup, all dashboards) reads/writes through the local
  API only.
- Supabase remains only as a documented fallback adapter path (not active) and in
  migration/docs history. No page calls it in express mode.
- The Vercel deployment can remain an informational landing page; it will never need the
  hosted database back for the demo.

## 7. Troubleshooting

| Symptom | Fix |
|---------|-----|
| `EADDRINUSE :5000` | Another server instance is running. Close it (`npm run dev` already running?) and retry. |
| Phone can't reach the API | Firewall rule (section 4) or phone is on a guest network; confirm same Wi-Fi + IPv4 from `ipconfig`. |
| Login 401 with demo creds | You are pointing at the wrong DB/host — check `DATABASE_URL`; run `npm run seed`. |
| Images missing | Uploads live under `backend/uploads/`; don't prune `uploads/demo`. |
| Sessions died after reboot | `backend/data/.jwt-secret` was deleted → re-login (rotates the secret). |
