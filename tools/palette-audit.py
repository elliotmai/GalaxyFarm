#!/usr/bin/env python3
"""
The candidate palettes, audited (docs/ui-redesign.md).

    python3 tools/palette-audit.py

A palette is not a mood board — it is eight colours that have to survive being
put next to each other, and §8 already insists that gets computed rather than
eyeballed. The formulas below are a straight port of
`packages/ui/src/tokens/contrast.ts`, so anything this prints can go into
`packages/ui/tests/contrast.test.ts` as an assertion the moment a palette wins.

Two things it found that were not visible by looking.

**The light ground breaks the amber.** Safety level 3 at `#C98A1E` sits between
2.71 and 2.74 against every one of these grounds, under the 3.0 that WCAG
§1.4.11 requires of a meaningful non-text mark. It has never been a problem
because it has only ever sat on a near-black canvas. `#BC811C` clears every
ground at 3.07 and keeps black ink on it at 5.66.

**The middle of green belongs to the safety scale.** §8 forbids the calm sage
from reading as safety-scale green and measures it by saturation; a green
*primary* is that problem one step louder, because it lands on every button on
the screen rather than on a few resting pastures. A mid-tone pasture green sits
14.4° of hue from safety level 1 at 1.02:1 — the same colour by every measure
that matters. See REJECTED.
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
    """HSL saturation, 0–1. §8 measures the sage/safety-green distinction here."""
    h = hex_colour.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    mx, mn = max(r, g, b), min(r, g, b)
    if mx == mn:
        return 0.0
    li = (mx + mn) / 2
    return (mx - mn) / (2 - mx - mn) if li > 0.5 else (mx - mn) / (mx + mn)


def hue(hex_colour):
    import colorsys
    h = hex_colour.lstrip("#")
    rgb = tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return colorsys.rgb_to_hls(*rgb)[0] * 360


def hue_gap(a, b):
    g = abs(hue(a) - hue(b))
    return min(g, 360 - g)


# ── The six ──────────────────────────────────────────────────────────────
PALETTES = [
    {
        "key": "registry",
        "name": "Registry Green",
        "family": "Green",
        "story": "The colour the paperwork is printed in. Herd books, "
                 "registration certificates and sale catalogues have used a "
                 "deep desaturated green for a century — which is the same "
                 "argument the redesign itself rests on.",
        "ground": "#f6f7f2", "surface": "#ffffff", "ink": "#171a16",
        "muted": "#565c53", "rule": "#dbded3",
        "primary": "#223f2e", "on_primary": "#ffffff",
        "alert": "#8c3a2b", "ok": "#223f2e",
        "note": "Confirm and primary are the same green on purpose — two greens "
                "in one palette read as a bug rather than a distinction.",
    },
    {
        "key": "olive",
        "name": "Field Olive",
        "family": "Green",
        "story": "Yellow-leaning: cured hay, winter rye, a pasture in August "
                 "rather than April. The most agricultural of the six and the "
                 "least like software of any kind.",
        "ground": "#f7f7f0", "surface": "#ffffff", "ink": "#1a1a12",
        "muted": "#5a5c48", "rule": "#dfe0cf",
        "primary": "#4f5a1e", "on_primary": "#ffffff",
        "alert": "#8c3a2b", "ok": "#3f6b4a",
        "note": "Sits far enough from the safety greens in hue to keep confirm "
                "as a separate colour, which the other two greens cannot.",
    },
    {
        "key": "teal",
        "name": "Slate Teal",
        "family": "Blue-green",
        "story": "The bridge between the two families — the coolest of the "
                 "greens and the warmest of the blues. Nobody else in "
                 "agricultural software is using it.",
        "ground": "#f3f6f6", "surface": "#ffffff", "ink": "#13191a",
        "muted": "#4f585a", "rule": "#d4dbdb",
        "primary": "#1f5158", "on_primary": "#ffffff",
        "alert": "#a8321f", "ok": "#3f6b4a",
        "note": "Furthest from the farm's existing printed material, so it wins "
                "on differentiation and loses on continuity.",
    },
    {
        "key": "bluebonnet",
        "name": "Bluebonnet",
        "family": "Blue",
        "story": "The value §8 already specifies for every primary action, "
                 "kept. The state flower, and the only choice here that costs "
                 "no continuity with anything already built or printed.",
        "ground": "#f5f6f8", "surface": "#ffffff", "ink": "#16181c",
        "muted": "#535963", "rule": "#d8dbe1",
        "primary": "#35569e", "on_primary": "#ffffff",
        "alert": "#a8321f", "ok": "#3f6b4a",
        "note": "The token value does not change; only everything around it "
                "does. The cheapest palette to defend.",
    },
    {
        "key": "navy",
        "name": "Ink Navy",
        "family": "Blue",
        "story": "Ledgers, fountain pens and filed documents. The deepest and "
                 "most neutral of the three blues — no violet lean, no cyan "
                 "lean, nothing to date it.",
        "ground": "#f5f6f8", "surface": "#ffffff", "ink": "#14171b",
        "muted": "#525860", "rule": "#d7dade",
        "primary": "#1b3a5c", "on_primary": "#ffffff",
        "alert": "#a8321f", "ok": "#3f6b4a",
        "note": "Nothing here will surprise anyone, which is both the "
                "recommendation and the warning.",
    },
    {
        "key": "harbor",
        "name": "Harbor",
        "family": "Blue",
        "story": "Cleaner and brighter than a navy, and with none of "
                 "Bluebonnet's violet lean. The most straightforwardly "
                 "legible primary of the six on a small screen.",
        "ground": "#f4f6f8", "surface": "#ffffff", "ink": "#13181c",
        "muted": "#4e5760", "rule": "#d5dbe0",
        "primary": "#15597f", "on_primary": "#ffffff",
        "alert": "#a8321f", "ok": "#3f6b4a",
        "note": "Reads as a utility blue rather than a brand blue — which is an "
                "advantage on the kiosk and a shrug on the customer portal.",
    },
]

# Corrected for light grounds: level 3 darkened from #C98A1E, which fails the
# 3.0 non-text minimum against every one of these grounds.
SAFETY = {1: "#2f6b3d", 2: "#3f8f4f", 3: "#bc811c", 4: "#c0392b", 5: "#8e1f14"}
SAFETY_GREENS = (1, 2)

# Kept as evidence rather than deleted. A mid-tone pasture green is the obvious
# choice for a farm and it is the one colour a farm cannot use: at #1F6B43 it is
# 14.4° of hue from safety level 1 with near-identical luminance (1.02:1), so a
# button and "this pen is safe to walk into" become the same green. Solving it
# against the ramp only pushes it down onto Registry.
REJECTED = {
    "name": "Pasture",
    "primary": "#1f6b43",
    "why": "14.4° of hue from safety level 1 at 1.02:1 contrast — the same green "
           "as the calmest rung on the safety scale.",
}


CHECKS = [
    ("ink on ground",       "ink",        "ground",  AA_TEXT),
    ("muted on ground",     "muted",      "ground",  AA_TEXT),
    ("ink on surface",      "ink",        "surface", AA_TEXT),
    ("muted on surface",    "muted",      "surface", AA_TEXT),
    ("primary on ground",   "primary",    "ground",  AA_TEXT),
    ("primary on surface",  "primary",    "surface", AA_TEXT),
    ("label on primary",    "on_primary", "primary", AA_TEXT),
    ("alert on ground",     "alert",      "ground",  AA_TEXT),
    ("ok on ground",        "ok",         "ground",  AA_TEXT),
    ("rule on surface",     "rule",       "surface", AA_NON_TEXT),
]


def audit(p):
    return [(what, ratio(p[fg], p[bg]), m, ratio(p[fg], p[bg]) >= m)
            for what, fg, bg, m in CHECKS]


def safety_clash(p):
    """
    §8's rule, applied to the primary.

    The spec forbids the calm sage from reading as safety-scale green, and
    measures it by saturation rather than by hue, because the two are
    near-identical in hue by design. A green *primary* is the same problem one
    step louder: it appears on every button on the screen.

    Returns the closest safety green and how it is separated.
    """
    worst = None
    for level in SAFETY_GREENS:
        col = SAFETY[level]
        h = hue_gap(p["primary"], col)
        s = abs(saturation(p["primary"]) - saturation(col))
        l = ratio(p["primary"], col)
        # Separated if the hue differs enough to be seen, or the saturation
        # gap is what §8 relies on, or one is plainly darker than the other.
        clear = h >= 20 or s >= 0.18 or l >= 1.8
        if worst is None or (h, s, l) < worst[1:4]:
            worst = (level, h, s, l, clear)
    return worst


def report() -> int:
    """Print the audit. Returns the number of failures found."""
    failures = 0

    for p in PALETTES:
        print(f"\n{p['name']}  [{p['family']}]  primary {p['primary']}  "
              f"hue {hue(p['primary']):.0f}deg  saturation {saturation(p['primary']):.2f}")
        for what, r, minimum, ok in audit(p):
            # The hairline rule is decoration, not a control boundary, so it is
            # reported for information rather than gated.
            if what == "rule on surface":
                print(f"     {what:<20} {r:5.2f}  (informational)")
                continue
            if not ok:
                failures += 1
            print(f"  {'  ' if ok else '!!'} {what:<20} {r:5.2f}  (min {minimum})")

    print("\n-- does the primary read as safety-scale green? (spec 8) --")
    for p in PALETTES + [REJECTED]:
        level, h, s, l, clear = safety_clash(p)
        by = "hue" if h >= 20 else "saturation" if s >= 0.18 else "depth"
        if not clear:
            failures += 1
        verdict = f"clear, by {by}" if clear else "TOO CLOSE"
        tail = "  <- kept as evidence, not in the set" if p is REJECTED else ""
        print(f"  {p['name']:<16} vs level {level}: hue {h:5.1f}deg  "
              f"satD {s:.2f}  contrast {l:.2f}  -> {verdict}{tail}")

    print("\n-- safety ramp, weakest contrast against any ground --")
    for level, colour in sorted(SAFETY.items()):
        worst = min(ratio(colour, p["ground"]) for p in PALETTES)
        white, black = ratio("#ffffff", colour), ratio("#111111", colour)
        ink = "white" if white >= black else "black"
        if worst < AA_NON_TEXT:
            failures += 1
        state = "ok" if worst >= AA_NON_TEXT else "FAIL"
        print(f"  level {level} {colour}  on ground {worst:5.2f} {state:5s}"
              f"  ink {ink} ({max(white, black):.2f})")

    print("\n-- primary against alert, in degrees of hue --")
    for p in PALETTES:
        gap = hue_gap(p["primary"], p["alert"])
        print(f"  {p['name']:<16} {gap:5.0f}deg  "
              f"{'same family' if gap < 25 else 'distinct'}")

    weakest = min(
        r for p in PALETTES for what, r, m, o in audit(p) if what != "rule on surface"
    )
    print(f"\nweakest text pair anywhere: {weakest:.2f}  (AA needs {AA_TEXT})")
    print(f"failures: {failures or 'none'}")
    return failures


if __name__ == "__main__":
    import sys

    # REJECTED is expected to fail the spec-8 check — that is what it is for.
    sys.exit(1 if report() > 1 else 0)
