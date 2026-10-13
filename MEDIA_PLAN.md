# MEDIA_PLAN.md — AI-generated media preparation (no blockers)

Date: 2026-10-13. Status: planning only — no media generated, no assets downloaded,
no new dependencies. All current imagery is remote Unsplash with `onerror` fallbacks.

## 1. Current placeholders (all clearly licensed remote images)

| Slot | Page / selector | Current source | Fallback |
|---|---|---|---|
| Hero visual (16:9-ish, ≤420px tall) | `index.html` `.hero-media[data-media-slot="hero"]` | Unsplash `photo-1504674900247` (plated dishes) | `photo-1547592180` + alt text |
| Why-section split image | `index.html` `.split img` | Unsplash `photo-1488459716781` (market produce) | `photo-1542838132` + alt text |
| How-it-works vendor image | `how-it-works.html` `.split img` | Unsplash `photo-1556740738` (counter handoff) | `photo-1542838132` + alt text |
| Deal cards | `dealCardHTML` (api.js) | vendor `image_url`, else `photo-1547592180` | `onerror` hides `<img>`, card keeps text/prices |

Rules: never hotlink unlicensed images; always keep alt text; any AI actor/testimonial
imagery is forbidden from being presented as real customers.

## 2. Future video slots (markup-ready, files not yet produced)

1. **Homepage hero** — `figure.hero-media`: 16:9, muted, loop, ≤8s, poster = current hero
   still. Swap `<img>` for `<video muted loop playsinline poster="…">` when the file exists.
2. **How It Works** — vendor section: 4:3 or 1:1, ≤15s, bakery-to-customer pickup story.
3. **Partner page** — 16:9, ≤20s, bakery owner packing surplus boxes.

Serve future files from `frontend/assets/` (local, no CDN dependency). Respect
`prefers-reduced-motion`: CSS already disables non-essential motion; videos must be
`muted`+`playsinline` and pausable.

## 3. Suggested Google Flow prompts (copy-paste when ready)

1. Hero: "Cinematic close-up tracking shot across a rustic bakery counter at golden hour:
   fresh baguettes, fruit tarts and packaged surplus boxes labelled for pickup, shallow
   depth of field, warm orange-teal grade, slow 4-second dolly, no people, no text overlays,
   photorealistic, 16:9."
2. How-it-works: "Short cheerful sequence in a neighbourhood bakery: baker hands a paper
   food-rescue bag across the counter to a customer, both smiling naturally, bright daylight,
   handheld realism, diverse everyday people (actors, not real customers), no readable text,
   photorealistic, 1:1."
3. Vendor page: "Local bakery owner packing unsold bread and pastries into boxes near closing
   time, warm interior light, calm purposeful mood, close-ups of hands and produce, no text
   overlays, photorealistic, 16:9."

## 4. Definition of done for media

Real photos/video replace a slot only with a recorded license (or project-owned files);
until then the Unsplash placeholders + fallbacks stay. No fabricated testimonials, ever.
