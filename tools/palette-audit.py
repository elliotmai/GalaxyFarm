#!/usr/bin/env python3
"""
The candidate palettes, audited (docs/ui-redesign.md).

    python3 tools/palette-audit.py

A palette is not a mood board — it is eight colours that have to survive being
put next to each other, and §8 already insists that gets computed rather than
eyeballed. The formulas below are a straight port of
`packages/ui/src/tokens/contrast.ts`, so anything this prints can go into
`packages/ui/tests/contrast.test.ts` as an assertion the moment a palette wins.

Running it found one real problem. The safety ramp's amber, level 3 at
`#C98A1E`, sits between 2.71 and 2.74 against every one of these grounds —
under the 3.0 that WCAG §1.4.11 requires of a meaningful non-text mark. It has
never been a problem because it has only ever sat on a near-black canvas.
Going light-first breaks it. Darkening to `#BC811C` clears every ground at 3.07
and keeps black ink on it at 5.66, so that is the corrected value below.

The neutrals are deliberately not shared between palettes: each ground and
muted carries a faint bias toward its own primary, because a pure grey beside a
coloured accent is what makes a palette read as defaulted rather than chosen.
"""

AA_TEXT, AA_LARGE, AA_NON_TEXT = 4.5, 3.0, 3.0


def _channel(v):
    s = v / 255
    return s / 12.92 if s <= 0.03928 else ((s + 0.055) / 1.055) ** 2.4


def luminance(hex_colour):
    h = hex_colour.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * _channel(r) + 0.7152 * _channel(g) + 0.0722 * _channel(b)


def ratio(fg, bg):
    a, b = luminance(fg), luminance(bg)
    return (max(a, b) + 0.05) / (min(a, b) + 0.05)


def saturation(hex_colour):
    h = hex_colour.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    mx, mn = max(r, g, b), min(r, g, b)
    if mx == mn:
        return 0.0
    li = (mx + mn) / 2
    return (mx - mn) / (2 - mx - mn) if li > 0.5 else (mx - mn) / (mx + mn)


# ── The six ──────────────────────────────────────────────────────────────
PALETTES = [
    {
        "key": "registry",
        "name": "Registry Green",
        "story": "The colour of the paperwork. Herd books, registration "
                 "certificates and sale catalogues have been printed in a deep "
                 "green for a century, which is exactly the association the "
                 "desktop surface wants.",
        "ground": "#f6f7f2", "surface": "#ffffff", "ink": "#171a16",
        "muted": "#565c53", "rule": "#dbded3",
        "primary": "#2a4b34", "on_primary": "#ffffff",
        "alert": "#8c3a2b", "ok": "#2a4b34",
        "note": "Confirm and primary are the same green on purpose — two "
                "greens in one palette read as a bug, not a distinction.",
    },
    {
        "key": "bluebonnet",
        "name": "Bluebonnet",
        "story": "The colour §8 already specifies for every primary action, "
                 "kept. The state flower, and the one choice here that costs "
                 "no continuity with anything already built or printed.",
        "ground": "#f5f6f8", "surface": "#ffffff", "ink": "#16181c",
        "muted": "#535963", "rule": "#d8dbe1",
        "primary": "#35569e", "on_primary": "#ffffff",
        "alert": "#a8321f", "ok": "#3f6b4a",
        "note": "The safest continuity play: the token value does not change, "
                "only everything around it.",
    },
    {
        "key": "oxblood",
        "name": "Barn Oxblood",
        "story": "Barn paint and the heat of a brand iron. The most "
                 "agricultural of the six and the most confident — it does not "
                 "look like software at all.",
        "ground": "#f8f6f2", "surface": "#ffffff", "ink": "#1a1613",
        "muted": "#5f5850", "rule": "#e0dad0",
        "primary": "#7e2d22", "on_primary": "#ffffff",
        "alert": "#b3261e", "ok": "#3f6b4a",
        "note": "Watch the collision: primary and alert are both red. The deep "
                "oxblood and the brighter alert are separable, but a warning "
                "next to a button will always be the weakest moment here.",
    },
    {
        "key": "navy",
        "name": "Ink Navy",
        "story": "Ledgers, fountain pens, and every serious document ever "
                 "filed. The most conservative option, and the one least "
                 "likely to be wrong in five years.",
        "ground": "#f5f6f7", "surface": "#ffffff", "ink": "#14171b",
        "muted": "#525860", "rule": "#d7dade",
        "primary": "#1e3a5f", "on_primary": "#ffffff",
        "alert": "#a8321f", "ok": "#3f6b4a",
        "note": "Nothing here will surprise anyone, which is both the "
                "recommendation and the warning.",
    },
    {
        "key": "brass",
        "name": "Brass",
        "story": "The champion accent §8 holds in reserve and has never used. "
                 "Buckles, trophies, ribbons — the show ring rather than the "
                 "pasture, which is exactly where the boarding business lives.",
        "ground": "#f9f7f0", "surface": "#ffffff", "ink": "#1b1813",
        "muted": "#5e5749", "rule": "#e3ddcc",
        "primary": "#75570f", "on_primary": "#ffffff",
        "alert": "#9c3324", "ok": "#47654d",
        "note": "The bright brass #C9A24B cannot carry text — it is 2.0:1 on "
                "white. It stays a fill and a rule; this darker tobacco does "
                "the reading.",
    },
    {
        "key": "teal",
        "name": "Slate Teal",
        "story": "The one nobody else in agricultural software is using. Cool, "
                 "quiet and modern without being a tech-company blue.",
        "ground": "#f3f6f6", "surface": "#ffffff", "ink": "#13191a",
        "muted": "#4f585a", "rule": "#d4dbdb",
        "primary": "#1f5158", "on_primary": "#ffffff",
        "alert": "#a8321f", "ok": "#3f6b4a",
        "note": "Furthest from the farm's existing printed material, so it "
                "wins on differentiation and loses on continuity.",
    },
]

