# Double M

Thirteen ways to draw a **Double M** iron. An exploration, not a decision — the
approved logomark is still the Rocking Double Star in `packages/ui/src/brand/`,
and nothing here touches it.

Open `contact-sheet.html` to see the set together, each mark at full size and
again at 24px. The SVGs are the same drawings on their own.

## The grammar these follow

From _How to Design a Brand_, Texas & Southwestern Cattle Raisers Association.
Its rules, in the order they matter:

- **Keep it simple.** A simple brand is easier to read and less painful for the
  animal. Everything below is downstream of this.
- **Two or three units.** A design is two or more symbols; many are three; few
  are more than three.
- **Brands are read left to right, top to bottom, from outside in.** This is
  what names them. A bar above the letters is read before them; a curve below
  them is read after. Joined symbols may pick up the word _connected_.
- **Four kinds of marks**: letters, numbers, lines and circles, pictures.
- **Letters take modifiers**: tilting/tumbling, walking, flying, running,
  dragged, lazy (on its side), crazy (upside down).
- **Lines and circles have their own names**: bar (short), rail (about twice a
  bar, letters resting above it), slash (diagonal), rafter, box, cross, circle,
  quarter circle. A curve _attached_ to the bottom of a letter is **rocking**; a
  quarter or half circle attached to the top is **swinging**; a letter merely
  sitting above a quarter circle is read letter-then-curve.

Two of the same letter side by side are read **Double M**, not M M — the
association's own sample sheet reads `HH` as DOUBLE H.

The names in the table below are therefore not labels. Each is what the brand
would be called out as, recorded as, and argued about.

## The set

| Reading                          | File                                  | Units                       |
| -------------------------------- | ------------------------------------- | --------------------------- |
| Double M                         | `double-m.svg`                        | 2 — M, M                    |
| Double M Connected               | `double-m-connected.svg`              | 2, joined                   |
| M Bar M                          | `m-bar-m.svg`                         | 3 — M, bar, M               |
| M Slash M                        | `m-slash-m.svg`                       | 3 — M, slash, M             |
| Double M Rail                    | `double-m-rail.svg`                   | 3 — M, M, rail              |
| Rafter Double M                  | `rafter-double-m.svg`                 | 3 — rafter, M, M            |
| Rocking Double M                 | `rocking-double-m.svg`                | 3 — M, M, rocker            |
| Rocking Double M (cow and calf)  | `rocking-double-m-cow-and-calf.svg`   | 3 — M, M, rocker            |
| Swinging Double M                | `swinging-double-m.svg`               | 3 — half circle, M, M       |
| Flying Double M                  | `flying-double-m.svg`                 | 3 — wings, M, M             |
| Double M Quarter Circle          | `double-m-quarter-circle.svg`         | 3 — M, M, quarter circle    |
| Lazy Double M                    | `lazy-double-m.svg`                   | 2, turned                   |
| Tumbling Double M                | `tumbling-double-m.svg`               | 2, turned                   |

The two Rocking Double M's read identically. They differ in size, not grammar:
one is an even pair, the other is the Rocking Double Star's idea in letters — a
big one and a small one on shared ground.

## What the M costs

Worth saying plainly, because it shaped every drawing here: **M is an expensive
letter and Double M is twice that.** Eight strokes and four acute junctions
before a single modifier is added, where the star mark put two shapes on the
hide. Three consequences:

- **The iron is a point narrower than the logomark's.** At the rocker's width
  the M's counters close and the pair burns as two blots. One width across the
  whole set — a family drawn at several weights is several families.
- **The legs splay and the valley stops short of the baseline.** Both open the
  junctions where a hot iron pools.
- **The calf cannot shrink as far as the star's does.** A star is a solid shape
  and scales freely. An M is a stroked letter and the iron's width does not
  scale with it, so past about two thirds the small M's valley closes up. This
  is why `rocking-double-m-cow-and-calf` has a shallower size difference than
  the logomark it echoes.

Only four of these survive 24px with the reading intact: `double-m`, `m-bar-m`,
`m-slash-m` and `rocking-double-m`. The busier ones — swinging, rafter, flying —
turn to mush, which is a fair proxy for what a wet, winter-haired animal does to
a brand at fifty feet.

## Not drawn, and why

Each of these is grammatical. Each fails on something else.

- **Crazy M** — a crazy letter is upside down, and an upside-down M is a W to
  everyone who looks at it. The grammar allows it; the sale barn would not.
- **Circle Double M** — the enclosure has to hold both letters, so both letters
  get small, and at one iron width the valley closes before the circle is even
  drawn. It also scalds a much larger patch of hide than the letters alone.
- **Walking Double M** — feet on both letters is twelve strokes for a brand that
  already reads at eight.
- **Running Double M** — two running M's side by side read as a lowercase `mm`,
  which is the one reading this brand cannot afford to invite.

## If you want a shortlist

- **M Bar M** — the most conventional and the easiest to read at distance. The
  space either side of the bar is doing the work.
- **Double M Connected** — five strokes instead of eight and narrower on the
  animal. The simplicity rule taken seriously.
- **Rocking Double M** — sibling to the approved logomark. The rocker is what
  stops a wide pair drifting into two marks as it gets smaller.

A mark this wide wants a flat panel. Left rib or left hip, rather than a
shoulder — and left or right is part of the record, not a detail.

## Rules for this folder

- **No colour.** Every mark is stroked in `currentColor`. A brand is a burn: one
  colour, one iron. Colourways are a question for whichever variant survives,
  and answering it thirteen times would be thirteen chances to answer it
  differently.
- **Edit the script, not the SVGs.** These are one M placed many ways. Thirteen
  hand-drawn M's drift the first time the letter is adjusted.

  ```
  python3 tools/generate-double-m-brands.py
  ```

- **Nothing here is exported.** `packages/ui` ships the approved mark only. If
  one of these is chosen it moves there, gets its two colourways, and this
  folder keeps the rejected twelve.

## Not settled

Whether the farm wants a Double M at all. The wordmark still waits on the farm
and business names (issue #26), and §5.1 treats both as `BrandingConfig` values
rather than string literals — so a letter brand is a bet on a name that has not
been made yet. These are drawn so the bet can be looked at, not so it can be
skipped.
