#!/usr/bin/env python3
"""
The four Double M brands still in the running — drawn, sized, and put in use.

Narrowed from the thirteen in an earlier commit. The nine that were cut and the
four that were never drawn are listed below with their reasons, because the
reasons are the part worth keeping; the drawings are in the history.

An exploration, not a decision. The approved logomark is still the Rocking
Double Star in `packages/ui/src/brand/` and nothing here touches it.

    python3 tools/generate-double-m-brands.py

A script rather than hand-drawn files, for the same reason the icons are a
script: the M is one shape placed four ways, and hand-drawn copies drift the
first time the letter is adjusted. Change `M_SPLAY` here and everything follows,
including the eight application mockups.

The mockups are drawings, not photographs. They are built to hold the one thing
a photograph would be used to check — the mark at its real size against a real
material, on the surface it would actually go on.

Everything is stroked in `currentColor` at one width. A brand is a burn: one
colour, one iron. Each mockup sets the colour the application would give it —
cream paint, cut steel, printer's ink, scar tissue — and the mark itself never
carries one.
"""

import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "brand" / "double-m"

# The iron. One width across the set — a family drawn at several weights is
# several families. A point narrower than the rocker in `logomark.tsx`, because
# the star put two shapes on the hide and this puts eight strokes: at the
# logomark's width the M's counters close and the pair reads as two blots.
STROKE = 7

# The M. Splayed legs and a valley stopping just short of half height, both of
# them about the burn rather than the drawing: the splay opens the top
# junctions, where a hot iron pools and blots, and a valley that ran to the
# baseline would close a second pair of angles right below the first.
M_SPLAY = 0.20
M_VALLEY = 0.48


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------


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


def strokes(paths):
    """How many strokes the iron is. Counted, not claimed — one per drawn segment."""
    return sum(d.count("L") + d.count("Q") for d in paths)


def _tokens(d):
    out, number = [], ""
    for char in d.replace(",", " "):
        if char in "MLQ":
            if number:
                out.append(float(number))
                number = ""
            out.append(char)
        elif char == " ":
            if number:
                out.append(float(number))
                number = ""
        else:
            number += char
    if number:
        out.append(float(number))
    return out


def bounds(variant):
    """
    Exact bounding box, stroke included.

    Exact rather than the hull of the control points, because the rocker's
    control sits 11 units below the curve ever goes, and a mark placed by a
    bounding box that lies sits visibly high on everything it is placed on.
    """
    xs, ys = [], []

    def extremum(p0, p1, p2):
        """Where a quadratic turns back, if it turns back inside the segment."""
        denominator = p0 - 2 * p1 + p2
        if denominator == 0:
            return []
        t = (p0 - p1) / denominator
        if not 0 < t < 1:
            return []
        return [(1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t**2 * p2]

    for d in variant["paths"]:
        tokens, index, cursor = _tokens(d), 0, (0.0, 0.0)
        while index < len(tokens):
            command = tokens[index]
            if command in ("M", "L"):
                point = (tokens[index + 1], tokens[index + 2])
                xs.append(point[0])
                ys.append(point[1])
                cursor, index = point, index + 3
            else:  # Q
                control = (tokens[index + 1], tokens[index + 2])
                end = (tokens[index + 3], tokens[index + 4])
                xs += [end[0]] + extremum(cursor[0], control[0], end[0])
                ys += [end[1]] + extremum(cursor[1], control[1], end[1])
                cursor, index = end, index + 5

    half = STROKE / 2
    return min(xs) - half, min(ys) - half, max(xs) + half, max(ys) + half


# ---------------------------------------------------------------------------
# The four
# ---------------------------------------------------------------------------
#
# Each name is the brand's *reading*, not a label: brands are read left to
# right, top to bottom, outside in, so a bar between the letters is named
# between them and a curve below them is named after. Two of the same letter
# side by side are read "Double M" — the association's own sample sheet reads
# HH as DOUBLE H rather than H H.

VARIANTS = [
    {
        "slug": "double-m-connected",
        "name": "Double M Connected",
        "units": "2 units",
        "character": "One figure. The narrowest of the four.",
        "note": (
            "The M's share a leg, so the pair is one mark rather than two things standing "
            "near each other — and it is about a third narrower on the animal, which is "
            "the real saving here. It is one stroke fewer than the plain pair, not three: "
            "sharing a leg removes a leg, and nothing else."
        ),
        "watch": (
            "The shared leg has to stand straight up. The right leg of a splayed M leans "
            "the opposite way to the left leg of the next one, so a splayed pair cannot "
            "merge — and that leg meets three strokes at the top, which is the first place "
            "a hot iron will pool. The junction to check on a test burn."
        ),
        "paths": [
            polyline([(25, 70), (30, 30), (40, 49), (50, 30), (60, 49), (70, 30), (75, 70)]),
            polyline([(50, 30), (50, 70)]),
        ],
    },
    {
        "slug": "m-bar-m",
        "name": "M Bar M",
        "units": "3 units · M, bar, M",
        "character": "The conventional one. Clearest at distance.",
        "note": (
            "A bar is a short line, and here it separates the letters as much as it joins "
            "them. The space either side is what does the work: this is the one variant "
            "that still reads at 16px with nothing running together, which is a fair proxy "
            "for a wet, winter-haired animal at fifty feet."
        ),
        "watch": (
            "A bar is the easiest unit in the set to alter afterwards — it can be run out "
            "into a rail, or joined to a letter. Worth knowing before it goes on record."
        ),
        "paths": [
            m(20, 50, 24, 32),
            polyline([(46, 50), (54, 50)]),
            m(80, 50, 24, 32),
        ],
    },
    {
        "slug": "rocking-double-m",
        "name": "Rocking Double M",
        "units": "3 units · M, M, rocker",
        "character": "Sibling to the approved logomark.",
        "note": (
            "A curved mark attached at the bottom is read as rocking. The house mark is a "
            "Rocking Double Star and this is the same sentence in letters: the rocker is "
            "what stops a wide pair drifting apart into two marks as it gets smaller, "
            "which is exactly the job it already does for the stars."
        ),
        "watch": (
            "The rocker meets both outer legs. Those two junctions are where the burn will "
            "pool if the iron is held a beat too long — the same trade the star mark makes, "
            "and it has been fine there."
        ),
        "paths": [
            m(27, 44, 30, 38),
            m(73, 44, 30, 38),
            curve((12, 70), (50, 92), (88, 70)),
        ],
    },
    {
        "slug": "flying-double-m",
        "name": "Flying Double M",
        "units": "3 units · wings, M, M",
        "character": "The most decorated. Wings, not a frame.",
        "note": (
            "Wings on the outside tops, so the pair flies rather than each letter flying "
            "separately — two units of decoration for the price of one. Nothing crosses the "
            "gap between the letters, which is what keeps a mark this busy readable."
        ),
        "watch": (
            "Redrawn since the survey. The wings used to sweep out sideways and hook down, "
            "and at 24px they fused with the letters' top corners into a blot. These are "
            "shorter and rise steeply, so the wing mass sits above the pair instead of "
            "beside it. It is still the busiest of the four at ten strokes."
        ),
        "paths": [
            m(27, 58, 28, 34),
            m(73, 58, 28, 34),
            curve((18.6, 41), (11, 33), (7, 23)),
            curve((81.4, 41), (89, 33), (93, 23)),
        ],
    },
]

# Drawn, then cut. Kept by name and reason rather than by drawing — the drawings
# are in the history, and the reasons are what stop them being re-proposed.
CUT = [
    ("Double M", "The reference. Connected says the same thing narrower."),
    ("M Slash M", "Does the bar's job without the bar's clarity. A near-duplicate of a better one."),
    ("Double M Rail", "A rail is a great deal of iron for a separator a bar does in a quarter of the length."),
    ("Rafter Double M", "The roof and the letters merge into one shape as soon as it gets small."),
    (
        "Rocking Double M (cow and calf)",
        "The calf cannot shrink far enough for the size difference to read — an M is a "
        "stroked letter and the iron's width does not scale down with it.",
    ),
    ("Swinging Double M", "The dome closes a row of small counters against the letter tops."),
    (
        "Double M Quarter Circle",
        "The rocker's idea with the attachment removed, which is the part that was earning "
        "its place.",
    ),
    ("Lazy Double M", "Two lazy M's chain into one long zigzag unless given so much air the mark goes tall."),
    ("Tumbling Double M", "Reads as italic rather than tumbled, and the tilt has to be recorded exactly."),
]

# Never drawn. Each is grammatical; each fails on something else.
NEVER_DRAWN = [
    (
        "Crazy M",
        "A crazy letter is upside down, and an upside-down M is a W to everyone who looks "
        "at it. The grammar allows it; the sale barn would not.",
    ),
    (
        "Circle Double M",
        "An enclosure has to hold both letters, so both letters get small, and at one iron "
        "width the M's valley closes before the circle is even drawn.",
    ),
    (
        "Walking Double M",
        "Feet on both letters is twelve strokes for a brand that already reads at eight.",
    ),
    (
        "Running Double M",
        "Two running M's beside each other read as a lowercase mm — the one reading this "
        "brand cannot afford to invite.",
    ),
]

# What each one is like at 16px, from looking at it rather than from hoping.
SMALL_SIZE = {
    "double-m-connected": "Holds. Reads as one mark.",
    "m-bar-m": "Best of the four. Nothing touches.",
    "rocking-double-m": "Holds. The rocker keeps the pair together.",
    "flying-double-m": "Wings soften. Legible, not crisp.",
}

LADDER = [16, 24, 32, 48, 72, 120, 200]

# Widths for `--export`. Cropped to the mark's own bounds rather than padded out
# to a square, so "256" means the mark is 256 across — which is what somebody
# placing it on a photograph is actually asking for. It also means the four have
# different heights at the same size, because they are different shapes.
EXPORT_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
EXPORT_INKS = {"black": "#000000", "white": "#FFFFFF"}
EXPORT_PAD = 0.5


def mark_group(variant):
    elements = "".join(f'<path d="{d}"/>' for d in variant["paths"])
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
        f"  {mark_group(variant)}\n"
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
        f"{mark_group(variant)}</svg>"
    )


