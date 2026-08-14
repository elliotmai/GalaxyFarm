# Brand marks

**Flying Double M Connected** — the farm's logomark, approved. Two M's sharing a
leg, with a crest on each outer shoulder. Drawn in livestock-brand grammar: read
outside in and top to bottom, the crests are named before the letters, and two
of the same letter are read "Double M" rather than M M.

| File                                     | Ground             | Identity              |
| ---------------------------------------- | ------------------ | --------------------- |
| `flying-double-m-connected-customer.svg` | `flying-day` light | Ink Navy `#1B3A5C`    |
| `flying-double-m-connected-admin.svg`    | `flying-night`     | Lifted navy `#8FB3D9` |

## Why it is two files

A mark is one colour, and the one colour has to change with the ground under
it. The two variants are the same drawing in the two identity values —
day and night — so whichever ground a mark is placed on, there is a file that
reads on it.

The filenames are older than the split they now describe. They date from when
theme was fixed per surface and `/admin` meant dark; the working surfaces run
`flying-auto` now and follow the device, so the useful distinction is the
ground, not the route. Renaming them is worth doing and is not done here.

The marks are **transparent**. They carry no background, because they sit on the
ground the surface theme provides.

## Why it is one colour

A brand is a burn: the iron does not change weight or colour partway through a
mark. This one is a single connected figure, so there is no second element to
give a second colour to even if it wanted one. Identity carries the whole mark
on both grounds — 10.75:1 on the day canvas, 8.48:1 on the night one.

## Rules

- **Colours come from `packages/config/tailwind.preset.ts`.** Do not introduce
  literals here. Brass stays in reserve; the safety scale is not brand.
- **Keep the shared leg straight.** It is what makes the pair one mark rather
  than two letters standing near each other, and it has to stand upright: the
  right leg of a splayed M leans the opposite way to the left leg of the next
  one, so a splayed pair cannot merge at all.
- **Keep the crests turning outward.** Drawn rising the way the outer leg is
  already going, crest and leg read as one long stroke and the M loses one. The
  outward turn is the whole reason the letter survives having a crest on it.
- **Watch it small.** The crests are the first thing to close. Above about 48px
  this is at its best; at 24px — the `small` size, which is what the nav bars
  use — it reads as the connected pair with thickened shoulders. That is
  acceptable, and it is the known cost of the crests.

## Three drawings, one mark

The geometry appears in three places and they must not drift:

- `logomark.tsx` — the component, taking its colour from theme tokens
- `apps/web/app/icon.svg` — the favicon, with literal colours, because browser
  chrome paints it with no theme of ours in scope
- `tools/generate-icons.py` — the PWA and iOS rasters, regenerated with
  `python3 tools/generate-icons.py`

## Not here yet

No wordmark. The farm and business names are still undecided (issue #26), and
§5.1 treats both as `BrandingConfig` values rather than string literals. The mark
is deliberately name-independent, so nothing here needs redrawing when the names
are settled.

## Where it came from

Narrowed from thirteen candidates drawn to the grammar published by the Texas &
Southwestern Cattle Raisers Association. The exploration — the shortlist, the
size ladder, the eight application mockups, and the reasons the others were cut
— is on the `claude/double-m-brand-variants-nkqyg4` branch under
`docs/brand/double-m/`.
