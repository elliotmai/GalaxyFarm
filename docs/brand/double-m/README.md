# Double M — logo concepts

Twenty-seven candidate marks for a "Double M" identity, read in the same
livestock-brand grammar as the approved **Rocking Double Star** and coloured
from `packages/config/tailwind.preset.ts`.

**Status: exploration.** Nothing here is approved and nothing here replaces the
star mark in `packages/ui/src/brand/`. These are candidates for whenever issue
[#26](https://github.com/elliotmai/GalaxyFarm/issues/26) settles the farm and
business names.

Open **[`concepts.html`](./concepts.html)** to see them — every mark rendered on
both real grounds (Midnight Nebula and Bluebonnet Linen) at 96, 64, 40 and
24&nbsp;px, plus three pixel tests of the leading candidates rasterised at true
24 and 16&nbsp;px (`pixel-test.png` … `pixel-test-4.png`).

Sixteen are drawn in the sheet's rounded brand-iron language. Eight are
vectorised from a hand-drawn sheet and keep that sketch's language instead —
sharp mitred corners, flat stroke ends, a lighter line. The last three are those
sketched bases redrawn to brand-iron tolerances.

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

## The eight sketched bases

Vectorised from a hand-drawn sheet, forms kept, proportions regularised.

| Base | What it is |
| --- | --- |
| **Overlapped** | Two whole M's, half-overlapped, four legs down. The most literal "double" of the set. |
| **Double-struck** | One M printed twice a few units apart — weight and shadow, not two letters. |
| **Shallow middle** | Two M's meeting at a raised joint rather than a shared apex. |
| **Splayed crown** | Three peaks, middle one dropped, legs kicked out. |
| **Wide crown** | The same dropped-apex move on vertical legs. Cleanest of the eight small. |
| **Nested V** | One M with a second V hung inside it — the only base that is not two M's. |
| **Angular, wide** | Two all-diagonal M's overlapped, no verticals. Range and horizon before letters. |
| **Angular, tight** | Same, second M smaller and dropped; the asymmetry does the dam-and-calf job. |

Dropping the shared apex, which four of these do, turns out to be a second
answer to the problem the vertical stem solved: it separates the two M's
without adding a stroke.

These are compared at 24&nbsp;px inside their own section rather than in the
main bench, because a 6-unit mitred line and a 9-unit rounded one do not lose
legibility at the same rate.

### Three of them, up close

**Overlapped**, **Double-struck** and **Angular tight** are shown at every size
and rasterised at true 24 and 16&nbsp;px. One thing decides all three, and it is
not complexity:

| Base | At 24px | Why |
| --- | --- | --- |
| **Overlapped** | Tight | The two inner legs sit closer than any other pair of strokes; that channel greys over at 24px and has closed by 16. |
| **Double-struck** | Fails | Every stroke has a twin a few units away — the worst possible case. At 24px the pairs have merged into a solid mass; at 16 it is a filled block with a hole in it. |
| **Angular, tight** | Tight | Survives smallest of the three despite being the busiest drawing, because nothing in it runs parallel and close. |

**Count the narrowest gap, not the number of strokes.** The gap between two
parallel strokes is the first thing a small raster throws away, which is why the
busiest of the three outlasts the other two.

Worth noting separately: the 6-unit line goes noticeably grey at 24&nbsp;px next
to the 8- and 9-unit rounded marks. The lighter line is the sketch language's
real cost, and it is paid at exactly the size the nav bar uses.

Fixes, if any of these is the direction: **Overlapped** wants a wider overlap so
the inner legs sit as far apart as the outer ones. **Double-struck** is a
large-format mark or nothing — reserve it for 64&nbsp;px and up, because widening
the offset enough to save it turns it into Overlapped.

## Made brandable

Three of the sketched bases — **Overlapped**, **Double-struck** and **Angular
tight** — redrawn so they work small *and* work as an actual iron.

These turn out to be one requirement, not two. A hot iron and a small raster
destroy the same thing first: the narrow gap between two roughly-parallel
strokes. Heat spreads into it and closes it; a 24px grid has no pixel to spare
for it. So one set of rules serves both.

**The rules**

- Stroke 9 units, and no two roughly-parallel strokes closer than twice that,
  centre to centre.
- Vertices may be acute; channels may not be narrow. A sharp point blunts under
  the iron and survives as a point. A long thin gap fills and never comes back.
- Flat ends, mitred corners — a brand iron is cut and bent bar.
- Tested by thickening every stroke from 9 to 15 (a 1.7× spread) to stand in for
  the burn, and by rasterising at 24 and 16px. Not eyeballed.

**What changed**

| Mark | Change | Result |
| --- | --- | --- |
| **Overlapped, opened** | Overlap opened to exactly half the letter, spacing all four legs evenly at 26 units. | The two V's clear by 11 units where they ran nearly parallel. Each valley now welds to its neighbour's leg — a T-junction, which an iron makes happily. |
| **Double-struck, vertical** | Second strike moved from beside the first to below it. | Legs coincide and reinforce; the two V's stack 28 units apart, a 12-unit clearance where there was none. |
| **Angular, opened** | Valleys opened to 72°, small M widened to 22 units across the apexes, its outer stroke laid shallower. | The crossing meets at 45° instead of 34°. At 45° it burns as a crossing; at 34° it burns as a blot. |

All three now hold at 16px, where two of them previously failed at 24.

**Why Double-struck had to move vertically** — arithmetic, not taste. The
horizontal offset has to reach 18 units to clear the legs, but at anything short
of exactly half the letter width the first M's valley lands within 4 units of the
second M's leg. At exactly half, the legs space evenly and you have Overlapped.
There is no horizontal double-strike that is neither blotchy nor already
Overlapped. The vertical form lands on the same construction as base six,
reached from the opposite direction.

## Recommendation

Not one mark — a family of three, because the app has a 24&nbsp;px nav, a
512&nbsp;px maskable icon and a PDF that gets signed, and no single drawing is
good at all three.

This picks from the rounded marks only. Choosing between the two drawing
languages is the prior question — if the answer is sharp, **Wide crown** is the
one to build the family around and the three below get redrawn rather than
reconsidered.

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
