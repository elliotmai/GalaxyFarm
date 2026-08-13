# Double M — logo concepts

Nine candidate marks for a "Double M" identity: six shortlisted from twenty-seven,
plus three sharpened, rocker-less versions of two of those six. All read in the
same livestock-brand grammar as the approved **Rocking Double Star** and coloured
from `packages/config/tailwind.preset.ts`.

**Status: exploration.** Nothing here is approved and nothing here replaces the
star mark in `packages/ui/src/brand/`. These are candidates for whenever issue
[#26](https://github.com/elliotmai/GalaxyFarm/issues/26) settles the farm and
business names.

Open **[`concepts.html`](./concepts.html)** to see them — each on both real
grounds (Midnight Nebula and Bluebonnet Linen) at 96, 64, 40 and 24&nbsp;px, plus
the two tests below.

Numbering is the original twenty-seven-mark sheet's, so the gaps are the cuts; a
letter suffix (1a, 1b, 11a) means a mark derived from the number it carries. The
full set is in git history if a dropped one is wanted back.

## The two tests

Each mark carries two verdicts, and they are not the same threshold.

- **Screen** — rasterised at true 24 and 16&nbsp;px (`pixel-test.png`), because
  SVG draws crisply at any size and flatters everything.
- **Iron** — every stroke thickened 1.7×, standing in for heat spreading through
  hide as the iron lands.

Both destroy the same thing first: the narrow gap between two roughly-parallel
strokes. But heat spreads further than a pixel grid rounds, so a mark can pass
one and fail the other — and two of the six do.

## The six

| # | Mark | Language | Screen | Iron |
| --- | --- | --- | --- | --- |
| 1 | **Rocking Double M** | rounded | Holds at 16px | **Fails** |
| 11 | **Rocking Connected Double M** | rounded | Holds at 16px | **Fails** |
| 24 | **Angular, tight** | sharp, 6-unit | Tight at 16px | Passes |
| 25 | **Overlapped, opened** | sharp, 9-unit | Holds at 16px | Passes |
| 26 | **Double-struck, vertical** | sharp, 9-unit | Holds at 16px | Passes |
| 27 | **Angular, opened** | sharp, 9-unit | Holds at 16px | Passes |

**1 — Rocking Double M.** Straight translation of the approved mark: same rocker,
same shared ground, letters where the stars were. The clearest "M M" of the six.

**11 — Rocking Connected Double M.** The zigzag with a stem dropped from the
shared apex, so each M gets its inner leg back. One glyph, still two letters.

**24 — Angular, tight.** Two all-diagonal M's, the second smaller and dropped;
the asymmetry does the dam-and-calf job. Same drawing as 27, at the sketch's
lighter weight.

**25 — Overlapped, opened.** Two whole M's, half-overlapped, four legs evenly
spaced at 26 units. The most literally a *double* M.

**26 — Double-struck, vertical.** One M struck twice, second strike below the
first. Says "double" by repeating the whole letter.

**27 — Angular, opened.** 24 with the gaps opened — valleys to 72°, the small M
widened, its outer stroke laid shallower so the crossing meets at 45° not 34°.

## What the iron test exposed

**The four sharp marks pass. The two rounded ones fail.** Not dramatically — they
do not vanish. Each fails at a different place: in number 1 the 16-unit channel
*between* the two letters comes down to 2.4 units under the spread, while the V
inside each M stays open through its top half; in number 11 it is the 42° wedge
where the stem meets the diagonals, open through only 29% of its length. The rule
wants at least one stroke width of clearance the whole way, and neither holds it.

The cause is proportion, not language. Numbers 1 and 11 pack two whole M's into
the same box the sharp marks give to one-and-a-bit, so each letter is about half
the width while the stroke stays the same — roughly 29% of each letterform is
ink, against 17% for number 25. They were drawn to a 24px legibility standard,
which they meet comfortably, and never to an iron standard, which nothing had
asked of them until now.

Fixable the same way 25–27 were fixed — widen the letters, or drop to one M and a
rocker — but that is a redraw, not a tweak, and a wider mark sits differently
next to the approved star mark. Worth deciding whether a physical brand is in
scope before spending it.

## Sharpened, rocker removed

New versions of 1 and 11: mitred corners and flat stroke ends, rocker taken off.
All three pass both tests, which neither parent did.

| # | Mark | Box | Ink | Tightest feature at the iron |
| --- | --- | --- | --- | --- |
| 1a | **Double M, sharp** | square | 26% | channel between the M's, +6.7 |
| 1b | **Double M, sharp, wide** | 1.32:1 | 19% | channel between the M's, +8.7 |
| 11a | **Connected Double M, sharp** | square | 20% | stem-to-diagonal wedge, 35% open |

**Removing the rocker is not what fixed the iron.** Both failures were horizontal
— the channel between the letters in 1, the stem wedge in 11 — and neither has
anything to do with what sits underneath. The fix came from widening the channel
(16 → 22/24 units) and opening the valleys to 72°, and could have been done with
the rocker left on.

What removing it bought is **size**. The rocker occupied the bottom 40% of the
box, so the letters had 34 units of height; without it they have 64. That is why
the sharpened versions render *larger* at 24 and 16px than their parents
(`sharpened-test.png`) — which was not the stated goal and is the clearest thing
in the comparison.

What it costs: the rocker was the visual tie to the approved **Rocking Double
Star**. Without it these stop being the same family as the mark in
`packages/ui/src/brand/` and become a separate identity sharing a palette.
Whether that is a cost depends on whether issue #26 keeps the star mark alongside.

Ranked by margin: **1b** has the most room by a distance and is the only one not
square; **11a** is comfortable except at the stem wedge, improved from 29% to 35%
open but still its tightest feature; **1a** passes with the least margin on the
sheet, because two whole M's in a square box is close to a geometric floor.

If the square matters, 1a and 11a are the replacements. If it does not, 1b is the
better drawing and it is not close.

## Where that leaves it

- **If the mark has to be burnable:** pick from 25, 26, 27. All three hold at
  16px too, so they cost nothing on the screen side. 27 survives smallest and
  needed the least work; 25 is the most literally a double M.
- **If it is a screen mark only:** 1 and 11 are the clearest pair of letters here
  and the only survivors that keep the approved rocker.
- **If the rocker is negotiable:** 1a, 1b and 11a pass both tests and read larger
  small than anything else on the sheet.
- **24 and 27 are one drawing at two weights** — decide them together.

## One thing to settle whichever wins

The two shipped files disagree about colour roles:

- `rocking-double-star-customer.svg` — stars in identity purple `#5F45B0`,
  rocker in bluebonnet blue `#35569E`.
- `logomark.tsx` and `rocking-double-star-admin.svg` — stars in `--gf-text`,
  rocker in `--gf-identity`.

So the component and the customer SVG render different marks on a light ground,
and the brand README's own description ("the stars carry the identity colour, the
rocker carries the surface's action colour") matches neither exactly.

These concepts follow the component: letters take the text colour on midnight and
identity purple on linen; the supporting element takes the second colour. Worth
deciding deliberately rather than inheriting.

## If one of these is picked

`concepts.html` is a review sheet, not production art. The chosen mark still needs
the treatment the star mark got: a `Logomark`-style component reading theme
tokens, plus the two flat SVGs, living in `packages/ui/src/brand/`.