def applied(cx, cy, width=None, height=None, extra=""):
    """
    All four marks placed at one spot in a mockup, sized to the same width.

    Sized rather than scaled uniformly, because a real iron or decal is cut to
    fit the space it goes in: showing Connected smaller than M Bar M — which is
    what one shared scale would do, since it is drawn narrower — would compare
    them on something no sign shop would ever do.
    """
    groups = []
    for variant in VARIANTS:
        x0, y0, x1, y1 = bounds(variant)
        scale = width / (x1 - x0) if width else height / (y1 - y0)
        transform = (
            f"translate({f(cx)} {f(cy)}) {extra} scale({f(scale)}) "
            f"translate({f(-(x0 + x1) / 2)} {f(-(y0 + y1) / 2)})"
        )
        groups.append(
            f'<g class="brand brand--{variant["slug"]}" transform="{transform}">'
            f"{mark_group(variant)}</g>"
        )
    return "".join(groups)


# ---------------------------------------------------------------------------
# In use — eight applications, drawn at 480x340
# ---------------------------------------------------------------------------


def grain(name, base_frequency, seed, rgb, alpha):
    """A turbulence fill, for wood, stone, hide and paper."""
    red, green, blue = rgb
    return (
        f'<filter id="{name}" x="0" y="0" width="100%" height="100%">'
        f'<feTurbulence type="fractalNoise" baseFrequency="{base_frequency}" '
        f'numOctaves="4" seed="{seed}"/>'
        f'<feColorMatrix type="matrix" values="0 0 0 0 {red} 0 0 0 0 {green} '
        f'0 0 0 0 {blue} 0 0 0 {alpha} 0"/></filter>'
    )


def truck():
    return f"""<defs>
  <linearGradient id="tk-paint" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#41604C"/><stop offset="0.34" stop-color="#2D4737"/>
    <stop offset="0.46" stop-color="#3A5744"/><stop offset="1" stop-color="#16241B"/>
  </linearGradient>
  <linearGradient id="tk-glass" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#33455A"/><stop offset="0.55" stop-color="#121922"/>
    <stop offset="1" stop-color="#2B3947"/>
  </linearGradient>
  <linearGradient id="tk-chrome" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#EDEEF0"/><stop offset="0.5" stop-color="#8F959B"/>
    <stop offset="1" stop-color="#D8DBDF"/>
  </linearGradient>
  {grain("tk-dust", "0.85", 3, (0.78, 0.71, 0.56), 0.16)}
</defs>
<rect width="480" height="340" fill="url(#tk-paint)"/>
<path d="M0 104 L480 66 L480 104 L0 142 Z" fill="#FFFFFF" opacity="0.06"/>
<path d="M56 0 H424 a12 12 0 0 1 12 12 V104 H56 Z" fill="url(#tk-glass)"/>
<path d="M70 104 L186 4 L252 4 L114 104 Z" fill="#FFFFFF" opacity="0.06"/>
<path d="M56 0 H424 a12 12 0 0 1 12 12 V104 H56" fill="none" stroke="url(#tk-chrome)" stroke-width="6"/>
<path d="M0 152 H480" stroke="#0D1711" stroke-width="4" opacity="0.5"/>
<path d="M0 147 H480" stroke="#9FBAA9" stroke-width="2" opacity="0.22"/>
<path d="M458 104 V340" stroke="#0D1711" stroke-width="4" opacity="0.45"/>
<rect x="330" y="120" width="88" height="21" rx="10" fill="url(#tk-chrome)"/>
<rect x="337" y="126" width="62" height="8" rx="4" fill="#565D64" opacity="0.55"/>
<g color="#F0EADB">{applied(196, 238, width=196)}</g>
<rect y="286" width="480" height="54" filter="url(#tk-dust)"/>"""


