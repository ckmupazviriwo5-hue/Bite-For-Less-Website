# PRESENTATION GUIDE — Bite For Less local demo (website + dashboards)

Everything below runs on the local server (`start.bat` / `npm run dev`) with the seeded
demo data. Money is Zambian Kwacha throughout. No internet, hosted DB, or payment rail
is involved: **reservations are pickup references, never payment claims.**

## 0. 30-second boot

1. Double-click `start.bat` → browser opens http://localhost:5000.
2. Log in as any account from the table in `docs/LOCAL_DEMO_SETUP.md`.

## 1. Suggested demo script (8–10 minutes)

| # | Action | Where | What it proves |
|---|--------|-------|----------------|
| 1 | Browse home + deals, filter by category, use search | `/` `/deals.html` | Live SQLite catalog (17 active ZMW deals with local demo art) |
| 2 | Open a deal, check images/price/countdown | `/deal.html?id=…` | Deal DTO, countdown, discount math |
| 3 | Log in as customer, reserve 2 units, see PIN + QR confirmation | deal page | Transactional stock decrement in the DB |
| 4 | Show the customer dashboard: active reservation, PIN, cancel | `/dashboards/customer.html` | Exactly-once stock restore; honest copy ("Payment on pickup") |
| 5 | Log in as vendor (Sunrise Bakery), see the new reservation notification | `/dashboards/vendor.html` | Notification fan-out; estimated reserved value labelled as estimate |
| 6 | As vendor: verify the pickup with the reservation code + PIN | Verify pickup panel | Only verified pickups count as "collected sales" |
| 7 | As vendor: publish a new listing and drag-pick a product photo | Listings → Create | Genuine multipart upload, magic-byte check, disk storage |
| 8 | Open TWO-step onboarding as a NEW shop owner | `/partner.html` | Six-step wizard: landing→identity→contact→location→operations→account→review, draft persists on refresh |
| 9 | Submit wizard; show pending banner + blocked "Publish" | vendor dashboard | Pending vendors can look around but cannot publish |
| 10 | Log in as admin; approve the pending vendor | `/dashboards/admin.html` | Approval transaction: shop approved + owner activated + notification sent |
| 11 | Back as the vendor: publish now works | vendor dashboard | Approval unlocks publishing |
| 12 | As admin: stats, pause a listing, suspend/restore a user, announcement | admin dashboard | Moderation + audit trail; suspension pauses listings and blocks new reservations |

## 2. Administration demo extras

- **Vendor approvals**: filter chips (pending/approved/rejected/suspended); approve /
  reject / suspend with server-side notifications.
- **Listing moderation**: pause/restore any listing platform-wide.
- **Users**: search by name/email, role filter, suspend/restore (admins can't be suspended).
- **Reservations**: platform-wide table with customer + shop names.
- **Categories**: create/deactivate; the public filter updates instantly.
- **Announcements**: publish to all / customers / shop owners → lands in private inboxes.
- **Reviews**: pick any completed reservation on the customer side first — reviews
  require a collected reservation; then moderate (hide/unhide) from the admin panel.
- **Activity**: every admin mutation appears in the audit trail.

## 3. Manual browser QA matrix (run at 1440px and 375px mobile widths)

| Area | Cases to click through |
|------|------------------------|
| Auth | login (each role), wrong password, customer signup, change password, logout |
| Wizard | required-field errors per step, time-window validation, terms checkbox, draft restore after refresh, submit → pending state |
| Vendor dash | pending banner, publish gate blocked, edit listing, pause via status, logo/cover upload, profile edit |
| Customer dash | reserve→PIN card, cancel restores stock, favorites add/remove, notifications read/read-all |
| Admin dash | stat tiles, approvals, listing pause, user suspension, announcements, review moderation |
| Edge | admin login page refuses non-admin accounts, suspended account can't log in, expired deal can't be reserved |

(No automated browser tooling is installed in this environment, so this matrix is the
intentional QA artifact — every row above maps to an integration test on the backend.)

## 4. Known demo-only behaviours

- The default admin password `admin123` matches `.env.example` — fine for an offline
  demo, MUST be changed if this notebook ever shares a network (document in `.env`).
- Deal deadlines of *seeded* deals auto-refresh with `npm run seed`; user-created deals
  expire like real listings.
- `docs/MEDIA_PROVENANCE.md` documents where the seed photography came from.
- Google OAuth remains unconfigured in the preserved Supabase project (graceful error
  only on that legacy path — not part of the local demo).
