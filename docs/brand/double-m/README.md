# Double M — logo concepts

Six candidate marks for a "Double M" identity, shortlisted from twenty-seven,
read in the same livestock-brand grammar as the approved **Rocking Double Star**
and coloured from `packages/config/tailwind.preset.ts`.

**Status: exploration.** Nothing here is approved and nothing here replaces the
star mark in `packages/ui/src/brand/`. These are candidates for whenever issue
[#26](https://github.com/elliotmai/GalaxyFarm/issues/26) settles the farm and
business names.

Open **[`concepts.html`](./concepts.html)** to see them — each on both real
grounds (Midnight Nebula and Bluebonnet Linen) at 96, 64, 40 and 24&nbsp;px, plus
the two tests below.

Numbering is the original twenty-seven-mark sheet's, so the gaps are the cuts.
The full set is in git history if a dropped one is wanted back.

## The two tests

Each mark carries two verdicts, and they are not the same threshold.

- **Screen** — rasterised at true 24 and 16&nbsp;px (`pixel-test.png`), because
  SVG draws crisply at any size and flatters everything.
- **Iron** — every stroke thickened 1.7×, standing in for heat spreading through
  hide as the iron lands.

Both destroy the same thing first: the narrow gap between two roughly-parallel
strokes. But heat spreads further than a pixel grid rounds, so a mark can pass
one and fail the other — and two of these six do.

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
do not vanish. Under the spread the V inside each M closes from the valley upward
and survives only as a nick at the top, and the rocker crowds the letters above
it. At 1.7× the V in number 1 has about 14 units of clear space at the apexes and
none by half its depth, against a rule that wants at least one stroke width the
whole way. Number 11 is tighter still: its stem sits 18 units from each valley,
leaving 4 units clear once the stroke has spread.

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

## Where that leaves it

- **If the mark has to be burnable:** pick from 25, 26, 27. All three hold at
  16px too, so they cost nothing on the screen side. 27 survives smallest and
  needed the least work; 25 is the most literally a double M.
- **If it is a screen mark only:** 1 and 11 are the clearest pair of letters here
  and the only survivors that keep the approved rocker.
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