def tractor():
    lugs = "".join(
        f'<rect x="-11" y="-78" width="22" height="26" rx="5" fill="#33343A" '
        f'transform="rotate({angle} 0 0)"/>'
        for angle in range(0, 360, 24)
    )
    return f"""<defs>
  <linearGradient id="tc-sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#A8C2D6"/><stop offset="1" stop-color="#E6E3D0"/>
  </linearGradient>
  <linearGradient id="tc-ground" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#8E9A66"/><stop offset="1" stop-color="#5F6942"/>
  </linearGradient>
  <linearGradient id="tc-body" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#C05238"/><stop offset="0.45" stop-color="#98341F"/>
    <stop offset="1" stop-color="#631F12"/>
  </linearGradient>
</defs>
<rect width="480" height="340" fill="url(#tc-sky)"/>
<path d="M0 258 Q120 246 250 254 T480 250 V340 H0 Z" fill="url(#tc-ground)"/>
<ellipse cx="240" cy="308" rx="180" ry="16" fill="#3D4430" opacity="0.35"/>
<g transform="translate(352 236)">
  <circle r="80" fill="#1B1C21"/>
  {lugs}
  <circle r="42" fill="#C7522F"/><circle r="42" fill="none" stroke="#7C2F19" stroke-width="4"/>
  <circle r="13" fill="#8E8F96"/>
</g>
<g transform="translate(112 268)">
  <circle r="48" fill="#1B1C21"/>
  <circle r="24" fill="#C7522F"/><circle r="24" fill="none" stroke="#7C2F19" stroke-width="3"/>
  <circle r="8" fill="#8E8F96"/>
</g>
<path d="M244 96 h10 v58 h-10 z" fill="#3A3C42"/>
<path d="M240 88 h18 v10 h-18 z" fill="#2A2C31"/>
<path d="M268 100 h9 v92 h-9 z" fill="#4A4C52"/>
<path d="M356 100 h9 v76 h-9 z" fill="#4A4C52"/>
<path d="M262 92 h110 v11 h-110 z" fill="#4A4C52"/>
<path d="M286 176 q0 -26 26 -26 h30 v20 h-26 q-14 0 -14 14 v18 h-16 z" fill="#2E3036"/>
<path d="M232 156 l34 -16" stroke="#3A3C42" stroke-width="7" stroke-linecap="round"/>
<ellipse cx="230" cy="153" rx="17" ry="6" fill="none" stroke="#3A3C42" stroke-width="6"/>
<path d="M74 150 h188 a14 14 0 0 1 14 14 v52 h-216 v-52 a14 14 0 0 1 14 -14 z" fill="url(#tc-body)"/>
<path d="M74 150 h188 a14 14 0 0 1 14 14 v6 h-216 v-6 a14 14 0 0 1 14 -14 z" fill="#FFFFFF" opacity="0.16"/>
<path d="M60 168 h18 v46 h-18 z" fill="#2E3036"/>
<circle cx="69" cy="160" r="11" fill="#F2E3B4" stroke="#5C4A24" stroke-width="3"/>
<path d="M268 232 A84 84 0 0 1 436 232 L420 232 A68 68 0 0 0 284 232 Z" fill="#A8442A"/>
<path d="M268 232 A84 84 0 0 1 436 232 L430 232 A78 78 0 0 0 274 232 Z" fill="#FFFFFF" opacity="0.18"/>
<rect x="252" y="216" width="34" height="9" rx="3" fill="#3A3C42"/>
<g color="#F3ECDA">{applied(168, 186, width=124)}</g>"""


def gate():
    return f"""<defs>
  <linearGradient id="gt-sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#8FB2CE"/><stop offset="0.62" stop-color="#CBD8DC"/>
    <stop offset="1" stop-color="#EFD9B4"/>
  </linearGradient>
  <linearGradient id="gt-wood" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#8A6440"/><stop offset="0.5" stop-color="#6E4C2E"/>
    <stop offset="1" stop-color="#4A3120"/>
  </linearGradient>
  <linearGradient id="gt-road" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#B7A683"/><stop offset="1" stop-color="#8E7F60"/>
  </linearGradient>
  {grain("gt-grain", "0.012 0.5", 5, (0.25, 0.16, 0.08), 0.5)}
  {grain("gt-stone", "0.06", 11, (0.32, 0.29, 0.25), 0.45)}
</defs>
<rect width="480" height="340" fill="url(#gt-sky)"/>
<path d="M0 244 q70 -14 132 -6 t150 2 q90 8 198 -6 V276 H0 Z" fill="#5C6B4C" opacity="0.65"/>
<path d="M0 262 q120 -10 240 -2 t240 -6 V340 H0 Z" fill="url(#gt-road)"/>
<path d="M118 340 q46 -50 122 -52 q76 2 122 52 z" fill="#C6B694" opacity="0.55"/>
<g>
  <rect x="42" y="120" width="54" height="186" fill="#7E786C"/>
  <rect x="42" y="120" width="54" height="186" filter="url(#gt-stone)"/>
  <rect x="42" y="120" width="16" height="186" fill="#FFFFFF" opacity="0.13"/>
  <rect x="384" y="120" width="54" height="186" fill="#6F6A5F"/>
  <rect x="384" y="120" width="54" height="186" filter="url(#gt-stone)"/>
  <rect x="384" y="120" width="14" height="186" fill="#FFFFFF" opacity="0.10"/>
</g>
<rect x="26" y="86" width="428" height="40" rx="4" fill="url(#gt-wood)"/>
<rect x="26" y="86" width="428" height="40" rx="4" filter="url(#gt-grain)"/>
<rect x="26" y="86" width="428" height="7" fill="#FFFFFF" opacity="0.14"/>
<rect x="26" y="119" width="428" height="7" fill="#1F150C" opacity="0.35"/>
<path d="M186 126 V154 M294 126 V154" stroke="#2E3036" stroke-width="6" stroke-linecap="round"/>
<g color="#26292E">{applied(240, 196, width=168)}</g>
<path d="M96 168 H384 M96 206 H384" stroke="#4A4C52" stroke-width="2" opacity="0.5"/>
<path d="M0 176 H42 M438 176 H480 M0 214 H42 M438 214 H480" stroke="#4A4C52" stroke-width="2" opacity="0.45"/>"""


