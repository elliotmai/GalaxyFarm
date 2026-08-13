#!/usr/bin/env python3
"""
Double M brand variants, drawn from one M.

An exploration set, not a decision. The approved logomark is still the Rocking
Double Star in `packages/ui/src/brand/` and nothing here touches it. These are
candidates for a *Double M* iron, drawn in the livestock-brand grammar the
Texas & Southwestern Cattle Raisers Association publishes in "How to Design a
Brand" — so the set can be read aloud, recorded, and argued about the way a
brand inspector would.

    python3 tools/generate-double-m-brands.py

A script rather than thirteen hand-drawn files, for the same reason the icons
are a script: the M is one shape placed many ways, and thirteen hand-drawn M's
drift the first time the letter is adjusted. Change `M_SPLAY` here and every
variant follows.

Everything is stroked in `currentColor` at one width. A brand is a burn: one
colour, one iron. Colourways are a question for whichever variant survives, and
asking it thirteen times would be thirteen chances to answer it differently.
"""

import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "brand" / "double-m"

# The iron. One width across the whole set — a family drawn at several weights
# is several families. A point narrower than the rocker in `logomark.tsx`,
# because the star put two shapes on the hide and this puts eight strokes: at
# the logomark's width the M's counters close and the pair reads as two blots.
STROKE = 7

# The M. Splayed legs and a valley stopping just short of half height, both of
# them about the burn rather than the drawing: the splay opens the top
# junctions, where a hot iron pools and blots, and a valley that ran to the
# baseline would close a second pair of angles right below the first.
M_SPLAY = 0.20
M_VALLEY = 0.48


def f(value):
    """SVG numbers, without the trailing `.0` on whole ones."""
    return f"{value:g}"


def m(cx, cy, w, h):
    """A brand M centred on (cx, cy). Bottom left, up, down the valley, up, down."""
    hw, hh = w / 2, h / 2
    return polyline(
        [
            (cx - hw, cy + hh),
            (cx - hw + M_SPLAY * w, cy - hh),
            (cx, cy - hh + M_VALLEY * h),
            (cx + hw - M_SPLAY * w, cy - hh),
            (cx + hw, cy + hh),
        ]
    )


def polyline(points):
    (x0, y0), rest = points[0], points[1:]
    return f"M{f(x0)} {f(y0)} " + " ".join(f"L{f(x)} {f(y)}" for x, y in rest)


def curve(start, control, end):
    return f"M{f(start[0])} {f(start[1])} Q{f(control[0])} {f(control[1])} {f(end[0])} {f(end[1])}"


def path(d):
    return f'<path d="{d}"/>'


def turned(degrees, cx, cy, *paths):
    """A group rotated in place — lazy and tumbling letters."""
    inner = "".join(path(d) for d in paths)
    return f'<g transform="rotate({f(degrees)} {f(cx)} {f(cy)})">{inner}</g>'


# --- The variants ----------------------------------------------------------
#
# Each name is the brand's *reading*, not a label: brands are read left to
# right, top to bottom, outside in, so a bar above the letters is named before
# them and a curve below them is named after. Two of the same letter side by
# side are read "Double M" — the association's own sample sheet reads HH as
# DOUBLE H rather than H H.

