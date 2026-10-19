# LOCAL API CONTRACT — Bite For Less (Express + SQLite)

**Status: LOCAL API CONTRACT READY (v1, frozen for the Android session handoff).**
All active data serving uses this local API. Hosted Supabase is retired to an
informational fallback for the website only and is **not** part of this contract.

- Base URL (LAN device): `http://<host-machine-LAN-IP>:5000/api`
- Base URL (same host): `http://localhost:5000/api`
- Static uploads/files origin: same host, e.g. `http://<host>:5000/uploads/products/<file>.jpg`
- Transport: JSON bodies except file uploads (multipart/form-data).
- Auth: `Authorization: Bearer <token>` (JWT, 7-day expiry, HS256, secret persists in
  `backend/data/.jwt-secret` — deleting that file rotates the secret and invalidates sessions).

---

## 1. Global conventions

### Response envelope
Every endpoint returns JSON:

```json
{ "success": true,  "message": "...", /* resource fields */ }
{ "success": false, "message": "human readable reason" }
```

### Status codes
| Code | Meaning |
|------|---------|
| 200 | Success (also used for idempotent "already done" outcomes) |
| 201 | Resource created |
| 400 | Validation rejection (bad fields, expired/paased state, spoofed upload, too large) |
| 401 | Missing/invalid token, or invalid credentials / wrong pickup PIN |
| 403 | Role not allowed; suspended/disabled account; cross-ownership access |
| 404 | Unknown resource (also JSON for unknown `/api/*` paths) |
| 409 | Uniqueness conflict (duplicate email/category) or lost stock race |
| 429 | Rate limited (600 req / 15 min globally, stricter on `/api/auth/*` login) |
| 500 | Unexpected server error (JSON, never HTML) |

### Auth semantics (critical)
- Roles (`customer`, `shop_owner`, `admin`) are **always server-assigned** in the `users`
  table. No endpoint accepts a role from the client. There is **no** public admin signup,
  admin promotion, or role-selection parameter.
- Login is unified: one endpoint, any account type. The **trusted role is in the
  response**, and `/api/auth/me` returns it. Never derive UI from client-supplied data.
- Account states: `active`, `pending`, `suspended`, `disabled`.
  - `suspended`/`disabled`: login itself returns 403 and every authenticated request returns
    403 ("account has been suspended/disabled") — enforced in the auth middleware per request.
  - `pending` (newly onboarded vendor): may log in and read their onboarding/approval status,
    but cannot publish listings (shop approval gate also blocks this independently).
- Money everywhere: **ZMW**, stored as numbers with fixed decimal precision at the API
  boundary (`original_price`, `discounted_price`, `discount_percentage`, `total_amount`).
- IDs are prefixed strings (e.g. `user_…`, `shop_…`, `deal_…`, `reservation_…`).

---

## 2. Auth endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/register` | — | Create a **customer** account |
| POST | `/api/auth/login` | — | Unified login (all roles) |
| POST | `/api/auth/admin/login` | — | Admin-role-only login (bootstrap) |
| GET | `/api/auth/me` | any | Trusted profile (no password hash) |
| POST | `/api/auth/logout` | — | Symmetry only (JWT cleared client-side) |
| POST | `/api/auth/change-password` | any | Verified against bcrypt hash |

`POST /api/auth/register` `{ name, email, phone, password }` → `201 { token, user: { id, name, email, role: "customer" } }`.
Duplicate email → `409`. Passwords ≥ 6 chars, stored bcrypt-hashed (never readable).

`POST /api/auth/login` `{ email, password }` →
`200 { token, user: { id, name, email, role, phone, status } }`.
Suspended/disabled → `403` with a dedicated message. Bad creds → generic `401 "Invalid email or password."`.

`POST /api/auth/change-password` `{ current_password, new_password }` → `200`; wrong current → `401`.

---

## 3. Vendor onboarding (canonical)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/vendors/register` | — | Six-step application → account + shop in ONE transaction |
| POST | `/api/auth/shop-owner/register` | — | Legacy alias of the same handler |
| GET | `/api/vendors/me` | shop_owner/admin | Own shop + approval status (readable while pending) |
| PATCH | `/api/vendors/me` | shop_owner/admin | Edit own shop profile (whitelisted fields) |
| POST | `/api/vendors/me/logo` | shop_owner/admin | Multipart `image` → shop logo |
| POST | `/api/vendors/me/cover` | shop_owner/admin | Multipart `image` → cover photo |
| GET | `/api/vendors/me/dashboard` | shop_owner/admin | Vendor KPI payload |
| GET | `/api/vendors/dashboard` | shop_owner/admin | Compatibility alias of `/me/dashboard` |