def front_door():
    return f"""<defs>
  <linearGradient id="dr-siding" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#E4DED0"/><stop offset="1" stop-color="#CBC4B4"/>
  </linearGradient>
  <linearGradient id="dr-paint" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#1F3A2C"/><stop offset="0.34" stop-color="#2C4E3A"/>
    <stop offset="1" stop-color="#16291F"/>
  </linearGradient>
  <linearGradient id="dr-brass" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#E7CE8C"/><stop offset="0.5" stop-color="#B08D3F"/>
    <stop offset="1" stop-color="#7C6026"/>
  </linearGradient>
  <filter id="dr-lift" x="-40%" y="-40%" width="180%" height="180%">
    <feDropShadow dx="2.5" dy="4" stdDeviation="2.4" flood-color="#08120C" flood-opacity="0.6"/>
  </filter>
</defs>
<rect width="480" height="340" fill="url(#dr-siding)"/>
<g stroke="#B3AB99" stroke-width="1.5" opacity="0.75">
  <path d="M0 40 H480 M0 80 H480 M0 120 H480 M0 160 H480 M0 200 H480 M0 240 H480 M0 280 H480 M0 320 H480"/>
</g>
<rect x="108" y="0" width="264" height="330" fill="#F3EEE2"/>
<rect x="108" y="0" width="264" height="330" fill="none" stroke="#B9B1A0" stroke-width="2"/>
<rect x="128" y="16" width="224" height="314" fill="url(#dr-paint)"/>
<rect x="128" y="16" width="224" height="314" fill="none" stroke="#0E1A13" stroke-width="2"/>
<g fill="none" stroke="#0E1A13" stroke-width="2.5" opacity="0.85">
  <rect x="150" y="40" width="180" height="150" rx="2"/>
  <rect x="150" y="212" width="180" height="98" rx="2"/>
</g>
<g fill="none" stroke="#5C8A6E" stroke-width="1.5" opacity="0.5">
  <rect x="154" y="44" width="172" height="142" rx="2"/>
  <rect x="154" y="216" width="172" height="90" rx="2"/>
</g>
<g color="#111417" filter="url(#dr-lift)">{applied(240, 115, width=136)}</g>
<circle cx="336" cy="238" r="11" fill="url(#dr-brass)"/>
<rect x="330" y="200" width="12" height="20" rx="3" fill="url(#dr-brass)"/>
<rect x="108" y="330" width="264" height="10" fill="#9A9382"/>
<path d="M128 16 h224 v40 h-224 z" fill="#FFFFFF" opacity="0.07"/>"""


def cow():
    """
    A large-framed beef cow in profile, facing left — so the animal's left side
    is the one on show, which is the side this brand goes on.

    Proportioned off the real thing rather than drawn by eye, because the two
    mistakes that turn a drawn cow into a seal are both proportional: an animal
    much longer than about two and a half times its own depth, and a neck as
    deep as its barrel. Head, body and legs are separate overlapping shapes —
    one silhouette has no jaw line and no shoulder.
    """
    body = (
        "M128 92 C160 96 180 100 200 104 C250 100 300 99 340 102 "
        "C352 103 358 105 360 108 C368 116 372 126 372 138 "
        "C373 156 370 174 362 188 C356 199 348 206 336 212 "
        "C322 219 306 221 296 220 C266 226 226 227 198 220 "
        "C178 215 166 211 158 204 C150 198 146 194 140 189 "
        "C132 180 126 168 122 152 C120 130 122 108 128 92 Z"
    )
    head = (
        "M126 90 C112 90 102 95 96 104 C88 116 82 132 82 147 "
        "C82 156 89 162 99 160 C110 158 119 151 125 141 "
        "C131 129 133 106 126 90 Z"
    )
    return f'''<defs>
  <linearGradient id="cw-sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#B7CBD9"/><stop offset="1" stop-color="#DCDCC6"/>
  </linearGradient>
  <linearGradient id="cw-field" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#8D9A63"/><stop offset="0.4" stop-color="#77874F"/>
    <stop offset="1" stop-color="#586840"/>
  </linearGradient>
  <linearGradient id="cw-hide" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#34353C"/><stop offset="0.28" stop-color="#1B1C21"/>
    <stop offset="0.74" stop-color="#0F1015"/><stop offset="1" stop-color="#25262C"/>
  </linearGradient>
  <linearGradient id="cw-head" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#2C2D34"/><stop offset="0.55" stop-color="#17181D"/>
    <stop offset="1" stop-color="#212229"/>
  </linearGradient>
  <radialGradient id="cw-sheen" cx="0.5" cy="0.4" r="0.62">
    <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.12"/>
    <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
  </radialGradient>
  {grain("cw-hair", "0.9", 9, (0.55, 0.53, 0.5), 0.1)}
  <filter id="cw-scar" x="-25%" y="-25%" width="150%" height="150%">
    <feGaussianBlur stdDeviation="0.9"/>
  </filter>
  <clipPath id="cw-body"><path d="{body}"/></clipPath>
</defs>
<rect width="480" height="340" fill="url(#cw-sky)"/>
<path d="M0 150 q60 -16 128 -8 t142 4 q108 10 210 -8 V206 H0 Z" fill="#7C8A6A" opacity="0.5"/>
<rect y="196" width="480" height="144" fill="url(#cw-field)"/>
<ellipse cx="248" cy="304" rx="140" ry="15" fill="#3E4A2E" opacity="0.45"/>
<!-- Far legs, near legs, then the body over both: only what falls below the
     belly should show, and the near pair has to be in front of the far pair. -->
<g fill="#0E0F14">
  <path d="M214 206 L236 206 L232 252 L229 292 L214 292 L217 252 Z"/>
  <path d="M310 190 L336 190 L340 232 L326 258 L328 292 L314 292 L312 257 L306 231 Z"/>
</g>
<g fill="#08090C">
  <rect x="212" y="290" width="22" height="15" rx="4"/>
  <rect x="310" y="290" width="22" height="15" rx="4"/>
</g>
<g fill="#191A20">
  <path d="M186 204 L212 204 L208 250 L205 295 L188 295 L192 250 Z"/>
  <path d="M330 186 L364 186 L368 234 L352 260 L354 295 L337 295 L335 259 L327 233 Z"/>
</g>
<g fill="#050609">
  <rect x="185" y="293" width="24" height="16" rx="4"/>
  <rect x="334" y="293" width="24" height="16" rx="4"/>
</g>
<path d="{body}" fill="url(#cw-hide)"/>
<path d="M362 108 q18 48 10 98 q-3 17 -10 26" fill="none" stroke="#17181D" stroke-width="8" stroke-linecap="round"/>
<path d="M368 230 q6 22 -2 34" fill="none" stroke="#0B0C10" stroke-width="15" stroke-linecap="round"/>
<path d="M286 221 q20 4 28 -2 q2 12 -11 16 q-15 2 -17 -14 z" fill="#191A20"/>
<g clip-path="url(#cw-body)">
  <rect width="480" height="340" filter="url(#cw-hair)"/>
  <ellipse cx="246" cy="160" rx="100" ry="58" fill="url(#cw-sheen)"/>
  <path d="M164 100 C218 96 292 97 348 104 C292 112 226 114 164 112 Z" fill="#FFFFFF" opacity="0.12"/>
  <path d="M336 102 q36 34 38 68 q-24 -44 -52 -60 z" fill="#FFFFFF" opacity="0.06"/>
  <path d="M198 104 q-16 44 -14 92 q-15 -44 -3 -90 z" fill="#FFFFFF" opacity="0.06"/>
  <path d="M144 186 q14 20 12 38 q-18 -14 -20 -36 z" fill="#000000" opacity="0.28"/>
  <path d="M322 102 q-10 40 -4 84 q-12 -40 -8 -82 z" fill="#000000" opacity="0.16"/>
  <g color="#A08E76" filter="url(#cw-scar)" opacity="0.92">
    {applied(246, 156, width=94, extra="rotate(-3) skewY(4)")}
  </g>
</g>
<path d="M126 96 q19 -12 35 -2 q4 7 -8 11 q-16 4 -30 -3 z" fill="#141519"/>
<path d="M131 97 q14 -5 24 -1 q-11 4 -24 6 z" fill="#3A3B43" opacity="0.6"/>
<path d="{head}" fill="url(#cw-head)"/>
<path d="M82 147 C82 156 89 162 99 160 C110 158 119 151 125 141 C111 140 95 142 82 147 Z" fill="#32333B"/>
<ellipse cx="92" cy="152" rx="4.1" ry="2.8" fill="#0A0B0E" transform="rotate(-30 92 152)"/>
<ellipse cx="106" cy="110" rx="6" ry="5.4" fill="#08090C"/>
<ellipse cx="104.3" cy="108.3" rx="2" ry="1.7" fill="#8A8E98" opacity="0.85"/>
<path d="M125 141 C119 151 111 158 99 160" fill="none" stroke="#08090C" stroke-width="2"
      opacity="0.5" stroke-linecap="round"/>'''


