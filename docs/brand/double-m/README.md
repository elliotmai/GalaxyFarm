# Double M

Five **Double M** irons, drawn to the grammar in _How to Design a Brand_ (Texas
& Southwestern Cattle Raisers Association), shown at every size they have to
survive and on the eight things they would actually go on.

An exploration, not a decision. The approved logomark is still the Rocking
Double Star in `packages/ui/src/brand/`, and nothing here touches it.

Open `contact-sheet.html` for the whole set — the marks, the size ladder, and
the mockups with a switcher that puts any of the four onto all eight surfaces.

## The five

| Reading            | File                       | Units | Strokes | At 16px                              |
| ------------------ | -------------------------- | ----- | ------- | ------------------------------------ |
| Double M Connected | `double-m-connected.svg`   | 2     | 7       | Holds. Reads as one mark.            |
| M Bar M            | `m-bar-m.svg`              | 3     | 9       | Best of the four. Nothing touches.   |
| Rocking Double M   | `rocking-double-m.svg`     | 3     | 9       | Holds. The rocker keeps it together. |
| Flying Double M    | `flying-double-m.svg`      | 3     | 10      | Crest blurs into the corners.        |
| Flying Double M Connected | `flying-double-m-connected.svg` | 4 | 9   | Crests close up. Reads as Connected. |

Each name is the brand's **reading** — what it would be called out as and
recorded as, not a label. Brands are read left to right, top to bottom, outside
in, so a bar between the letters is named between them and a curve below them is
named after. Two of the same letter side by side are read "Double M": the
association's own sample sheet reads `HH` as DOUBLE H.

Strokes are counted from the path data rather than estimated — one per segment
the iron has to draw. A plain pair of M's is eight before anything is added.

## Two things that changed under examination

**Double M Connected saves one stroke, not three.** Sharing a leg removes a leg
and nothing else: eight becomes seven. The reason to want it is that it is about
a third narrower on the animal and reads as one mark rather than two things
standing near each other.

**Flying Double M's wings are a crest.** Drawn rising steeply they set off almost
the way the outer leg is already going, the two read as one swoosh, and the M
loses a stroke. Turning the wing outward into a crest that hooks back keeps the
letter whole. The crest is the first thing to blur, which makes it the weakest of
the set under about 24px.

**Flying Double M Connected is the late addition.** The crest on the connected
pair, which works better than it should because the pair is narrow enough to
leave room either side. It costs Connected the thing Connected was winning on:
two units become four, seven strokes become nine. Strongest of the set above
about 48px and the softest below it.

## What the M costs

Worth saying plainly, because it shaped every drawing here: **M is an expensive
letter and Double M is twice that.** Eight strokes and four acute junctions
before a single modifier, where the star mark put two shapes on the hide.

- **The iron is a point narrower than the logomark's.** At the rocker's width
  the M's counters close and the pair burns as two blots. One width across the
  whole set — a family drawn at several weights is several families.
- **The legs splay and the valley stops short of the baseline.** Both open the
  junctions where a hot iron pools.
- **Where a mark stops working is the decision**, and it is not the same size
  for all four. That is what the size ladder in the contact sheet is for.

## The mockups

Eight applications: ranch truck, tractor hood, ranch gate, a black Maine-Anjou,
gooseneck stock trailer, show box, house front door, letterhead. Each carries a
real size — a 4-inch iron on the rib, 36 inches of cut steel on the gate, 0.9
inches on paper — because a mark that works on a gate is not automatically a
mark that works on a letterhead.

**They are drawings, not photographs.** They are built to hold the one thing a
photograph would be used to check: the mark at its real size, against the real
material, on the surface it goes on. Colour comes from the application — cream
paint, cut steel, printer's ink, a healed scar on black hide — and never from
the mark, which is `currentColor` throughout.

## Cut from the set

Nine were drawn and set down. The drawings are in the history; the reasons are
the part worth keeping, because each is a thing somebody will suggest again.

- **Double M** — the reference. Connected says the same thing narrower.
- **M Slash M** — the bar's job without the bar's clarity.
- **Double M Rail** — a great deal of iron for a separator a bar does in a
  quarter of the length.
- **Rafter Double M** — roof and letters merge as soon as it gets small.
- **Rocking Double M (cow and calf)** — the calf cannot shrink far enough for
  the size difference to read. A star is a solid shape and scales freely; an M
  is a stroked letter and the iron's width does not scale down with it.
- **Swinging Double M** — the dome closes a row of small counters against the
  letter tops.
- **Double M Quarter Circle** — the rocker's idea with the attachment removed,
  which was the part earning its place.
- **Lazy Double M** — two lazy M's chain into one long zigzag.
- **Tumbling Double M** — reads as italic rather than tumbled.

## Never drawn

Each is grammatical. Each fails on something else.

- **Crazy M** — an upside-down M is a W to everyone who looks at it. The grammar
  allows it; the sale barn would not.
- **Circle Double M** — the enclosure forces both letters small, and at one iron
  width the valley closes before the circle is even drawn.
- **Walking Double M** — twelve strokes for a brand that already reads at eight.
- **Running Double M** — two running M's read as a lowercase `mm`.

## Rules for this folder

- **No colour in the marks.** Every one is stroked in `currentColor`. A brand is
  a burn: one colour, one iron. Colourways are a question for whichever variant
  wins, and answering it five times would be five chances to answer it
  differently.
- **Edit the script, not the SVGs.** These are one M placed five ways, and the
  mockups are drawn from the same geometry.

  ```
  python3 tools/generate-double-m-brands.py
  ```

- **Nothing here is exported.** `packages/ui` ships the approved mark only. If
  one of these is chosen it moves there and gets its two colourways.

## Where it would go on the animal

A mark this wide wants a flat panel: **left rib** or left hip, rather than a
shoulder. Left or right is part of the record, not a detail — the brand and its
position are registered together.

## Not settled

Whether the farm wants a Double M at all. The wordmark still waits on the farm
and business names (issue #26), and §5.1 treats both as `BrandingConfig` values
rather than string literals — so a letter brand is a bet on a name that has not
been made yet. These are drawn so the bet can be looked at, not so it can be
skipped.