`POST /api/vendors/register` body (all checked server-side):

```json
{
  "owner_name": "Nchimunya Mwale",
  "shop_name": "Kabwe Street Kitchen",
  "email": "owner@example.com",
  "phone": "+260 97 000 0102",
  "whatsapp_number": "+260 97 000 0102",
  "business_type": "Meals",
  "description": "Home-style nshima meals surplus from the lunch window.",
  "address": "Plot 84 Church Road",
  "city": "Kabwe",
  "area": "Town Centre",
  "opening_hours": "Mon–Fri 09:00–18:00",
  "pickup_instructions": "Knock at the back kitchen door.",
  "pickup_window_start": "15:00",
  "pickup_window_end": "18:30",
  "password": "at-least-6-chars",
  "agree_terms": true
}
```

→ `201 { token, user: { …, role: "shop_owner", status: "pending" }, shop: { …, status: "pending" } }`

- Missing required field(s) → `400 "Complete every required onboarding field before submitting."`
- `agree_terms` not `true` → `400` (message mentions "agree").
- Duplicate email → `409`.
- The **logo/cover files are NOT part of the JSON submit**. After the 201, upload them with
  the returned token via `POST /api/vendors/me/logo` and `/api/vendors/me/cover`
  (multipart field name `image`). Upload failures must be non-fatal to onboarding.

`GET /api/vendors/me/dashboard` →

```json
{
  "success": true,
  "shop": { /* the own shop row */ },
  "shop_approval": "pending|approved|rejected|suspended",
  "account_status": "pending|active|…",
  "counts": {
    "listings_total": 0, "listings_active": 0, "reservations_active": 0, "completed_pickups": 0,
    "unread_notifications": 0,
    "estimated_reserved_value_zmw": 0,   /* ESTIMATE — no money has moved */
    "collected_sales_zmw": 0             /* only realised pickups */
  }
}
```

The official dashboard the website and Android use is `/api/shops/me/dashboard` (§5) which
returns the richer `statistics` object; `/vendors/me/dashboard` mirrors its KPI subset
under `counts` for contract compatibility.

---

## 4. Categories

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/categories` | optional | Active categories for the storefront filter |
| GET | `/api/categories?with_counts=1` | optional | Adds `active_count` per category |
| GET | `/api/categories?all=1` | **admin token** | Includes inactive rows (management view) |
| POST | `/api/categories` | admin | Create (`{ name, icon? }`) — `409` on duplicate |
| PATCH | `/api/categories/:id` | admin | `{ name?, icon?, status?: "active"|"inactive" }` |

Category ORDER BY name ASC. `active_count` counts deals with `status='active'` only.

---

## 5. Listings (deals)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/deals` | — | Public marketplace catalog |
| GET | `/api/deals/:id` | — | Deal detail (joined shop address/city/area/logo) |
| GET | `/api/deals/mine` | shop_owner/admin | Own listings **including** paused/expired |
| POST | `/api/deals` | shop_owner/admin | Create listing — multipart with optional `image` |
| PUT | `/api/deals/:id` | owner/admin | JSON edit (ownership enforced) |
| PATCH | `/api/deals/:id/status` | owner/admin | `{ status: "active"|"paused" }` |
| DELETE | `/api/deals/:id` | owner/admin | Soft-deactivate (`depaated` → paused; stock untouched) |

`GET /api/deals` query params (website + Android share them):
- `q` — search food name/description/vendor name (case-insensitive substring)
- `category` — exact category name, or `all`
- `vendor` — shop id OR vendor-name substring
- `available=1` — only listings with `quantity_remaining > 0`
- `sort` — `ending_soon` (default) | `newest` | `price_asc` | `price_desc` | `discount`
- `page` (default 1), `limit` (default 60, max 60)

Response: `{ success, total, page, limit, deals: [...] }`.

Catalog rules: only `status='active'` AND `expires_at > now` AND shop `status='approved'`.
Deal row shape:

```json
{
  "id": "deal_…", "shop_id": "shop_…", "shop_name": "Sunrise Bakery",
  "food_name": "Butter Croissants (4-pack)", "description": "…", "category": "Bakery",
  "original_price": 28, "discounted_price": 14, "discount_percentage": 50,
  "quantity": 6, "quantity_remaining": 4,
  "image_url": "/uploads/demo/croissants.jpg",   /* canonical image field */
  "image_path": "…raw column…", "status": "active",
  "created_at": "ISO", "expires_at": "ISO",
  "pickup_window_start": "", "pickup_window_end": "",
  "city": "Lusaka", "area": "Kabwata", "address": "…", "logo_path": "…"
}
```

`image_url` is canonical: local upload path when a genuine photo exists, otherwise the
curated demo path. Consumers resolve `image_url` against the **API origin**
(`http://<host>:5000` + path), never a CDN.