VARIANTS = [
    {
        "slug": "double-m",
        "name": "Double M",
        "family": "The pair alone",
        "units": "2 units · M · M",
        "note": (
            "The reference. Nothing modifies it, which is its argument: eight strokes is "
            "already a lot of iron, and every variant below spends more."
        ),
        "elements": [path(m(27, 50, 30, 40)), path(m(73, 50, 30, 40))],
    },
    {
        "slug": "double-m-connected",
        "name": "Double M Connected",
        "family": "The pair alone",
        "units": "2 units, joined · M M connected",
        "shortlist": True,
        "note": (
            "The M's share a leg, so the pair is one figure instead of two — five strokes "
            "rather than eight, and narrower on the animal. The shared leg has to stand "
            "straight up: the right leg of a splayed M leans the opposite way to the left "
            "leg of the next one, so a splayed pair cannot merge."
        ),
        "elements": [
            path(
                polyline(
                    [(25, 70), (30, 30), (40, 49), (50, 30), (60, 49), (70, 30), (75, 70)]
                )
            ),
            path(polyline([(50, 30), (50, 70)])),
        ],
    },
    {
        "slug": "m-bar-m",
        "name": "M Bar M",
        "family": "The pair with a line",
        "units": "3 units · M · bar · M",
        "shortlist": True,
        "note": (
            "A bar is a short line; it separates the letters as well as joining them, and "
            "the space either side is what makes this the easiest of the set to read at a "
            "distance or through winter hair."
        ),
        "elements": [
            path(m(20, 50, 24, 32)),
            path(polyline([(46, 50), (54, 50)])),
            path(m(80, 50, 24, 32)),
        ],
    },
    {
        "slug": "m-slash-m",
        "name": "M Slash M",
        "family": "The pair with a line",
        "units": "3 units · M · slash · M",
        "note": (
            "A diagonal line is read as a slash. It does the same separating work as the "
            "bar and is harder to alter afterwards, since there is no horizontal to extend."
        ),
        "elements": [
            path(m(20, 50, 24, 32)),
            path(polyline([(56, 34), (44, 66)])),
            path(m(80, 50, 24, 32)),
        ],
    },
    {
        "slug": "double-m-rail",
        "name": "Double M Rail",
        "family": "The pair with a line",
        "units": "3 units · M · M · rail",
        "note": (
            "A rail is about twice a bar, and letters rest above it. Read top to bottom, "
            "the letters come first and the rail is named last. It stays a hair clear of "
            "them on purpose: legs fused into a rail close a row of small triangles, and "
            "small closed shapes are where a burn pools."
        ),
        "elements": [
            path(m(27, 46, 30, 38)),
            path(m(73, 46, 30, 38)),
            path(polyline([(10, 75), (90, 75)])),
        ],
    },
    {
        "slug": "rafter-double-m",
        "name": "Rafter Double M",
        "family": "The pair with a line",
        "units": "3 units · rafter · M · M",
        "note": (
            "The rafter is above the letters, so it is read first. It gives the pair a roof "
            "wide enough to hold them together, which the bar cannot do from between them."
        ),
        "elements": [
            path(m(27, 64, 28, 32)),
            path(m(73, 64, 28, 32)),
            path(polyline([(10, 34), (50, 14), (90, 34)])),
        ],
    },
    {
        "slug": "rocking-double-m",
        "name": "Rocking Double M",
        "family": "The pair with a curve",
        "units": "3 units · M · M · rocker",
        "shortlist": True,
        "note": (
            "A curved mark at the bottom is read as rocking. The house mark is a Rocking "
            "Double Star and this is its sibling: the rocker is what stops a wide pair "
            "drifting into two marks as it gets smaller."
        ),
        "elements": [
            path(m(27, 44, 30, 38)),
            path(m(73, 44, 30, 38)),
            path(curve((12, 70), (50, 92), (88, 70))),
        ],
    },
    {
        "slug": "rocking-double-m-cow-and-calf",
        "name": "Rocking Double M",
        "qualifier": "cow and calf",
        "family": "The pair with a curve",
        "units": "3 units · M · M · rocker",
        "note": (
            "The same reading as the one before it — the difference is size, not grammar. "
            "It is the Rocking Double Star's idea in letters: a big one and a small one on "
            "shared ground. The calf cannot shrink as far as the star's does. A star is a "
            "solid shape and scales freely; an M is a stroked letter, and the iron's width "
            "does not scale with it, so past about two thirds the valley closes up and the "
            "small M burns as a blot."
        ),
        "elements": [
            path(m(32, 42, 32, 42)),
            path(m(74, 56, 22, 28)),
            path(curve((12, 76), (50, 96), (88, 76))),
        ],
    },
    {
        "slug": "swinging-double-m",
        "name": "Swinging Double M",
        "family": "The pair with a curve",
        "units": "3 units · half circle · M · M",
        "note": (
            "A half circle attached to the top is read as swinging. It hangs the pair "
            "rather than standing it up, and it is named first because it is above."
        ),
        "elements": [
            path(m(27, 58, 30, 36)),
            path(m(73, 58, 30, 36)),
            path(curve((18, 40), (50, 10), (82, 40))),
        ],
    },
    {
        "slug": "flying-double-m",
        "name": "Flying Double M",
        "family": "The pair with a curve",
        "units": "3 units · wings · M · M",
        "note": (
            "Wings on the outside tops, so the pair flies rather than each letter flying "
            "separately. The lightest way to modify the pair — two short strokes, and they "
            "sit clear of everything else."
        ),
        "elements": [
            path(m(27, 54, 30, 36)),
            path(m(73, 54, 30, 36)),
            path(curve((18, 36), (10, 22), (4, 28))),
            path(curve((82, 36), (90, 22), (96, 28))),
        ],
    },
    {
        "slug": "double-m-quarter-circle",
        "name": "Double M Quarter Circle",
        "family": "The pair with a curve",
        "units": "3 units · M · M · quarter circle",
        "note": (
            "Set beside the rocking pair on purpose. The curve is the same idea and the "
            "reading is different, because this one is not attached: letters above a "
            "quarter circle are read letter-then-curve, and a curve touching the letters "
            "is read as rocking."
        ),
        "elements": [
            path(m(27, 42, 30, 36)),
            path(m(73, 42, 30, 36)),
            path(curve((30, 76), (50, 86), (70, 76))),
        ],
    },
    {
        "slug": "lazy-double-m",
        "name": "Lazy Double M",
        "family": "The pair turned",
        "units": "2 units, turned · lazy M · lazy M",
        "note": (
            "A lazy letter lies on its side. Turning both frees the pair to stack, which "
            "suits a narrow panel — and the record has to say which way they lie, since "
            "face-up and face-down are two different brands. They need real air between "
            "them: set any closer, two lazy M's run together into one long zigzag."
        ),
        "elements": [
            turned(-90, 50, 26, m(50, 26, 28, 30)),
            turned(-90, 50, 74, m(50, 74, 28, 30)),
        ],
    },
    {
        "slug": "tumbling-double-m",
        "name": "Tumbling Double M",
        "family": "The pair turned",
        "units": "2 units, turned · M · M",
        "note": (
            "Tilted, short of lying down. It reads as movement and it is the cheapest way "
            "to make a Double M that nobody else holds, but the tilt has to be recorded "
            "exactly or it is just a crooked Double M."
        ),
        "elements": [
            turned(35, 25, 50, m(25, 50, 24, 30)),
            turned(35, 75, 50, m(75, 50, 24, 30)),
        ],
    },
]

