-- Bite For Less — demo deadline refresh PROPOSAL (NOT APPLIED — needs approval)
-- Context: seed deadlines were relative to seeding time (2026-10-13 ~19:27 UTC).
-- By submission day (2026-10-14) l10 has expired and l1/l2/l3/l5/l6 expire
-- overnight, leaving ~2-3 bookable listings. This refresh restores the
-- intended demo mix WITHOUT touching stock, statuses, reservations or users.
-- Scope: is_demo listings only. l8 stays expired as the honest expired example.
-- Run (after approval) via: supabase db query --linked --file DEMO_REFRESH_PROPOSAL.sql

BEGIN;
UPDATE public.listings SET deadline = now() + interval '6 hours'  WHERE id = 'l1'  AND is_demo IS TRUE;
UPDATE public.listings SET deadline = now() + interval '4 hours'  WHERE id = 'l2'  AND is_demo IS TRUE;
UPDATE public.listings SET deadline = now() + interval '8 hours'  WHERE id = 'l3'  AND is_demo IS TRUE;
UPDATE public.listings SET deadline = now() + interval '5 hours'  WHERE id = 'l4'  AND is_demo IS TRUE;
UPDATE public.listings SET deadline = now() + interval '3 hours'  WHERE id = 'l5'  AND is_demo IS TRUE;
UPDATE public.listings SET deadline = now() + interval '3 hours'  WHERE id = 'l6'  AND is_demo IS TRUE;
UPDATE public.listings SET deadline = now() + interval '5 hours'  WHERE id = 'l7'  AND is_demo IS TRUE;
-- l8 intentionally left expired (demonstrates the expired state honestly).
UPDATE public.listings SET deadline = now() + interval '24 hours' WHERE id = 'l9'  AND is_demo IS TRUE;
UPDATE public.listings SET deadline = now() + interval '2 hours'  WHERE id = 'l10' AND is_demo IS TRUE;
UPDATE public.listings SET deadline = now() + interval '20 hours' WHERE id = 'l11' AND is_demo IS TRUE;
UPDATE public.listings SET deadline = now() + interval '10 hours' WHERE id = 'l12' AND is_demo IS TRUE;
COMMIT;

-- Verify after running:
-- SELECT id, status, stock, deadline, deadline > now() AS future
-- FROM public.listings WHERE is_demo IS TRUE ORDER BY id;
-- Expected: 11 future + l8 past; statuses/stock unchanged; reservations: 0.