Create/edit validation (server-side, identical for both platforms):
- prices ≥ 5 and multiples of 0.5, `discounted_price < original_price`
- integer `quantity ≥ 1`, `expires_at` strictly future ISO
- required: `food_name`, `shop_name` (server fills from the shop record), `category`

### Image uploads (multer, disk-backed)
- Field name must be `image`; max 5 MB; JPEG / PNG / WebP / GIF by **magic-byte sniffing**,
  not by filename. Spoofed content → `400 "Unsupported image content…"`; > 5 MB → `400`
  "Image too large — 5 MB maximum." Stored under `/uploads/products|logos|covers|profiles/`
  with random hex filenames (no client-controlled file names, nothing executable).

---

## 6. Reservations

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/reservations` | any signed-in | Reserve `{ deal_id, quantity? }` |
| GET | `/api/reservations` | signed-in | Own reservations (`?status=` filter, limit ≤ 200) |
| GET | `/api/reservations/:id` | owner/admin(single) | Owned single by id |
| GET | `/api/reservations/lookup/:code` | shop_owner/admin | Vendor lookup by `reservation_code` (PIN **never** returned) |
| POST | `/api/reservations/:id/verify` | shop owner of that shop (admin excepted) | Pickup verification `{ pickup_pin }` or `{ qr_token }` |
| POST | `/api/reservations/:id/cancel` | owner of reservation (admin excepted) | Cancel → stock restored exactly once |
| POST | `/api/reservations/maintenance/sweep` | admin | Manual expiry sweep (also runs every 30 s server-side) |

Stock rules (transactionally guaranteed):
- `quantity_remaining` decremented with a guarded conditional UPDATE; concurrent claims for
  the last units can't both succeed → the loser gets `409 "someone was booking the last items"`.
- When stock hits 0 the deal becomes `sold_out` automatically.
- Cancel restores stock **exactly once** (status-guarded; repeat cancel is a 400 no-op,
  collected reservations never restore stock).
- Expiry sweep flips overdue `reserved` → `expired` and restores stock once; overdue active
  deals become `expired`.

Reservation record:

```json
{
  "id": "reservation_…", "user_id": "user_…", "deal_id": "deal_…", "shop_id": "shop_…",
  "reservation_code": "BFL-XXXXXXXX", "pickup_pin": "4 digits", "qr_token": "uuid",
  "quantity": 2, "total_amount": 36,
  "status": "reserved|collected|cancelled|expired",
  "created_at": "ISO", "expires_at": "ISO (+30 min from creation)",
  "collected_at": null, "food_name": "…", "shop_name": "…", "customer_name": "…"
}
```

**Pickup semantics:** the 30-minute window is the reservation hold expiry. `verify`
collects with the correct `pickup_pin` or `qr_token`; wrong details → `401`; already
collected → `400`. **The code/PIN is a pickup reference — it never claims payment.**
Messages are phrased "Payment on pickup — no money is transferred by this step."

---

## 7. Admin

All admin routes require `Authorization: Bearer` of a user whose role is `admin`
(middleware rejects everyone else with 403 — including customers/vendors with guessed ids).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/admin/statistics` | Labelled platform stats (users_total, users_active, customers, shop_owners, shops_total/pending/approved/suspended, listings_*, reservations_*, pickup_completed, units_rescued, estimated_reserved_value, estimated_collected_value) |
| GET | `/api/admin/vendors` | Vendor apps + shops (`?status=pending|approved|rejected|suspended`); rows include owner_name/owner_email/owner_status/listings_total/listings_active |
| PATCH | `/api/admin/vendors/:id/status` | `{ status: "approved"|"rejected"|"suspended"|"pending" }` |
| GET | `/api/admin/users` | Accounts (`?q=&role=&status=&limit=`), no hashes |
| PATCH | `/api/admin/users/:id/status` | `{ status: "active"|"suspended"|"disabled" }` — admins protected; suspending a shop owner ALSO suspends their shop and pauses active listings |
| GET | `/api/admin/deals` | Every listing (`?status=`), joined `shop_name` |
| PATCH | `/api/admin/deals/:id/status` | `{ status: "active"|"paused"|"expired" }` |
| GET | `/api/admin/reservations` | Platform-wide reservations with customer/shop names |
| GET | `/api/admin/activity` | Audit trail (actor/action/target/timestamp), newest first |
| GET | `/api/admin/announcements` | All announcements |
| POST | `/api/admin/announcements` | `{ title, body, audience: "all"|"customers"|"shop_owners" }` → fans out into private notifications |
| PATCH | `/api/admin/announcements/:id` | `{ status: "published"|"archived" }` |

