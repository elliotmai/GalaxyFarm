# Double M — logo concepts

Ten candidate marks for a "Double M" identity, drawn in the same livestock-brand
grammar as the approved **Rocking Double Star** and coloured from
`packages/config/tailwind.preset.ts`.

**Status: exploration.** Nothing here is approved and nothing here replaces the
star mark in `packages/ui/src/brand/`. These are candidates for whenever issue
[#26](https://github.com/elliotmai/GalaxyFarm/issues/26) settles the farm and
business names.

Open **[`concepts.html`](./concepts.html)** to see them — every mark rendered on
both real grounds (Midnight Nebula and Bluebonnet Linen) at 96, 64, 40 and
24&nbsp;px.

## The brand grammar

Ranch brands are read as a modifier plus a letter, and the modifier is a real
vocabulary rather than decoration:

| Modifier | Means |
| --- | --- |
| Rocking | set on a curve |
| Bar | over or under a straight line |
| Connected | two letters sharing a stroke |
| Lazy | lying on its side |
| Crazy | turned upside down |
| Circle / Box / Diamond | enclosed |

The approved mark is already named this way, so the candidates are too.

## The ten

Verdicts are against the threshold the brand README already put on the
record — the pair "drifts apart below about 24px".

| Mark | What it says | At 24px |
| --- | --- | --- |
| **Rocking Double M** | Same rocker, same shared ground, letters where the stars were. Least disruptive. | Tight — three elements to resolve |
| **Connected Double M** | One unbroken zigzag, two M's sharing a middle apex. The default reading. | Holds — but roughly 2:1, awkward in square slots |
| **Dam & Calf Double M** | Big M and small M at side. "Double M" and "cow and calf" are the same picture. | Tight — the calf must stay near 52% |
| **Bar Double M** | Zigzag over a straight bar; the bar does the rocker's job with one less curve. | Holds — best small-size survival here |
| **Stacked Double M** | One M over another. The only square variant, and the only one where two tones say something true (farm name over business name). | Tight — merges at 24px; its slots are 180px+ |
| **Circle Double M** | Enclosed, so it has its own edge. The seal for signed PDFs and invoices. | Tight — the ring eats the letters below ~40px |
| **Constellation Double M** | The zigzag as a star chart. Makes the logo and the pedigree screens one idea. | Fails — needs a solid companion below ~48px |
| **Longhorn Double M** | Outer legs swept into horn tips. Says cattle before it says letters. | Holds as a shape, but the sweep is the first thing lost |
| **Lazy Double M** | Two M's lying down, back to back. Symmetric, reads as a chute. | Tight — and honestly may not read as M at all |
| **Double M Star** | The letters under a single star. The bridge mark. | Tight — works from 40px up |

## Recommendation

Not one mark — a family of three, because the app has a 24&nbsp;px nav, a
512&nbsp;px maskable icon and a PDF that gets signed, and no single drawing is
good at all three.

- **Primary — Bar Double M.** Survives the nav bar, stays one glyph, keeps a
  horizontal ground element as an echo of the rocker.
- **Square lockup — Stacked Double M.** For the PWA and Apple touch icons, where
  the primary's 2:1 proportion would be letterboxed into a square.
- **Hero and documents — Constellation Double M.** Kiosk splash, login, the top
  of a PDF — anywhere it renders at 64&nbsp;px or more on midnight.

## One thing to settle first

The two shipped files disagree about colour roles, so any new mark inherits an
unresolved question:

- `rocking-double-star-customer.svg` — stars in identity purple `#5F45B0`,
  rocker in bluebonnet blue `#35569E`.
- `logomark.tsx` and `rocking-double-star-admin.svg` — stars in `--gf-text`,
  rocker in `--gf-identity`.

So the component and the customer SVG render different marks on a light ground,
and the brand README's own description ("the stars carry the identity colour,
the rocker carries the surface's action colour") matches neither exactly.

These concepts follow the component: letters take the text colour on midnight
and identity purple on linen; the supporting element — rocker, bar, ring, star —
takes the second colour. Worth deciding deliberately rather than inheriting.

## If one of these is picked

`concepts.html` is a review sheet, not production art. The chosen mark still
needs the treatment the star mark got: a `Logomark`-style component reading
theme tokens, plus the two flat SVGs, living in `packages/ui/src/brand/`.
