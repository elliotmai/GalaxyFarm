# Double M — logo concepts

Nine candidate marks for a "Double M" identity, drawn as registrable livestock
brands rather than as logos that gesture at one. Rules from
[TSCRA brand design](https://tscra.org/what-we-do/theft-and-law/brand-design/)
and ordinary iron-making practice; colours from
`packages/config/tailwind.preset.ts`.

**Status: exploration.** Nothing here is approved and nothing replaces the star
mark in `packages/ui/src/brand/`. Candidates for whenever issue
[#26](https://github.com/elliotmai/GalaxyFarm/issues/26) settles the names.

Open **[`concepts.html`](./concepts.html)**. Marks are named in brand grammar —
modifier first, letter last — rather than by the numbering earlier sheets used.
The full history is in git.

> **Sourcing caveat.** This environment's network blocks `tscra.org`, so the
> rules below were assembled from search summaries of that page plus the
> iron-making sources at the end. I have not seen a single brand rendered on it.
> Anything here that conflicts with the drawings on the page itself is wrong
> here, not there.

## The correction

The corners took three goes.

**First they drew mitred corners** and called that the buildable language. Flat
bar bends; it doesn't fold. A mitre is a cut and two welds.

**Then they over-corrected.** Told that sharp corners trap heat, they treated it
as a *shape* problem and reshaped the letters to avoid sharp corners at all —
splaying the legs until the M's were 1.6× wider than tall and barely read as
letters. That produced a derivation, presented confidently, that "a brandable M
has no vertical strokes." It was an artefact of a 60°-minimum-angle rule that was
invented rather than looked up.

**Then they drew the corners broken.** Having learned that the trade files a ¼
inch notch at a sharp corner, the sheet put that notch in the *artwork* — visible
gaps at every corner and joint.

**Corners are attached and rounded.** A brand is one unbroken drawing. Rounded
angles have their own name in the grammar: a letter drawn that way is *running*.
The notch is real, but it is a groove cut in the **face** of the iron so heat can
escape a corner instead of burning through — a fabrication detail, not a feature
of the design, and it does not belong in the artwork.

So these have upright legs, ordinary proportions, and every corner attached and
rounded, with the radius capped per corner at a quarter of the shorter arm so an
acute corner is softened rather than swallowed.

## The rules

Per 100 units of letter height, so a 4″ character puts 1″ at 25 and ¼″ at 6.25.

| Rule | Value | Because |
| --- | --- | --- |
| Reading order | left to right, top to bottom, outside in | joined characters read "connected" |
| Units | 2 or more, rarely over 3 | simple brands read better and hurt the animal less |
| Corners | attached, rounded | the bar runs through; rounded angles are *running* |
| Notch | ¼ inch, in the face | filed at sharp corners and joints so heat escapes — not drawn |
| Bar face | ¼ to ½ inch | edges slightly rounded; this sheet uses 10% of letter height |
| Character | 4×3 inch | calves under a year; 6×3½ for grown cattle |
| Clear space | 1 inch | between characters and between any two parallel lines |

## The nine

| Mark | Units | Filed corners | Ratio |
| --- | --- | --- | --- |
| **Rocking Double M** | 3 | 6 | 1.31:1 |
| **Double M** | 2 | 6 | 1.59:1 |
| **Bar Double M** | 3 | 6 | 1.45:1 |
| **Rocking Connected Double M** | 2 | 5 | 1.15:1 |
| **Connected Double M** | 1 | 5 | 1.38:1 |
| **Bar Connected Double M** | 2 | 5 | 1.28:1 |
| **Dropped Double M** | 2 | 6 | 1.31:1 |
| **Dam and Calf Double M** | 2 | 6 | 1.41:1 |
| **Lazy Double M** | 2 | 6 | 0.63:1 |

- **Connected Double M** is the cheapest iron and the only single-unit mark — one
  zigzag of bar plus a welded spur for the shared leg.
- **Lazy Double M** is the only one taller than wide, so it's the one to look at
  if a squarish lockup matters.
- **Bar Double M** buys the tying-together that the rocker gives, for a modifier
  with no bends in it.
- **Rocking Double M** stays closest to the approved star mark and costs the most
  iron.

## What the rules changed

**Fixed the letterforms.** Aspect ratios went from 1.30–2.68:1 to 0.63–1.59:1 —
which is just what letters look like.

**Killed Overlapped Double M and Double-struck Double M.** Both are *defined* by
putting strokes close together, and the 1″ minimum between parallel lines rules
out both. No redrawing saves them.

**Killed the "angular" pair.** Those existed only to dodge sharp corners by making
every stroke a diagonal. With notching, that problem doesn't exist.

**Brought back the joined middle leg.** An earlier sheet concluded a stem was
impossible because it made two 30° crotches. It does — and a notch at that joint
is the standard answer.

**The dam-and-calf contrast is still capped**, but by clear space rather than by
angle: the calf is 70% of the dam, as small as it goes before its own valley falls
under the 1″ minimum.

## Screen

Still deliberately secondary. These are much closer to square than the last set,
so it's less bleak — but the notches are the new question. A ¼″ break is 6% of
letter height, which at 16px is a fraction of a pixel and will vanish.

That isn't a fault; a screen mark has no heat to vent. But it means the burned
brand and the drawn logo are not the same artwork, and a screen version should
probably close the notches up.

## Checking the geometry

`iron-check.py` builds every mark from its parameters, verifies it against the
rules, and writes `paths.json` — the path data the sheet uses. Run it to reproduce
any number quoted in `concepts.html`:

```
python3 iron-check.py
```

It reports units, how many corners need filing, and the closest approach
between any two lines.
All nine pass.

## Sources

- [TSCRA — How to Design a Brand](https://tscra.org/what-we-do/theft-and-law/brand-design/)
- [Ownership Identification — Branding Irons](https://www.ownershipid.ca/branding-information/branding-irons)
- [Livestock Identification Services — Applying Brands](https://lis-ab.com/brands/applying-brands/)
- [Oklahoma State — Livestock Branding in Oklahoma](https://pods.okstate.edu/fact-sheets/AFS-3255pod2019.pdf)

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