# Drawn nowhere, on purpose. Kept here rather than in prose alone so the reasons
# travel with the set — every one of them is a thing somebody will suggest.
REJECTED = [
    (
        "Crazy M",
        "A crazy letter is upside down, and an upside-down M is a W to everyone who "
        "looks at it. The grammar allows it; the sale barn would not.",
    ),
    (
        "Circle Double M",
        "An enclosure has to hold both letters, so both letters get small, and at one "
        "iron width the M's valley closes before the circle is even drawn. It also "
        "scalds a far bigger patch of hide than the letters alone.",
    ),
    (
        "Walking Double M",
        "Feet on both letters is twelve strokes for a brand that already reads at eight. "
        "Walking suits a letter standing alone, which is not what this is.",
    ),
    (
        "Running Double M",
        "Curves are fine on their own, but two running M's beside each other read as a "
        "lowercase mm — which is the one reading this brand cannot afford to invite.",
    ),
]


def svg_body(variant):
    elements = "".join(variant["elements"])
    return (
        f'<g fill="none" stroke="currentColor" stroke-width="{STROKE}" '
        f'stroke-linecap="round" stroke-linejoin="round">{elements}</g>'
    )


def svg_file(variant):
    label = variant["name"]
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" '
        f'aria-label="{label}">\n'
        f"  <title>{label}</title>\n"
        f"  {svg_body(variant)}\n"
        "</svg>\n"
    )


def inline_svg(variant, pixels, decorative):
    attrs = (
        ' aria-hidden="true"'
        if decorative
        else f' role="img" aria-label="{variant["name"]}"'
    )
    return (
        f'<svg viewBox="0 0 100 100" width="{pixels}" height="{pixels}"{attrs}>'
        f"{svg_body(variant)}</svg>"
    )


