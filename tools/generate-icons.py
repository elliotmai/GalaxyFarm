#!/usr/bin/env python3
"""
Raster app icons, drawn from the same geometry as Flying Double M Connected.

Committed as a script rather than the PNGs being hand-made once, because the
mark is a design decision that will be revisited and three icons redrawn by
hand at three sizes drift apart the first time it is. Run it and the set is
regenerated:

    python3 tools/generate-icons.py

The geometry below must stay in step with
`packages/ui/src/brand/logomark.tsx` and `apps/web/app/icon.svg`. A PWA icon
is the one piece of branding somebody looks at every day without ever opening
the app, so it being a slightly different drawing is worse than it looks.

PNG rather than SVG for these. Chrome takes an SVG manifest icon; iOS does not
take one for the home screen at all, and the home screen is where this ends up.
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "apps" / "web" / "public" / "icons"

# Kept identical to theme.css. Literals here because a browser's home screen
# and app switcher paint this with no theme of ours in scope.
GROUND = (14, 16, 38, 255)  # --gf-canvas, midnight nebula
IDENTITY = (157, 133, 232, 255)  # --gf-identity, the mark
INK = (242, 239, 230, 255)  # --gf-text, the sky

# The mark from `logomark.tsx`, in the 100x100 viewBox. The pair and its shared
# leg are drawn; the crests are curves, flattened below.
PAIR = [(22, 77.89), (27.6, 33.09), (38.8, 54.37), (50, 33.09),
        (61.2, 54.37), (72.4, 33.09), (78, 77.89)]
LEG = [(50, 33.09), (50, 77.89)]
CRESTS = [((27.6, 33.09), (18.64, 17.41), (11.92, 24.13)),
          ((72.4, 33.09), (81.36, 17.41), (88.08, 24.13))]
STROKE = 7.84

# Faint stars, so the mark reads as a sky rather than a shape on navy.
SKY = [(17, 20, 1.6, INK), (83, 26, 1.2, INK), (28, 86, 1.1, INK), (88, 82, 1.5, IDENTITY)]

# Supersampled, then reduced. Pillow has no antialiasing on lines, and a mark
# made entirely of diagonals is nothing but places for jaggies to show.
SUPERSAMPLE = 8


def quadratic(start, control, end, steps=64):
    return [
        (
            (1 - t) ** 2 * start[0] + 2 * (1 - t) * t * control[0] + t**2 * end[0],
            (1 - t) ** 2 * start[1] + 2 * (1 - t) * t * control[1] + t**2 * end[1],
        )
        for t in (i / steps for i in range(steps + 1))
    ]


def draw_icon(size, maskable):
    """
    One icon.

    `maskable` inflates the ground and shrinks the mark into the middle 80%,
    which is the safe zone Android crops a maskable icon to. Without it the
    crests lose their tips on a device that prefers circles.
    """
    scale = (size * SUPERSAMPLE) / 100
    canvas = size * SUPERSAMPLE
    image = Image.new("RGBA", (canvas, canvas), GROUND)
    draw = ImageDraw.Draw(image)

    if not maskable:
        # A rounded square for the favicon and the iOS home screen, which do
        # not mask for us. iOS applies its own corner radius on top; drawing
        # ours slightly tighter than theirs keeps the ground from peeking.
        rounded = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
        ImageDraw.Draw(rounded).rounded_rectangle(
            [0, 0, canvas - 1, canvas - 1], radius=int(canvas * 0.22), fill=GROUND
        )
        image = rounded
        draw = ImageDraw.Draw(image)

    inset = 0.8 if maskable else 1.0

    def point(x, y):
        centred_x = (x - 50) * inset + 50
        centred_y = (y - 50) * inset + 50
        return (centred_x * scale, centred_y * scale)

    for x, y, radius, colour in SKY:
        cx, cy = point(x, y)
        r = radius * scale * inset
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=colour)

    # Every stroke, then a disc at every vertex of it. The discs are not only
    # for the round ends: Pillow leaves a wedge open on the outside of each
    # turn, which on a flattened curve is a row of them, and the crests come
    # out visibly serrated without this.
    width = max(1, round(STROKE * scale * inset))
    cap = STROKE / 2 * scale * inset
    runs = [[point(x, y) for x, y in PAIR], [point(x, y) for x, y in LEG]]
    runs += [[point(x, y) for x, y in quadratic(*crest)] for crest in CRESTS]

    for run in runs:
        draw.line(run, fill=IDENTITY, width=width, joint="curve")
        for cx, cy in run:
            draw.ellipse([cx - cap, cy - cap, cx + cap, cy + cap], fill=IDENTITY)

    return image.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    for size in (192, 512):
        draw_icon(size, maskable=False).save(OUT / f"icon-{size}.png")
        draw_icon(size, maskable=True).save(OUT / f"icon-{size}-maskable.png")

    # iOS home screen. 180 is the size it actually asks for.
    draw_icon(180, maskable=False).save(ROOT / "apps" / "web" / "app" / "apple-icon.png")

    print(f"Wrote icons to {OUT} and apps/web/app/apple-icon.png")


if __name__ == "__main__":
    main()
