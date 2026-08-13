# Double M — logo concepts

Sixteen candidate marks for a "Double M" identity, drawn in the same
livestock-brand grammar as the approved **Rocking Double Star** and coloured
from `packages/config/tailwind.preset.ts`.

**Status: exploration.** Nothing here is approved and nothing here replaces the
star mark in `packages/ui/src/brand/`. These are candidates for whenever issue
[#26](https://github.com/elliotmai/GalaxyFarm/issues/26) settles the farm and
business names.

Open **[`concepts.html`](./concepts.html)** to see them — every mark rendered on
both real grounds (Midnight Nebula and Bluebonnet Linen) at 96, 64, 40 and
24&nbsp;px, plus two pixel tests of the leading candidates rasterised at true 24
and 16&nbsp;px (`pixel-test.png`, `pixel-test-2.png`).

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

## The sixteen

Verdicts are against the threshold the brand README already put on the
record — the pair "drifts apart below about 24px". The three **Rocking
Connected** rows came out of asking what happens if the M's are joined but keep
the vertical stem between them; they are grouped after **Connected** because
that is the mark they fix.

| Mark | What it says | At 24px |
| --- | --- | --- |
| **Rocking Double M** | Same rocker, same shared ground, letters where the stars were. Least disruptive. | Holds — gap survives to 16px |
| **Connected Double M** | One unbroken zigzag, two M's sharing a middle apex. The default reading. | Holds as a shape, but reads as a crown, not letters |
| **Rocking Connected Double M** | The zigzag with a stem dropped from the shared apex, so each M gets its inner leg back. Joined *and* legible. | Holds — reads "M M" |
| **… posted** | Same, but the stem carries down into the rocker. One object on a centre axis. | Holds — the last one still reading as letters at 16px |
| **… half-stem** | Stem stops level with the valleys. Lighter, open bottom edge. | Tight — the stem disappears; reverts to a crown |
| **Dam & Calf Double M** | Big M and small M at side. "Double M" and "cow and calf" are the same picture. | Tight — the calf must stay near 52% |
| **Bar Double M** | Zigzag over a straight bar; the bar does the rocker's job with one less curve. | Holds as a shape, but reads as a crown over a line |
| **Stacked Double M** | One M over another. The only square variant, and the only one where two tones say something true (farm name over business name). | Tight — merges at 24px; its slots are 180px+ |
| **Circle Double M** | Enclosed, so it has its own edge. The seal for signed PDFs and invoices. | Tight — the ring eats the letters below ~40px |
| **Constellation Double M** | The zigzag as a star chart. Makes the logo and the pedigree screens one idea. | Fails — needs a solid companion below ~48px |
| **Constellation Bar Double M** | The star chart given a floor. | Tight — the bar survives, the stars do not |
| **Longhorn Double M** | Outer legs swept into horn tips. Says cattle before it says letters. | Holds as a shape, but the sweep is the first thing lost |
| **Lazy Double M** | Two M's lying down, back to back. Symmetric, reads as a chute. | Tight — and honestly may not read as M at all |
| **Double M Star** | The letters under a single star. The bridge mark. | Tight — works from 40px up |
| **Crossed Double M** | Two whole M's, legs splayed, overlapped until the inner two cross — two longhorns standing side by side. Straight lines, no curves. | Tight — keeps two peaks, loses the crossing |
| **… barred** | The crossed pair on a bar, which supplies the common ground the height offset takes away. | Tight — same, with an anchor |

## Recommendation

Not one mark — a family of three, because the app has a 24&nbsp;px nav, a
512&nbsp;px maskable icon and a PDF that gets signed, and no single drawing is
good at all three.

- **Primary — Rocking Connected Double M, posted.** One connected object, so it
  cannot drift apart at any size, and the only candidate still reading as two
  letters at 16&nbsp;px. Keeps the approved rocker. The full-stem version is the
  same mark one decision quieter, if the stem landing in the rocker is too much.
- **Square lockup — Stacked Double M.** For the PWA and Apple touch icons, where
  the primary's 2:1 proportion would be letterboxed into a square.
- **Hero and documents — Constellation Double M.** Kiosk splash, login, the top
  of a PDF — anywhere it renders at 64&nbsp;px or more on midnight.

## What the pixel test changed

Everything on the sheet is SVG, which the browser draws crisply at any size and
which therefore flatters every candidate. Rasterising the leading marks at true
24 and 16&nbsp;px moved two conclusions:

- **Rocking Double M was marked down wrongly.** This file first said its gap
  closes below 32&nbsp;px. It does not — the gap survives 24 and 16&nbsp;px
  intact, and it is the clearest "M M" on the sheet at both.
- **Holding together and still reading as letters are two different tests.**
  Connected, Bar and the half-stem all survive small sizes as marks while
  quietly becoming a single crown. For a mark whose whole job is to say
  "Double M", that is a real demerit, and it is why the primary changed from Bar.

## What the second pixel test changed

The three marks above were given verdict chips before being rasterised, and all
three came back down a grade:

- **A bar under the constellation buys presence, not legibility.** At 24 and
  16&nbsp;px the bar stays solid and bright while the star chart above it goes
  to speckle. That is a real gain over the bare constellation, which leaves
  nothing at all — but it still is not a mark that says "M M". Its range is the
  middle: from about 40&nbsp;px the bar gives the constellation the weight it
  was missing, which makes it usable on a PDF header or an email signature.
- **The crossed pair keeps its letters at 24&nbsp;px and loses its crossing.**
  The two peaked forms stay distinct; the overlap fills in solid, because the
  strokes merge rather than passing over and under. A true interlace would need
  a knockout in the ground colour, and these marks are transparent by design.
  By 16&nbsp;px both crossed versions are humps.

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
