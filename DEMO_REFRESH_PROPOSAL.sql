-- Bite For Less — demo deadline refresh PROPOSAL (NOT APPLIED — needs approval)
-- Checked 2026-10-14 ~01:00 UTC: public.listings holds ONLY l9 + l12.
-- Ten earlier demo rows (l1-l8, l10, l11) are gone; this file does NOT recreate,
-- delete, or modify them — data seeding belongs to the Android session.
-- Scope below: extend l12's deadline IF still an active demo row (it lapses
-- 2026-10-14 08:01 UTC, during submission day). l9 runs to 22:01 UTC, untouched.
-- Preserved: ids, stock, statuses, vendors, reservations, users. No DDL.
-- Run (after approval) via: supabase db query --linked --file DEMO_REFRESH_PROPOSAL.sql

UPDATE public.listings
SET deadline = now() + interval '12 hours'
WHERE id = 'l12'
  AND is_demo IS TRUE
  AND status = 'active';

-- Verify after running:
-- SELECT id, status, stock, deadline, deadline > now() AS future
-- FROM public.listings WHERE id IN ('l9', 'l12');
-- Expected: both rows present, stock/status unchanged, both deadlines future.