def show_box():
    plate = "".join(
        f'<path d="M{x} 258 l9 9 M{x} 276 l9 9" stroke="#8F949B" stroke-width="1.6" opacity="0.7"/>'
        for x in range(164, 320, 16)
    )
    striations = "".join(
        f'<path d="M{x} 96 V252" stroke="#FFFFFF" stroke-width="1" opacity="0.13"/>'
        for x in range(168, 320, 11)
    )
    return f"""<defs>
  <linearGradient id="sb-room" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#5C5A52"/><stop offset="0.58" stop-color="#403E38"/>
    <stop offset="0.6" stop-color="#6A6155"/><stop offset="1" stop-color="#4B443A"/>
  </linearGradient>
  <linearGradient id="sb-alu" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#8A9098"/><stop offset="0.18" stop-color="#D6DADE"/>
    <stop offset="0.46" stop-color="#AAB0B7"/><stop offset="0.78" stop-color="#C9CED3"/>
    <stop offset="1" stop-color="#787E86"/>
  </linearGradient>
  <linearGradient id="sb-lid" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#9AA0A8"/><stop offset="0.3" stop-color="#E0E4E8"/>
    <stop offset="1" stop-color="#868C94"/>
  </linearGradient>
</defs>
<rect width="480" height="340" fill="url(#sb-room)"/>
<ellipse cx="240" cy="312" rx="120" ry="14" fill="#1E1B16" opacity="0.5"/>
<rect x="158" y="88" width="164" height="212" rx="4" fill="url(#sb-alu)"/>
{striations}
<rect x="158" y="56" width="164" height="36" rx="4" fill="url(#sb-lid)"/>
<rect x="158" y="90" width="164" height="4" fill="#5F656C" opacity="0.8"/>
<rect x="214" y="42" width="52" height="14" rx="7" fill="#4E545B"/>
<rect x="218" y="45" width="44" height="6" rx="3" fill="#9AA0A8"/>
<g fill="#63696F">
  <rect x="166" y="84" width="16" height="18" rx="3"/>
  <rect x="298" y="84" width="16" height="18" rx="3"/>
</g>
<rect x="158" y="252" width="164" height="40" fill="#9DA3AA"/>
{plate}
<rect x="158" y="252" width="164" height="3" fill="#5F656C" opacity="0.7"/>
<g fill="#2A2D33">
  <circle cx="182" cy="304" r="11"/><circle cx="298" cy="304" r="11"/>
</g>
<g fill="#5C626A">
  <circle cx="182" cy="304" r="4"/><circle cx="298" cy="304" r="4"/>
</g>
<g color="#1B1F27">{applied(240, 172, width=124)}</g>"""


def trailer():
    slats = "".join(
        f'<rect x="212" y="{y}" width="228" height="9" rx="4" fill="#3D444C" opacity="0.85"/>'
        for y in (166, 186, 206, 226)
    )
    ribs = "".join(
        f'<path d="M{x} 144 V246" stroke="#FFFFFF" stroke-width="1.2" opacity="0.16"/>'
        for x in range(126, 210, 14)
    )
    return f"""<defs>
  <linearGradient id="tl-sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#9FBBD2"/><stop offset="1" stop-color="#E2DEC9"/>
  </linearGradient>
  <linearGradient id="tl-ground" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#A99C7C"/><stop offset="1" stop-color="#7E7358"/>
  </linearGradient>
  <linearGradient id="tl-alu" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#E2E5E8"/><stop offset="0.42" stop-color="#B4BAC1"/>
    <stop offset="0.52" stop-color="#CDD2D7"/><stop offset="1" stop-color="#868D95"/>
  </linearGradient>
</defs>
<rect width="480" height="340" fill="url(#tl-sky)"/>
<path d="M0 256 q140 -12 250 -4 t230 -8 V340 H0 Z" fill="url(#tl-ground)"/>
<ellipse cx="250" cy="288" rx="196" ry="14" fill="#4A4335" opacity="0.4"/>
<path d="M116 138 H52 L42 148 V182 L62 194 H116 Z" fill="url(#tl-alu)"/>
<path d="M116 138 H52 L42 148 h74 z" fill="#E7EAED"/>
<path d="M42 182 H62 L62 194 H62 Z" fill="#7C838B"/>
<rect x="56" y="192" width="30" height="16" rx="4" fill="#4E545B"/>
<rect x="64" y="206" width="16" height="12" rx="3" fill="#31363C"/>
<rect x="110" y="136" width="336" height="114" rx="6" fill="url(#tl-alu)"/>
{ribs}
{slats}
<rect x="110" y="136" width="336" height="11" rx="5" fill="#DFE3E7"/>
<rect x="110" y="239" width="336" height="11" rx="5" fill="#7F868E"/>
<path d="M266 250 q34 -30 68 0 z" fill="#9AA1A9"/>
<path d="M334 250 q34 -30 68 0 z" fill="#9AA1A9"/>
<g>
  <circle cx="300" cy="256" r="27" fill="#1D1E22"/><circle cx="300" cy="256" r="12" fill="#8D939A"/>
  <circle cx="368" cy="256" r="27" fill="#1D1E22"/><circle cx="368" cy="256" r="12" fill="#8D939A"/>
</g>
<rect x="439" y="152" width="9" height="32" rx="3" fill="#B23A2C"/>
<g color="#1E232B">{applied(160, 194, width=84)}</g>"""


