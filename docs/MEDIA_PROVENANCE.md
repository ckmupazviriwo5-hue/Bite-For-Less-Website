# MEDIA PROVENANCE — Bite For Less demo imagery

This file records where every image asset used by the local demo comes from and how it
is licensed/kept out of sensitive paths. Companion documents: `MEDIA_PLAN.md` (strategy)
and `docs/LOCAL_API_CONTRACT.md` §5 (how `image_url` resolves).

## 1. Two image lanes

| Lane | Location | Tracked in git? | Used for |
|------|----------|-----------------|----------|
| Seeded product photos | `backend/uploads/products/seed-*.jpg` | **No** (gitignored `uploads/products/`) — re-downloaded by `npm run seed` | Deal rows created by the seed script |
| Curated demo artwork | `backend/uploads/demo/*.jpg` | **Yes** (committed; gitignore carves out only the other upload kinds) | The "Sunrise Bakery"-era demo deals whose rows store `/uploads/demo/<file>.jpg` in `image_url` |

When the seed cannot download photos (offline), it generates clean local SVG
placeholders instead — the presentation still works with zero internet.

## 2. Sources

- `seed-*.jpg` photos are fetched ONCE by `backend/scripts/seed.js` from curated
  Unsplash source URLs (the exact URLs live in the seed fixture list). Unsplash photos
  are free to use under the Unsplash License (no attribution required, attribution
  appreciated). They are generic food photography used **as proof-of-concept
  placeholders** — they are NOT photographs of any real vendor's actual products.
- `uploads/demo/*.jpg` were downloaded during earlier development from the same curated
  Unsplash set and are committed so the database rows referencing them keep working on
  fresh clones.
- No trademarks, no people identifiable, no client-supplied uploads are committed:
  anything a real user uploads through the dashboards lands in the gitignored upload
  kinds (`products|logos|covers|profiles`) and never enters version control.

## 3. Serving & security model

- Images are served by Express from `backend/uploads/` only; filenames are random hex +
  sniffed extension (see `backend/utils/uploads.js`). The CSP `img-src` allows
  `'self' data:` plus `images.unsplash.com` for the few remaining landing references.
- Website and Android resolve relative `/uploads/...` paths against the configured API
  origin (`http://<host>:5000`) — no third-party CDN in the data path.