STYLE = """
/* Colours are the locked Bluebonnet Linen / Midnight Nebula palette from
   packages/config/tailwind.preset.ts. The marks take the ink: a burn is one
   colour, so the identity purple is spent on the page, not on the brands. */
:root {
  --canvas: #F8F5EC; --panel: #FFFFFF; --raised: #F1EEE4;
  --ink: #24243A; --muted: #565669; --rule: #888897;
  --identity: #5F45B0;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --canvas: #0E1026; --panel: #191C3C; --raised: #242A52;
    --ink: #F2EFE6; --muted: #B4B2C8; --rule: #7C80A6;
    --identity: #9D85E8;
  }
}
:root[data-theme="dark"] {
  --canvas: #0E1026; --panel: #191C3C; --raised: #242A52;
  --ink: #F2EFE6; --muted: #B4B2C8; --rule: #7C80A6;
  --identity: #9D85E8;
}

* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--canvas);
  color: var(--ink);
  font-family: Inter, system-ui, sans-serif;
  font-size: 16px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
.sheet { max-width: 1120px; margin: 0 auto; padding: 56px 24px 96px; }

h1, h2, h3 { font-family: "Zilla Slab", Georgia, serif; font-weight: 600; text-wrap: balance; margin: 0; }
h1 { font-size: 44px; line-height: 1.1; letter-spacing: -0.01em; }
h2 { font-size: 22px; }
h3 { font-size: 19px; }
p { margin: 0; }

.eyebrow {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--identity);
}
.masthead { display: flex; flex-direction: column; gap: 14px; }
.lead { max-width: 62ch; color: var(--muted); font-size: 17px; }
.lead strong { color: var(--ink); font-weight: 600; }

/* The three reading rules, which are the whole grammar in one strip. */
.rules {
  display: flex; flex-wrap: wrap; gap: 0;
  margin-top: 34px; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule);
}
.rule { flex: 1 1 200px; padding: 16px 20px 16px 0; }
.rule + .rule { padding-left: 20px; border-left: 1px solid color-mix(in srgb, var(--rule) 45%, transparent); }
.rule dt {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted);
}
.rule dd { margin: 4px 0 0; font-size: 15px; }

section { margin-top: 56px; }
.section-head { display: flex; flex-direction: column; gap: 4px; margin-bottom: 22px; }
.section-head p { color: var(--muted); font-size: 15px; max-width: 62ch; }

.plates { display: grid; grid-template-columns: repeat(auto-fill, minmax(272px, 1fr)); gap: 20px; }
.plate {
  margin: 0; display: flex; flex-direction: column;
  background: var(--panel); border: 1px solid color-mix(in srgb, var(--rule) 40%, transparent);
  border-radius: 6px; overflow: hidden;
}
.plate.pick { border-color: var(--identity); }

.mark {
  display: flex; align-items: center; justify-content: center;
  padding: 26px 20px 20px; background: var(--raised); color: var(--ink);
}
/* Grows so the small-size proof sits on the foot of every plate, level across
   a row, however long the note runs. */
.plate figcaption { flex: 1; display: flex; flex-direction: column; gap: 8px; padding: 18px 20px 20px; }
.name { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.qualifier { font-size: 14px; color: var(--muted); font-family: "Zilla Slab", Georgia, serif; }
.pick-flag {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--identity); border: 1px solid var(--identity);
  border-radius: 3px; padding: 1px 6px; white-space: nowrap;
}
.units {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums;
}
.note { font-size: 14.5px; color: var(--muted); }

/* The only test that matters for a mark this busy: does it survive small. */
.proof {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 20px; border-top: 1px solid color-mix(in srgb, var(--rule) 30%, transparent);
  color: var(--ink);
}
.proof span {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted);
}

.rejected { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 0 32px; }
.rejected div { padding: 16px 0; border-top: 1px solid color-mix(in srgb, var(--rule) 40%, transparent); }
.rejected h3 { font-size: 16px; text-decoration: line-through; text-decoration-color: var(--rule); }
.rejected p { color: var(--muted); font-size: 14.5px; margin-top: 4px; }

footer {
  margin-top: 64px; padding-top: 20px; border-top: 1px solid var(--rule);
  color: var(--muted); font-size: 14px; display: flex; flex-direction: column; gap: 6px;
}
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px; color: var(--ink);
}
@media (max-width: 640px) {
  .sheet { padding: 36px 18px 72px; }
  h1 { font-size: 34px; }
  .rule + .rule { border-left: 0; padding-left: 0; }
}
"""