def letterhead():
    lines = "".join(
        f'<rect x="152" y="{y}" width="{width}" height="5" rx="2.5" fill="#C3BFB4"/>'
        for y, width in [
            (168, 176), (182, 168), (196, 174), (210, 138),
            (232, 176), (246, 170), (260, 156), (274, 172), (288, 108),
        ]
    )
    return f"""<defs>
  <linearGradient id="lh-desk" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#6E5B45"/><stop offset="0.5" stop-color="#5B4A37"/>
    <stop offset="1" stop-color="#48392A"/>
  </linearGradient>
  {grain("lh-wood", "0.008 0.4", 13, (0.2, 0.14, 0.08), 0.4)}
  {grain("lh-fibre", "1.1", 21, (0.55, 0.52, 0.46), 0.07)}
  <filter id="lh-shadow" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="4" dy="7" stdDeviation="6" flood-color="#1E170F" flood-opacity="0.45"/>
  </filter>
</defs>
<rect width="480" height="340" fill="url(#lh-desk)"/>
<rect width="480" height="340" filter="url(#lh-wood)"/>
<g filter="url(#lh-shadow)">
  <rect x="130" y="14" width="220" height="312" rx="2" fill="#FBF9F3"/>
</g>
<rect x="130" y="14" width="220" height="312" filter="url(#lh-fibre)"/>
<g color="#20242B">{applied(170, 54, width=40)}</g>
<text x="197" y="52" font-family="Zilla Slab, Georgia, serif" font-size="16"
      font-weight="600" letter-spacing="1.4" fill="#20242B">DOUBLE M</text>
<text x="198" y="66" font-family="Inter, system-ui, sans-serif" font-size="6.4"
      letter-spacing="1.15" fill="#8A8579">REGISTERED BRAND · LEFT RIB</text>
<rect x="152" y="88" width="176" height="1.6" fill="#20242B" opacity="0.55"/>
{lines}
<path d="M152 306 q14 -12 26 -2 t22 -6 q10 -8 20 2" fill="none" stroke="#3B4658"
      stroke-width="2" stroke-linecap="round" opacity="0.75"/>"""


MOCKUPS = [
    ("truck", "Ranch truck", "Painted, cream on the door — about 12 inches", truck),
    ("tractor", "Tractor hood", "Vinyl, cream — about 10 inches", tractor),
    ("gate", "Ranch gate", "Cut steel, hung from the beam — about 36 inches", gate),
    ("cow", "Black Maine-Anjou", "4-inch iron, left rib — healed scar on black hide", cow),
    ("trailer", "Gooseneck stock trailer", "Vinyl on the nose panel — about 18 inches", trailer),
    ("show-box", "Show box", "Vinyl decal on brushed aluminium — about 12 inches", show_box),
    ("front-door", "House front door", "Cast iron, mounted proud — about 10 inches", front_door),
    ("letterhead", "Letterhead", "Printed, one colour — about 0.9 inches", letterhead),
]


# ---------------------------------------------------------------------------
# The sheet
# ---------------------------------------------------------------------------

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
.sheet { max-width: 1000px; margin: 0 auto; padding: 56px 24px 96px; }

h1, h2, h3 { font-family: "Zilla Slab", Georgia, serif; font-weight: 600; text-wrap: balance; margin: 0; }
h1 { font-size: 44px; line-height: 1.1; letter-spacing: -0.01em; }
h2 { font-size: 22px; }
h3 { font-size: 20px; }
p { margin: 0; }

.eyebrow {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--identity);
}
.masthead { display: flex; flex-direction: column; gap: 14px; }
.lead { max-width: 62ch; color: var(--muted); font-size: 17px; }
.lead strong { color: var(--ink); font-weight: 600; }

.glance {
  display: flex; flex-wrap: wrap; gap: 8px 40px; align-items: flex-end;
  margin-top: 34px; padding: 22px 0;
  border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule);
}
.glance figure { margin: 0; display: flex; flex-direction: column; gap: 8px; align-items: center; color: var(--ink); }
.glance figcaption, .mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px; letter-spacing: 0.06em; color: var(--muted);
}

section { margin-top: 56px; }
.section-head { display: flex; flex-direction: column; gap: 4px; margin-bottom: 22px; }
.section-head p { color: var(--muted); font-size: 15px; max-width: 62ch; }

.plates { display: grid; grid-template-columns: repeat(auto-fit, minmax(370px, 1fr)); gap: 22px; }
.plate {
  margin: 0; display: flex; flex-direction: column;
  background: var(--panel); border: 1px solid color-mix(in srgb, var(--rule) 40%, transparent);
  border-radius: 6px; overflow: hidden;
}
.mark {
  display: flex; align-items: center; justify-content: center;
  padding: 32px 20px 26px; background: var(--raised); color: var(--ink);
}
.plate figcaption { flex: 1; display: flex; flex-direction: column; gap: 10px; padding: 20px 22px 22px; }
.spec {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums;
}
.character { font-family: "Zilla Slab", Georgia, serif; font-size: 16px; }
.note { font-size: 14.5px; color: var(--muted); }
.watch { font-size: 14.5px; color: var(--muted); padding-left: 12px; border-left: 2px solid var(--identity); }
.watch b {
  display: block; color: var(--identity); font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px; letter-spacing: 0.1em; text-transform: uppercase;
}

