# Double M — logo concepts

Nine candidates for a "Double M" identity, named and drawn the way registered
livestock brands are. Grammar from TSCRA's
[How to Design a Brand](https://tscra.org/what-we-do/theft-and-law/brand-design/);
colours from `packages/config/tailwind.preset.ts`.

**Status: exploration.** Nothing here is approved and nothing replaces the star
mark in `packages/ui/src/brand/`. Candidates for whenever issue
[#26](https://github.com/elliotmai/GalaxyFarm/issues/26) settles the names.

Open **[`concepts.html`](./concepts.html)**. Marks are named modifier-first, as
brands are read.

## The correction

Earlier versions of this sheet were built from search summaries of the TSCRA
page, because the network here blocks the site. Working from the page itself
changes most of it.

**The letters are plain and sharp.** That is how the sample brands are drawn — a
regular A is a regular A, with a point on top. This sheet mitred the corners,
then splayed the letters to avoid having corners, then broke the corners open,
then rounded them off. All four were wrong.

**"Running" does not mean rounded angles.** It means a *cursive* letter, denoted
by curves — the page illustrates it with a script lowercase `a`. I had used the
word to justify rounding every corner.

**"Rocking" means attached.** A curved mark *attached to the bottom* of a letter
is a rocking letter. A letter merely standing above a quarter circle is read
"letter quarter circle" — a different brand with a different name. Previous
passes floated the rocker an inch below the letters, which is the other brand.

**Most of the "rules" were not brand rules.** Notch widths, bar-face dimensions,
minimum bend radii, clear-space minimums, a straight-run rule — none of that is
on the page. It came from iron-making sources, about how a smith builds the tool,
and got quietly promoted into rules about how the artwork should look. Some of it
matters when an iron is actually ordered. None of it belongs in the drawing.

## Drawn, not plotted

The samples on the page are brushed by hand, but they are not scraggly — the
edges are clean and straight and the strokes are confident. What marks them as
drawn is that the **geometry** is off true: the two halves of an M are not mirror
images, the legs splay by different amounts, one apex sits a little higher than
the other, and the two letters of a pair are not copies.

So each stroke is a **filled outline** built from the corner points with mitred
joins — every edge dead straight — with the stroke weight easing gently across a
letter and each letter taking its own small nudge off true.

An earlier pass put the irregularity in the wrong place: it wobbled the
centreline at every sample point and blobbed the corners, which produced exactly
the mess that word describes. Irregular geometry, clean edges — not the reverse.

It runs off a fixed seed, so the file is reproducible: rerunning `iron-check.py`
gives byte-identical output.

## The grammar

| Rule | Value | Detail |
| --- | --- | --- |
| Keep it simple | 2–3 units | "Many brands have three units. Few brands have more than three." |
| Reading order | left to right, top to bottom, outside in | joined letters take "connected" |
| Marks | four kinds | letters, numbers, lines and circles, pictures |
| Rocking | attached below | a curved mark attached to the bottom of a letter |
| Swinging | attached above | a quarter or half circle attached to the top |
| Bar / rail | short / twice as long | letters may sit or rest above a rail |
| Other modifiers | — | tilting, tumbling, toppling; walking; winged or flying; running (cursive); dragged |

## The nine

| Mark | Units | Ratio |
| --- | --- | --- |
| **Double M** | 2 | 1.72:1 |
| **Rocking Double M** | 3 | 1.44:1 |
| **Swinging Double M** | 3 | 1.32:1 |
| **Bar Double M** | 3 | 1.32:1 |
| **Rail Double M** | 3 | 1.59:1 |
| **Connected Double M** | 1 | 1.50:1 |
| **Rocking Connected Double M** | 2 | 1.26:1 |
| **Lazy Double M** | 2 | 0.58:1 |
| **Tumbling Double M** | 2 | 1.08:1 |

- **Connected Double M** is the only single-unit mark and the simplest here — the
  two M's share their middle leg.
- **Lazy Double M** is the only one taller than wide, so it's the one for a square
  slot.
- **Bar** and **Rail** tie the pair together with a straight length of stock
  rather than a formed curve.
- **Rocking Double M** keeps the modifier the approved star mark already uses.

## Generating the marks

`iron-check.py` builds every mark from brand grammar, checks it, and writes
`paths.json` — the path data the sheet uses:

```
python3 iron-check.py
```

It checks unit count, and that anything named *rocking* or *swinging* actually
touches the letters, since attachment is what the name means.

## Still to settle

The two shipped files disagree about colour roles:

- `rocking-double-star-customer.svg` — stars in identity purple `#5F45B0`,
  rocker in bluebonnet blue `#35569E`.
- `logomark.tsx` and `rocking-double-star-admin.svg` — stars in `--gf-text`,
  rocker in `--gf-identity`.

These concepts follow the component: letters take the text colour on midnight and
identity purple on linen; the modifier takes the second colour.

## If one of these is picked

`concepts.html` is a review sheet, not production art. The chosen mark still needs
the treatment the star mark got: a `Logomark`-style component reading theme
tokens, plus the two flat SVGs, in `packages/ui/src/brand/`.

The iron-making guidance that was wrongly baked into earlier drafts becomes
relevant at that point, not before: heat pools in a sharp corner, smiths file a
notch at one, and lines set too close burn together. That is a conversation to
have with whoever makes the iron.