FAMILY_BLURBS = {
    "The pair alone": "Two units, nothing added. Where a brand should start and, for a two-letter brand, often end.",
    "The pair with a line": "A third unit from the line-and-circle set. Lines separate the letters, roof them, or stand them up.",
    "The pair with a curve": "The same third-unit move, drawn as a curve. Where the curve sits — and whether it touches — changes the reading.",
    "The pair turned": "The letters themselves modified. Cheap to draw, and the position has to be recorded exactly.",
}


def plate(variant):
    qualifier = (
        f'<span class="qualifier">{variant["qualifier"]}</span>'
        if variant.get("qualifier")
        else ""
    )
    flag = '<span class="pick-flag">shortlist</span>' if variant.get("shortlist") else ""
    return f"""      <figure class="plate{' pick' if variant.get('shortlist') else ''}">
        <div class="mark">{inline_svg(variant, 148, decorative=False)}</div>
        <figcaption>
          <div class="name"><h3>{variant["name"]}</h3>{qualifier}{flag}</div>
          <p class="units">{variant["units"]}</p>
          <p class="note">{variant["note"]}</p>
        </figcaption>
        <div class="proof"><span>at 24px</span>{inline_svg(variant, 24, decorative=True)}</div>
      </figure>"""


def body():
    sections = []
    for family, blurb in FAMILY_BLURBS.items():
        plates = "\n".join(plate(v) for v in VARIANTS if v["family"] == family)
        sections.append(
            f"""    <section>
      <div class="section-head">
        <h2>{family}</h2>
        <p>{blurb}</p>
      </div>
      <div class="plates">
{plates}
      </div>
    </section>"""
        )

    rejected = "\n".join(
        f"        <div><h3>{name}</h3><p>{why}</p></div>" for name, why in REJECTED
    )

    return f"""  <div class="sheet">
    <header class="masthead">
      <p class="eyebrow">Brand exploration · not a decision</p>
      <h1>Double M</h1>
      <p class="lead">Thirteen ways to draw a <strong>Double M</strong> iron, in the grammar the
        Texas &amp; Southwestern Cattle Raisers Association publishes. Each name below is the
        brand's <strong>reading</strong> — what it is called out as, recorded as, and argued over.
        The approved farm logomark is still the Rocking Double Star; nothing here replaces it.</p>
      <dl class="rules">
        <div class="rule"><dt>Read</dt><dd>Left to right, top to bottom, outside in.</dd></div>
        <div class="rule"><dt>Keep it to</dt><dd>Two or three units. Few brands have more.</dd></div>
        <div class="rule"><dt>Simple, because</dt><dd>A simple brand reads easier and hurts the animal less.</dd></div>
      </dl>
    </header>

{chr(10).join(sections)}

    <section>
      <div class="section-head">
        <h2>Not drawn, and why</h2>
        <p>Every one of these is grammatical. Each fails on something other than grammar.</p>
      </div>
      <div class="rejected">
{rejected}
      </div>
    </section>

    <footer>
      <p>Grammar from <em>How to Design a Brand</em>, Texas &amp; Southwestern Cattle Raisers
        Association. Judgements about iron width, blotting and hide are ours.</p>
      <p>Drawn by <code>tools/generate-double-m-brands.py</code>. Edit the script, not the SVGs.</p>
    </footer>
  </div>
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--fragment",
        type=Path,
        help=(
            "Also write the sheet without the page skeleton, for publishing somewhere "
            "that supplies its own <head>."
        ),
    )
    args = parser.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    for variant in VARIANTS:
        (OUT / f"{variant['slug']}.svg").write_text(svg_file(variant), encoding="utf-8")

    sheet = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Double M</title>
<style>{STYLE}</style>
</head>
<body>
{body()}</body>
</html>
"""
    (OUT / "contact-sheet.html").write_text(sheet, encoding="utf-8")

    if args.fragment:
        args.fragment.write_text(
            f"<title>Double M</title>\n<style>{STYLE}</style>\n{body()}", encoding="utf-8"
        )

    print(f"{len(VARIANTS)} variants + contact sheet -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