/* The size ladder. Marks sit on a common baseline so the drop-off is visible. */
.ladder { display: flex; flex-direction: column; gap: 4px; }
.rung {
  display: flex; align-items: flex-end; gap: 26px;
  padding: 18px 4px; border-top: 1px solid color-mix(in srgb, var(--rule) 35%, transparent);
  color: var(--ink); overflow-x: auto;
}
.rung .who {
  flex: 0 0 148px; align-self: center;
  font-family: "Zilla Slab", Georgia, serif; font-size: 15px; font-weight: 600;
}
.rung figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.rung figcaption {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px; color: var(--muted); font-variant-numeric: tabular-nums;
}

/* Mockups. One set of drawings; the switcher changes which mark is in them. */
.switcher { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 22px; }
.switcher button {
  font: inherit; font-size: 14px; cursor: pointer;
  padding: 7px 14px; border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--rule) 55%, transparent);
  background: transparent; color: var(--muted);
}
.switcher button:hover { color: var(--ink); border-color: var(--ink); }
.switcher button[aria-pressed="true"] {
  background: var(--identity); border-color: var(--identity); color: var(--canvas); font-weight: 600;
}
.switcher button:focus-visible { outline: 2px solid var(--identity); outline-offset: 3px; }

.brand { display: none; }
.scenes { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 20px; }
.scene-card {
  margin: 0; background: var(--panel); border-radius: 6px; overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--rule) 40%, transparent);
}
.scene { display: block; width: 100%; height: auto; }
.scene-card figcaption { display: flex; flex-direction: column; gap: 2px; padding: 14px 18px 16px; }
.scene-card h3 { font-size: 16px; }

.scroller { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 14.5px; }
th, td { text-align: left; padding: 11px 16px 11px 0; border-bottom: 1px solid color-mix(in srgb, var(--rule) 35%, transparent); }
th {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); font-weight: 400;
}
td:first-child { font-weight: 600; white-space: nowrap; }
td.num { font-variant-numeric: tabular-nums; }

.reasons { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 0 32px; }
.reasons div { padding: 15px 0; border-top: 1px solid color-mix(in srgb, var(--rule) 40%, transparent); }
.reasons h3 { font-size: 15.5px; text-decoration: line-through; text-decoration-color: var(--rule); }
.reasons p { color: var(--muted); font-size: 14.5px; margin-top: 4px; }

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
  .plates, .scenes { grid-template-columns: 1fr; }
  .rung .who { flex-basis: 110px; }
}
"""

SWITCH_JS = """
(function () {
  var buttons = Array.prototype.slice.call(document.querySelectorAll(".switcher button"));
  function choose(slug) {
    document.body.setAttribute("data-brand", slug);
    buttons.forEach(function (button) {
      button.setAttribute("aria-pressed", String(button.dataset.brand === slug));
    });
  }
  buttons.forEach(function (button) {
    button.addEventListener("click", function () { choose(button.dataset.brand); });
  });
  /* Also sets the default, so a page that supplies its own <body> still starts
     on a mark rather than on eight blank surfaces. */
  choose(document.body.getAttribute("data-brand") || "DEFAULT_SLUG");
})();
"""


def plate(variant):
    return f"""      <figure class="plate">
        <div class="mark">{inline_svg(variant, 176, decorative=False)}</div>
        <figcaption>
          <h3>{variant["name"]}</h3>
          <p class="spec">{variant["units"]} · {strokes(variant["paths"])} strokes</p>
          <p class="character">{variant["character"]}</p>
          <p class="note">{variant["note"]}</p>
          <p class="watch"><b>Watch</b>{variant["watch"]}</p>
        </figcaption>
      </figure>"""


def rung(variant):
    sizes = "".join(
        f"<figure>{inline_svg(variant, px, decorative=True)}<figcaption>{px}</figcaption></figure>"
        for px in LADDER
    )
    return f"""        <div class="rung">
          <span class="who">{variant["name"]}</span>
          {sizes}
        </div>"""


def scene_card(slug, title, caption, draw):
    return f"""      <figure class="scene-card">
        <svg viewBox="0 0 480 340" class="scene" role="img"
             aria-label="{title}, with the Double M brand applied">{draw()}</svg>
        <figcaption>
          <h3>{title}</h3>
          <p class="mono">{caption}</p>
        </figcaption>
      </figure>"""


def body():
    glance = "\n".join(
        f'        <figure>{inline_svg(v, 56, decorative=True)}'
        f'<figcaption>{v["name"]}</figcaption></figure>'
        for v in VARIANTS
    )
    plates = "\n".join(plate(v) for v in VARIANTS)
    ladder = "\n".join(rung(v) for v in VARIANTS)
    switcher = "\n".join(
        f'        <button type="button" data-brand="{v["slug"]}" '
        f'aria-pressed="{"true" if v["slug"] == VARIANTS[1]["slug"] else "false"}">'
        f'{v["name"]}</button>'
        for v in VARIANTS
    )
    scenes = "\n".join(scene_card(*mockup) for mockup in MOCKUPS)
    rows = "\n".join(
        f"""          <tr>
            <td>{v["name"]}</td>
            <td class="num">{v["units"].split(" ")[0]}</td>
            <td class="num">{strokes(v["paths"])}</td>
            <td>{SMALL_SIZE[v["slug"]]}</td>
          </tr>"""
        for v in VARIANTS
    )
    cut = "\n".join(f"        <div><h3>{n}</h3><p>{w}</p></div>" for n, w in CUT)
    never = "\n".join(f"        <div><h3>{n}</h3><p>{w}</p></div>" for n, w in NEVER_DRAWN)

    return f"""  <div class="sheet">
    <header class="masthead">
      <p class="eyebrow">Shortlist · narrowed from thirteen</p>
      <h1>Double M</h1>
      <p class="lead">Four <strong>Double M</strong> irons, in the grammar the Texas &amp;
        Southwestern Cattle Raisers Association publishes — at every size they have to
        survive, and on the eight things they would actually go on. Each name is the brand's
        <strong>reading</strong>: what it would be called out as, recorded as, and argued
        over. The approved farm logomark is still the Rocking Double Star; nothing here
        replaces it.</p>
      <div class="glance">
{glance}
      </div>
    </header>

    <section>
      <div class="section-head">
        <h2>The four</h2>
        <p>Strokes are counted, not estimated — one per segment the iron has to draw.
          A plain pair of M's is eight before anything is added to it.</p>
      </div>
      <div class="plates">
{plates}
      </div>
    </section>

    <section>
      <div class="section-head">
        <h2>At size</h2>
        <p>16 to 200 pixels, on a common baseline. 16 is a browser tab and an ear-tag
          stamp; 24 is the app; 200 is the gate. Where a mark stops working is the
          decision, and it is not the same size for all four.</p>
      </div>
      <div class="ladder">
{ladder}
      </div>
    </section>

    <section>
      <div class="section-head">
        <h2>In use</h2>
        <p>Drawings rather than photographs, built to hold the thing a photograph would be
          used to check: the mark at its real size, against the real material, on the
          surface it goes on. Switch the mark and the whole set changes.</p>
      </div>
      <div class="switcher" role="group" aria-label="Which mark to show in the mockups">
{switcher}
      </div>
      <div class="scenes">
{scenes}
      </div>
    </section>

    <section>
      <div class="section-head">
        <h2>Side by side</h2>
        <p>Two or three units each, and all four survive small — though not equally.</p>
      </div>
      <div class="scroller">
        <table>
          <thead>
            <tr><th>Brand</th><th>Units</th><th>Strokes</th><th>At 16px</th></tr>
          </thead>
          <tbody>
{rows}
          </tbody>
        </table>
      </div>
    </section>

    <section>
      <div class="section-head">
        <h2>Cut from the set</h2>
        <p>Drawn, looked at, and set down. The drawings are in the history; the reasons
          are the part worth keeping.</p>
      </div>
      <div class="reasons">
{cut}
      </div>
    </section>

    <section>
      <div class="section-head">
        <h2>Never drawn</h2>
        <p>Every one of these is grammatical. Each fails on something other than grammar.</p>
      </div>
      <div class="reasons">
{never}
      </div>
    </section>

    <footer>
      <p>Grammar from <em>How to Design a Brand</em>, Texas &amp; Southwestern Cattle Raisers
        Association. Judgements about iron width, blotting and hide are ours.</p>
      <p>Drawn by <code>tools/generate-double-m-brands.py</code>. Edit the script, not the SVGs.</p>
    </footer>
  </div>"""


def visibility_css():
    return "\n".join(
        f'body[data-brand="{v["slug"]}"] .brand--{v["slug"]} {{ display: inline; }}'
        for v in VARIANTS
    )


def export_svg(variant, ink, width=None):
    """
    One mark, one colour, cropped to itself and with no background.

    A hard colour rather than `currentColor`, because these leave the repo: a
    file that inherits its colour from a stylesheet it will never meet renders
    black in some places and invisible in others.
    """
    x0, y0, x1, y1 = bounds(variant)
    x0, y0 = x0 - EXPORT_PAD, y0 - EXPORT_PAD
    box_w, box_h = (x1 - x0) + EXPORT_PAD, (y1 - y0) + EXPORT_PAD
    size = ""
    if width:
        size = f' width="{f(width)}" height="{f(round(width * box_h / box_w, 2))}"'
    elements = "".join(f'<path d="{d}"/>' for d in variant["paths"])
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="{f(x0)} {f(y0)} {f(box_w)} {f(box_h)}"{size} '
        f'role="img" aria-label="{variant["name"]}">\n'
        f"  <title>{variant['name']}</title>\n"
        f'  <g fill="none" stroke="{ink}" stroke-width="{STROKE}" '
        f'stroke-linecap="round" stroke-linejoin="round">{elements}</g>\n'
        "</svg>\n"
    )


EXPORT_README = """Double M — brand marks
======================

