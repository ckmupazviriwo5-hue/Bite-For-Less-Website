# SUPABASE_MIGRATION.md — Express/SQLite → Supabase (website)

Date: 2026-10-12. Status: **planning only — no migration executed, no commits/pushes/deploys.**
Decisions in force: keep existing Express+SQLite working code; plain HTML/CSS/vanilla JS; `frontend/` canonical; APK via Android-repo GitHub Releases (coming-soon until a verified asset URL exists).

## 1. Audit: what the current backend does (preserve this)

Source: `backend/` (see `PROJECT_AUDIT.md` §2 for file map). Working, worth keeping:

- **Auth:** custom JWT (`jsonwebtoken`, 7-day) + `bcryptjs` password hashes. `POST /api/auth/register` (customer), `/login`, `/me` (manual verify), `/logout`, `/shop-owner/register`, `/admin/login`. Middleware `authenticate` + `requireRole` guards routes.
- **Deals:** `GET /api/deals` (active, non-expired, by expiry), `GET /:id`, `POST /` (shop_owner/admin + `validateDealInput`), `PUT /:id` (owner-or-admin), `DELETE /:id` (soft `cancelled`). Stock held in `deals.quantity_remaining`, `sold_out` flip on zero.
- **Reservations:** `POST /` (auth; expiry/stock checks; SQLite transaction: decrement stock, insert reservation + `success` payment row). Codes: `BFL-XXXX` reservation code, 4-digit `pickup_pin`, `BFL-RESERVATION-XXX` qr_token. `GET /` (own), `GET /:id` (own-or-admin), `POST /:id/verify` (shop_owner/admin, PIN **or** QR match → `collected`), `POST /:id/cancel` (owner-or-admin → `cancelled`).
- **Shops/admin/reviews:** `POST /api/shops/apply`, `GET /:id`, `GET /me` (shop_owner/admin); admin stats, applications approve/reject, users/shops/deals lists; reviews list + create gated on a `collected` reservation.
- **Schema (SQLite, `backend/config/db.js`):** users, shops, deals, reservations, reviews, favorites, notifications, payments. Seed (`backend/scripts/seed.js`) creates admin + 1 customer + 1 shop_owner + 1 shop + 1 deal. Tests (`backend/tests/core.test.js`, `node --test`): 3 unit tests.
- **Known bugs to fix before/during migration** (`PROJECT_AUDIT.md` §2.3): cancel never restores qty; no expiry sweep; verify/cancel not idempotent; `PUT /deals` accepts arbitrary `quantity_remaining`; `GET /api/shops/me` shadowed by `GET /:id` (route order); shop-apply creates orphan shop (random `owner_id`); admin email mismatch (`.test` vs `.app`); committed binaries/WAL.

Android repo check (read-only, 2026-10-12): **no Supabase integration exists yet** — `BITEFORLESS/TECH_STACK.md` explicitly lists Supabase as out-of-phase. So the shared Supabase project is greenfield: nothing to conform to yet, but the website must not invent a conflicting schema the Android app can't share.

## 2. Target: one Supabase project, both clients

- One Supabase project = Postgres + Auth + (later) Storage/Edge Functions. Both website and Android use it; **no SQLite↔Supabase dual-write** (would fork users/inventory/reservations).
- Client config holds **only** `SUPABASE_URL` + publishable (anon) key. Service-role key, DB password, JWT secret stay server-side (Edge Functions / future deploy env). Never commit `.env`.
- Rule: all stock/codes/status transitions run in **`SECURITY DEFINER` RPC functions** (or Edge Functions), never as direct client writes. RLS denies direct mutation of sensitive columns.

## 3. Schema mapping (SQLite → Postgres)

Keep names where possible so the website adapter and Android models stay aligned:

| SQLite now | Supabase target | Notes |
|---|---|---|
| `users` (text id, bcrypt hash, role, status) | **Supabase Auth** (`auth.users`) + `public.profiles` (`id uuid PK/FK auth.users.id`, name, email unique, phone, `role customer\|shop_owner\|admin`, `status`) | Drop bcrypt/JWT; demo accounts re-created via Auth. Role as `profiles.role`; mirror into `auth.jwt()` custom claim for cheap RLS checks. |
| `shops` | `public.shops` (uuid, `owner_id FK profiles`, name, email, phone, address, city, business_info, `status pending\|approved\|rejected\|suspended`) | Fix orphan-apply: application creates Auth user + `profiles` + `shops(pending)` in one RPC. |
| `deals` | `public.deals`/`listings` (uuid, `shop_id FK`, denormalized `shop_name`, food_name, description, category, `original_price numeric`, `discounted_price numeric`, `discount_percentage` generated, `quantity`, `quantity_remaining` with `CHECK (quantity_remaining >= 0)`, image_url → later Supabase Storage, `expires_at timestamptz`, `status`) | Add `CHECK (discounted_price <= original_price)`, partial index on active+unexpired. |
| `reservations` | `public.reservations` (uuid, user/shop/deal FKs, quantity, total_amount, `reservation_code unique`, `pickup_pin`, `qr_token unique`, `status reserved\|collected\|cancelled\|expired`, expires_at) | Generate codes server-side (pgcrypto), never trust client. |
| `reviews` | `public.reviews` (same + `moderation pending\|approved\|rejected`) | Add moderation states the current app lacks. |
| `favorites`, `notifications` | same tables, RLS owner-only | Build the missing notifications UI on this. |
| `payments` | keep as `status pending\|success\|failed`, gateway=`development` for demo | No real payments in this stage. |

