# Double M — logo concepts

Eight candidate marks for a "Double M" identity, drawn as things you could
actually have made. Coloured from `packages/config/tailwind.preset.ts`, read in
the same livestock-brand grammar as the approved **Rocking Double Star**.

**Status: exploration.** Nothing here is approved and nothing here replaces the
star mark in `packages/ui/src/brand/`. These are candidates for whenever issue
[#26](https://github.com/elliotmai/GalaxyFarm/issues/26) settles the farm and
business names.

Open **[`concepts.html`](./concepts.html)**. Numbering carries over from the
earlier sheets, so the gaps are the cuts; the full history — twenty-seven marks,
then six, then nine — is in git if any of it is wanted back.

## An iron is bent bar

This is the fact the earlier sheets got backwards. A branding iron is flat steel
stock bent into shape, so **every corner is an arc** — flat bar bends, it does not
fold. A mitred corner isn't a drawing decision, it's a cut and two welds: weaker,
more expensive, and it burns hotter than the rest of the iron.

Those sheets were organised around a fork between "rounded brand-iron language"
and the sketches' "sharp mitred language," and treated choosing between them as
the real decision. Once corners have to be bends, the fork closes. There is one
language and it is the rounded one. The sharp set were drawings of an iron nobody
would make.

## The rules

Five constraints, all physical. Every mark is checked against them by
measurement; the numbers are quoted per mark on the sheet.

| Rule | Value | Because |
| --- | --- | --- |
| Bar face | 6.5% of letter height | ¼ inch bar on a 4 inch brand |
| Bend radius | 1.5 × bar width | flat bar cracks below this |
| Minimum angle | 60° | an acute crotch pools heat from both arms and blots |
| Clear space | 2.5 × bar width | the scar spreads to ~1.7× the bar face |
| Pieces | fewer is better | separate elements need a backing plate and heat unevenly |

**Bar face was the number the earlier sheets had wrong.** They drew at 16% of
letter height. At that weight the minimum bend radius swallows the letterform —
the marks come out as rounded humps rather than M's. At 6.5% they read as letters.

## What the rules do to the letter M

An M's apex is where a leg meets a diagonal, and its angle is
`leg splay + half the valley angle`. Both the apex and the valley must clear 60°:

- Upright legs give a **32° apex**. So **a brandable M has no vertical strokes** —
  the legs have to splay.
- Splaying makes it wide: **1.3 to 1.7 times as wide as tall**, depending how the
  angle budget is spent. A 90° valley with legs splayed only 15° is the cheapest
  arrangement, and is what everything here uses.
- **Two of those side by side cannot fit a square box.** Aspect ratios on this
  sheet run 1.30:1 to 2.68:1.

**The stem in the old number 11 cannot be made.** A bar dropped from the shared
apex splits it into two 30° crotches, and no size or weight fixes that. Dropping
the apex instead separates the two M's with no extra stroke and no crotch — which
is what the original sketch sheet was already reaching for.

## The eight

| # | Mark | Irons | Ratio | Note |
| --- | --- | --- | --- | --- |
| 1 | **Rocking Double M** | 3 | 2.08:1 | closest to the approved star mark; most expensive iron |
| 1a | **Double M** | 2 | 2.68:1 | widest mark here |
| 11 | **Rocking Connected Double M** | 2 | 1.60:1 | dropped apex in place of the stem |
| 11a | **Connected Double M** | 1 | 2.02:1 | one bent length, no welds, no backing |
| 25 | **Overlapped Double M** | 1 | 2.17:1 | tightest overlap the rules permit |
| 26 | **Double-struck Double M** | 1 | 1.30:1 | squarest mark here |
| 24 | **Angular, tight** | 1 | 1.85:1 | dam and calf |
| 27 | **Angular, opened** | 1 | 1.77:1 | two equal M's, second dropped |

**11a is the cheapest iron by a distance** — one length of bar, bent, no welds and
no backing plate. **26 is the squarest** at 1.30:1, and only because it stacks the
second strike instead of standing it alongside.

## What the rules took away

**The dam-and-calf contrast.** The calf in 24 can only be 86% of the dam. The bar
doesn't shrink with the letter, so a smaller M runs out of clear space before it
looks meaningfully smaller. The dramatic size difference in the original sketch
isn't available at any scale.

**The square.** Nothing is near 1:1 except 26. If a square icon is a hard
requirement, that is a requirement to not put two letters side by side.

**Two marks merged.** 1b and 25 resolve to identical geometry once spaced at the
tightest overlap the clear-space rule allows. Nine went in, eight came out.

## Screen

Held over deliberately. Worth flagging: these are wide, so a 16px square slot
letterboxes them to about 8px of letter. **None of these is a favicon.**

A brand that burns and a mark that survives a browser tab are close to opposite
problems, and this sheet is now solved hard for the first. If both are needed the
answer is probably two marks — the iron for physical use and signage, a squarer
derivative for the interface — rather than one mark asked to do both.

## Still to settle

The two shipped files disagree about colour roles:

- `rocking-double-star-customer.svg` — stars in identity purple `#5F45B0`,
  rocker in bluebonnet blue `#35569E`.
- `logomark.tsx` and `rocking-double-star-admin.svg` — stars in `--gf-text`,
  rocker in `--gf-identity`.

So the component and the customer SVG render different marks on a light ground,
and the brand README's own description matches neither exactly. These concepts
follow the component: letters take the text colour on midnight and identity
purple on linen; the rocker takes the second colour.

## If one of these is picked

`concepts.html` is a review sheet, not production art. The chosen mark still needs
the treatment the star mark got: a `Logomark`-style component reading theme
tokens, plus the two flat SVGs, living in `packages/ui/src/brand/`.

## Checking the geometry

`iron-check.py` builds every mark from its angle parameters and verifies it against
the five rules, then writes `paths.json` — the path data the sheet uses. Run it to
reproduce any number quoted in `concepts.html`:

```
python3 iron-check.py
```

It reports the closest approach between any two strokes per mark, or `welded`
where strokes are meant to touch. All eight pass.