Four candidate Double M irons, drawn to the grammar in "How to Design a Brand"
(Texas & Southwestern Cattle Raisers Association).

  double-m-connected   Double M Connected   2 units,  7 strokes
  m-bar-m              M Bar M              3 units,  9 strokes
  rocking-double-m     Rocking Double M     3 units,  9 strokes
  flying-double-m      Flying Double M      3 units, 10 strokes

Files
-----
  svg/black/<mark>.svg         scalable, no width or height — scales to any box
  svg/black/<mark>-<n>.svg     <n> pixels WIDE
  svg/white/...                same, in white
  png/black/<mark>-<n>.png     <n> pixels wide, transparent
  png/white/...                same, in white

  n = 16, 24, 32, 48, 64, 128, 256, 512, 1024 — and 2048 for the PNGs, which is
  the one to reach for when compositing onto a photograph.

Every file has a transparent background and no background shape. Black is for
light surfaces, white for dark ones.

Sizes are WIDTHS, and each mark is cropped to its own outline — no padding, no
square canvas. So "-256" means the artwork is 256 pixels across, and the four
have different heights at the same size, because they are different shapes.
Nothing is clipped: the crop already allows for the round stroke ends.

The SVGs are strokes, not filled outlines. If you need to recolour one, change
the `stroke` attribute; if your tool needs outlines, convert stroke-to-path
first or the recolour will do nothing.

Redraw everything from tools/generate-double-m-brands.py in the GalaxyFarm
repository — these are one M placed four ways, not four drawings.
"""


def export(directory):
    for ink_name, ink in EXPORT_INKS.items():
        for kind in ("svg",):
            (directory / kind / ink_name).mkdir(parents=True, exist_ok=True)
        for variant in VARIANTS:
            folder = directory / "svg" / ink_name
            (folder / f"{variant['slug']}.svg").write_text(
                export_svg(variant, ink), encoding="utf-8"
            )
            for width in EXPORT_SIZES:
                (folder / f"{variant['slug']}-{width}.svg").write_text(
                    export_svg(variant, ink, width), encoding="utf-8"
                )
    (directory / "README.txt").write_text(EXPORT_README, encoding="utf-8")
    return len(EXPORT_INKS) * len(VARIANTS) * (len(EXPORT_SIZES) + 1)


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
    parser.add_argument(
        "--export",
        type=Path,
        help=(
            "Write a hand-off set to this directory: every mark in black and white, "
            "cropped to itself, scalable and at each size in EXPORT_SIZES."
        ),
    )
    args = parser.parse_args()

    if args.export:
        count = export(args.export)
        print(f"{count} svgs -> {args.export}")

    OUT.mkdir(parents=True, exist_ok=True)
    for variant in VARIANTS:
        (OUT / f"{variant['slug']}.svg").write_text(svg_file(variant), encoding="utf-8")

    style = STYLE + visibility_css()
    default = VARIANTS[1]["slug"]
    script = SWITCH_JS.replace("DEFAULT_SLUG", default)

    (OUT / "contact-sheet.html").write_text(
        f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Double M</title>
<style>{style}</style>
</head>
<body data-brand="{default}">
{body()}
<script>{script}</script>
</body>
</html>
""",
        encoding="utf-8",
    )

    if args.fragment:
        args.fragment.write_text(
            f"<title>Double M</title>\n<style>{style}</style>\n"
            f"{body()}\n<script>{script}</script>",
            encoding="utf-8",
        )

    print(f"{len(VARIANTS)} marks, {len(MOCKUPS)} mockups -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