## 4. RLS + server-side enforcement (sketch)

- `ENABLE ROW LEVEL SECURITY` on every `public.*` table; default-deny.
- Read policies: active non-expired deals + approved shops public-readable; own rows readable (`auth.uid() = user_id/owner_id`); admins bypass via claim.
- **No direct client writes** to `quantity_remaining`, codes, `status`, totals. Clients call RPCs:
  - `reserve_deal(deal_id, qty)` — checks active/expiry/stock, decrements exactly once, mints codes, returns reservation. Aborts on insufficient stock.
  - `cancel_reservation(id)` — owner-or-admin, only from `reserved`, restores qty exactly once (idempotent repeat → prior result).
  - `verify_pickup(id, pin_or_token)` — shop-of-deal or admin, `reserved`→`collected`, never restores.
  - `expire_sweep()` — scheduled (pg_cron/Edge Function): flips past-expiry deals/reservations, restores qty once.
- Validation mirrors `backend/utils/validation.js` (prices, qty, future expiry) as `CHECK`s + RPC guards.

## 5. Website data-access layer (no framework, no dual source)

- New `frontend/js/api.js` adapter with one interface used by all screens: `listDeals(filters)`, `getDeal(id)`, `createReservation(dealId, qty)`, `cancelReservation(id)`, `verifyPickup(...)`, `applyShop(...)`, `signUp/signIn/signOut`, `admin*`, `reviews*`, `notifications*`.
- **Stage 1 (now):** adapter calls existing Express REST (`/api/...`) — zero backend change, preserves tests.
- **Stage 2 (after Supabase project exists):** adapter gains a `supabase` backend (Supabase JS via CDN/ESM, anon key from `frontend/js/config.js`) calling the RPCs above; switch via single `DATA_BACKEND` flag. Express stays as fallback until cutover verified, then retired — never both writable at once.
- `frontend/js/config.js` (new, single place): `API_BASE`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `APK_URL` (empty → coming-soon), `DATA_BACKEND: 'express'`.

## 6. Cutover + safety rules (per your constraints)

1. No destructive SQL, no table drops, no data deletes, no backend deletion — propose each migration file for approval first.
2. Seed parity: recreate admin/customer/shop demo accounts in Supabase staging; one-shot import script (SQLite→Postgres) reviewed before running.
3. Keep `npm test` green throughout; add lifecycle tests now (over-reserve, double-cancel, expiry-restore, double-collect) against Express, then port them to RPC tests.
4. Android repo untouched; schema changes proposed jointly (single source of truth doc) before either client adopts them.
5. Blockers today: Node 20+ not installed on this machine (cannot run `npm install/migrate/seed/test`); no Supabase project URL/keys supplied — migration stays at design until you provide them (anon key only, never service-role in chat/files).

## 7. Next safe increments (no migration, no rewrites)
1. `frontend/js/config.js` + APK coming-soon button (explicitly approved pattern) — frontend-only.
2. `TECH_STACK.md` (deps + licenses + binary-removal note).
3. Express bug fixes that migration depends on (cancel-restore, route order, idempotency) — each reported before applying.

## 8. Website Auth migration plan (prepared 2026-10-14, NOT implemented)

Live catalog already reads Supabase (`DATA_BACKEND: 'supabase'`, `supabase-catalog.js`).
Accounts/reservations still need Express locally. Migration steps for the website:

1. **One Supabase Auth login for all users.** Keep `login.html` as-is (email + password,
   no role picker). Swap `auth-page.js` to `supabase-js signInWithPassword`; keep the
   role-based redirect, but source the role from `public.profiles.role` for the
   authenticated user — never from client storage.
2. **Role mapping.** `customer` → customer dashboard; `shop_owner` linked via
   `shops.owner_id = profiles.id` → vendor dashboard; `admin` via profiles flag/claim →
   admin dashboard. New public signups insert `profiles{role:'customer'}` only; vendor
   promotion = approved application linked to a user (server-side); admin promotion never public.
3. **Session management.** supabase-js persists the session (localStorage) and refreshes
   tokens; `layout.js requireRole()` calls `supabase.auth.getUser()` + profiles lookup on
   every dashboard load. Logout = `supabase.auth.signOut()` + redirect home.
4. **Reads.** Public listings keep using the anon key + current PostgREST selects
   (already RLS-safe). No service-role key, no secrets in `config.js` — only
   `SUPABASE_URL` + publishable key (both already present and client-safe).
5. **Writes (reservations/vendor/admin).** All stock and status transitions move to
   `SECURITY DEFINER` RPCs (`reserve_deal`, `cancel_reservation`, `verify_pickup`,
   `upsert_listing`, `review_application`) so RLS stays deny-by-default; the website
   never writes inventory columns directly. Until RPCs exist and are tested, mutating
   actions keep throwing the current honest "needs the legacy local server" error —
   never a fake success.
6. **Error handling.** Reuse the existing `api()` shape: network/timeout → connection
   message; 401/refresh failure → redirect to login; RLS 403 → permission message.
   No stack traces or keys in UI copy.
7. **Cutover rule.** One writable backend at a time. Express stays for local demo until
   the Supabase RPC suite passes the ported lifecycle tests; then the website flips and
   Express is retired from the path — never dual-write inventory.
