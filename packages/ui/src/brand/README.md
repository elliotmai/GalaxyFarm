# Brand marks

**Rocking Double Star** — the farm's logomark, approved. A large star and a small
one on a rocker: a cow and a calf on shared ground.

| File                               | Surface                                | Ground                   |
| ---------------------------------- | -------------------------------------- | ------------------------ |
| `rocking-double-star-admin.svg`    | `/admin`, `/kiosk`                     | Midnight Nebula (dark)   |
| `rocking-double-star-customer.svg` | `/account`, `/book`, `/sitter`, public | Bluebonnet Linen (light) |

## Why it is two files

Theme is fixed per surface (spec §8), so a single mark on a single ground was
never going to work. The two variants are the same drawing in two colourways —
the stars carry the identity colour, the rocker carries the surface's action
colour. Both are mono-tone by design: cow and calf are the same kind of thing,
so colouring them differently would state something untrue.

The marks are **transparent**. They carry no background, because they sit on the
ground the surface theme provides.

## Rules

- **Colours come from `packages/config/tailwind.preset.ts`.** Do not introduce
  literals here. Brass stays in reserve; the safety scale is not brand.
- **Do not rebalance the pair.** The calf's size and distance from the cow were
  the whole design question — a smaller calf pulled in tight is what makes it
  read as a calf _at side_ rather than two animals in a field.
- **Keep the rocker.** It is what holds the two stars together as one mark,
  especially small. Without it the pair drifts apart below about 24px.

## Not here yet

No wordmark. The farm and business names are still undecided (issue #26), and
§5.1 treats both as `BrandingConfig` values rather than string literals. The mark
is deliberately name-independent, so nothing here needs redrawing when the names
are settled.