Approval semantics (transactional):
- `approved` — activates the pending owner account (both wizard-created shops and legacy
  orphan applications linked by email) and notifies the owner.
- `suspended` — notifies the owner and **pauses all still-active listings** of that shop
  immediately. Existing reservations are untouched ( honour their own rules).
- `rejected` / `pending` — state change + notification only.

---

## 8. Notifications & reviews & favorites

### Notifications (in-app, private per user)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/notifications` | any | `{ unread: N, notifications: [...] }` (`?limit=` ≤ 100, `?unread=1`) |
| PATCH | `/api/notifications/:id/read` | owner | Mark one read |
| POST | `/api/notifications/read-all` | owner | Mark all read |

Reservation/notification events: reservation confirmed (customer), new reservation (vendor),
shop approved/rejected/suspended, pickup confirmed, review received.

### Reviews
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/reviews` | optional | Published reviews (`?shop_id=&deal_id=&limit=`). With `?all=1` **and an admin token** hidden rows are included for moderation |
| POST | `/api/reviews` | any signed-in | `{ deal_id, rating 1–5, comment? }` — only allowed for a deal the user has **collected**; one review per deal per user |
| PATCH | `/api/reviews/:id/status` | admin | `{ status: "published"|"hidden" }` |

### Favorites
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/favorites` | any | Saved deals incl. deal + shop denormalised fields |
| POST | `/api/favorites` | any | `{ deal_id }` — idempotent (`favorited: true`, 201 first / 200 repeat) |
| DELETE | `/api/favorites/:dealId` | any | Remove (`favorited: false`) |

---

## 9. Shops (vendor-facing, website UI mainline)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/shops/me` | Own shop row |
| GET | `/api/shops/me/dashboard` | Richest vendor stats (`statistics`, `low_stock`) |
| PATCH | `/api/shops/me` | Whitelisted profile fields (name change also syncs deals.shop_name) |
| POST | `/api/shops/me/logo` / `/me/cover` | Multipart `image` uploads |
| GET | `/api/shops/me/reservations` | Incoming reservations for the shop |
| POST | `/api/shops/apply` | Legacy public application (kept for compat; the wizard uses `/api/vendors/register`) |
| GET | `/api/shops` | Public marketplace shop list |

`/api/shops/me/dashboard` → `{ shop, statistics: { listings_total, listings_active, listings_paused, listings_sold_out, reservations_incoming, pickup_completed, reservations_cancelled, reservations_expired, estimated_reserved_value, estimated_collected_value }, low_stock: [...] }`.

---

## 10. Health & ops

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | `{ success, message: "Bite For Less API is running.", database: "sqlite", mode: "local", time }` |

Pages are served from the same origin (`express.static` on `frontend/`):
`/, /deals.html, /deal.html?id=…, /how-it-works.html, /partner.html, /login.html,
/signup.html, /dashboards/{customer,vendor,admin}.html`. Unknown `/api/*` paths return
JSON 404; unknown page paths return the SPA shell.

---

## 11. Configuration (backend/config/env.js reads `.env`)

| Variable | Default | Notes |
|----------|---------|-------|
| `PORT` | `5000` | server port |
| `HOST` | `0.0.0.0` | LAN-reachable (see firewall note in LOCAL_DEMO_SETUP) |
| `DATABASE_URL` | `sqlite:./backend/data/biteforless.db` | Tests MUST override with a temp path |
| `JWT_SECRET` | persisted random in `backend/data/.jwt-secret` | change rotates all sessions |
| `JWT_EXPIRES_IN` | `7d` | |
| `ADMIN_EMAIL` | `admin@biteforless.test` | |
| `ADMIN_PASSWORD` | `admin123` | local demo default — change for any shared network |
| `CORS_ORIGIN` | `true` | echo-all locally; comma-list to narrow |
| `UPLOADS_DIR` | `backend/uploads` | |
| `SEED_DEMO_DATA` | `true` | `npm run seed` inserts demo data idempotently |

## 12. Testing notes (for future change authors)

- Every test file sets `process.env.DATABASE_URL` to a temp path BEFORE importing any
  db-touching module (ESM hoisting) — `backend/config/db.js` additionally throws if a
  test run would open the real database without an explicit override. Never remove that guard.
- Suites: `backend/tests/workflows.test.js` (:5001), `vendor-onboarding.test.js` (:5002),
  `core.test.js`, `pages.test.js`, `supabase-catalog.test.js`. Run all with `node --test`.
- The real demo DB (`backend/data/biteforless.db`) is never used by tests; scripts
  `db-inspect.mjs` / `boot-probe.mjs` / `remove-test-artifacts.mjs` exist for ops.