# The safety ramp is outside every palette (spec §8) and identical in all of
# them. Restyling it per palette would break the one rule the colour system is
# built on.
SAFETY = {1: "#2f6b3d", 2: "#3f8f4f", 3: "#c98a1e", 4: "#c0392b", 5: "#8e1f14"}


CHECKS = [
    ("ink on ground",       "ink",       "ground",  AA_TEXT),
    ("muted on ground",     "muted",     "ground",  AA_TEXT),
    ("ink on surface",      "ink",       "surface", AA_TEXT),
    ("muted on surface",    "muted",     "surface", AA_TEXT),
    ("primary on ground",   "primary",   "ground",  AA_TEXT),
    ("primary on surface",  "primary",   "surface", AA_TEXT),
    ("label on primary",    "on_primary", "primary", AA_TEXT),
    ("alert on ground",     "alert",     "ground",  AA_TEXT),
    ("ok on ground",        "ok",        "ground",  AA_TEXT),
    ("rule on surface",     "rule",      "surface", AA_NON_TEXT),
]


def audit(p):
    rows = []
    for what, fg, bg, minimum in CHECKS:
        r = ratio(p[fg], p[bg])
        rows.append((what, r, minimum, r >= minimum))
    return rows


# ── Corrected safety ramp ────────────────────────────────────────────────
#
# Identical in every palette and deliberately outside all of them. §8 puts the
# safety scale outside the palette so nothing competes with it; tinting it per
# palette would break the one rule the colour system is built on.
SAFETY_LIGHT = {1: "#2f6b3d", 2: "#3f8f4f", 3: "#bc811c", 4: "#c0392b", 5: "#8e1f14"}


def report() -> int:
    """Print the audit. Returns the number of AA text failures found."""
    failures = 0

    for p in PALETTES:
        print(f"\n{p['name']}  primary {p['primary']}  saturation {saturation(p['primary']):.2f}")
        for what, r, minimum, ok in audit(p):
            # The hairline rule is decoration, not a control boundary, so it is
            # reported for information rather than gated.
            if what == "rule on surface":
                print(f"     {what:<20} {r:5.2f}  (informational)")
                continue
            if not ok:
                failures += 1
            print(f"  {'  ' if ok else '!!'} {what:<20} {r:5.2f}  (min {minimum})")

    print("\n── safety ramp, weakest contrast against any of the grounds ──")
    for level, colour in sorted(SAFETY_LIGHT.items()):
        worst = min(ratio(colour, p["ground"]) for p in PALETTES)
        white, black = ratio("#ffffff", colour), ratio("#111111", colour)
        ink = "white" if white >= black else "black"
        state = "ok" if worst >= AA_NON_TEXT else "FAIL"
        print(f"  level {level} {colour}  on ground {worst:5.2f} {state:5s}"
              f"  ink {ink} ({max(white, black):.2f})")

    print("\n── primary against alert, in degrees of hue ──")
    for p in PALETTES:
        gap = _hue_gap(p["primary"], p["alert"])
        verdict = "same family" if gap < 25 else "distinct"
        print(f"  {p['name']:<16} {gap:4.0f}°  {verdict}")

    weakest = min(
        r for p in PALETTES for what, r, m, o in audit(p) if what != "rule on surface"
    )
    print(f"\nweakest text pair anywhere: {weakest:.2f}  (AA needs {AA_TEXT})")
    print(f"AA text failures: {failures or 'none'}")
    return failures


def _hue_gap(a: str, b: str) -> float:
    """Degrees between two hues — contrast cannot tell red from red."""
    import colorsys

    def hue(hex_colour: str) -> float:
        h = hex_colour.lstrip("#")
        rgb = tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
        return colorsys.rgb_to_hls(*rgb)[0] * 360

    gap = abs(hue(a) - hue(b))
    return min(gap, 360 - gap)


if __name__ == "__main__":
    import sys

    sys.exit(1 if report() else 0)
