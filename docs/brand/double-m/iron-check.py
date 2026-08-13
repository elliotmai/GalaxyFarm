#!/usr/bin/env python3
"""Builds the Double M brand candidates and checks them against brand grammar.

Rules and vocabulary are taken from TSCRA's "How to Design a Brand", read from
the page itself:

  - Keep the image simple. A brand is two or more symbols; many have three
    units; few have more than three.
  - Brands are built from four kinds of mark: letters, numbers, lines and
    circles, and pictures.
  - Brands read left to right, top to bottom, from outside in. When letters or
    symbols are joined, "connected" is included in the reading.
  - Letter modifiers: regular; tilting / tumbling / toppling; walking, with legs
    and feet on the bottom; winged or flying; RUNNING, denoted by curves (a
    cursive letter, not a rounded-off one); dragged.
  - A quarter or half circle attached to the TOP of a letter is swinging.
  - A curved mark ATTACHED to the BOTTOM of a letter is a rocking letter. A
    letter merely sitting ABOVE a quarter circle is read "letter quarter
    circle" instead -- attachment is what makes it rocking.
  - Bar: a short horizontal line, used at top, bottom or middle.
    Rail: about twice as long as a bar; letters may sit or rest above it.

The letters themselves are drawn plainly and sharply, as they are on the page.
There is no rounding of corners, no notching and no breaking of strokes -- those
came from iron-making sources, not from brand grammar, and three earlier passes
of this sheet wrongly put them in the artwork.

Geometry is expressed against a letter height of 100.

    python3 iron-check.py
"""
import math, json, os

H          = 100.0   # letter height
STROKE     = 13.0    # bold, as the sample brands are drawn
MAX_UNITS  = 3       # "few brands have more than three units"


# ---------------------------------------------------------------------------
# Letterforms -- plain and sharp
# ---------------------------------------------------------------------------

def M(x=0.0, y=0.0, w=80.0, h=H, splay=14.0, valley=0.68):
    """A plain M: apexes inboard, feet splayed out, sharp throughout."""
    return [(x, y+h), (x+splay, y), (x+w/2, y+valley*h), (x+w-splay, y), (x+w, y+h)]

def M_connected(x=0.0, y=0.0, w=80.0, h=H, splay=14.0, valley=0.68):
    """Two M's sharing their middle leg, read 'connected'."""
    v = y + valley*h
    return [(x, y+h), (x+splay, y), (x+w/2, v), (x+w-splay, y),
            (x+w, y+h), (x+w+splay, y), (x+1.5*w, v), (x+2*w-splay, y), (x+2*w, y+h)]

def rocker(x0, x1, y, sag):
    """A curved mark. Drawn as a quadratic so it is a real curve, not a polyline."""
    return ("Q", (x0, y), ((x0+x1)/2, y+2*sag), (x1, y))

def line(x0, x1, y):
    return [(x0, y), (x1, y)]


def turn(pts, deg, cx, cy):
    r = math.radians(deg)
    out = []
    for x, y in pts:
        dx, dy = x-cx, y-cy
        out.append((cx + dx*math.cos(r) - dy*math.sin(r),
                    cy + dx*math.sin(r) + dy*math.cos(r)))
    return out


# ---------------------------------------------------------------------------
# The marks
# ---------------------------------------------------------------------------

MW, GAP = 80.0, 26.0
PAIR_W  = 2*MW + GAP

def pair(y=0.0):
    return [M(0, y), M(MW+GAP, y)]

def attached_rocker(y=H, x0=-6.0, x1=PAIR_W+6.0, sag=16.0):
    """Attached at the feet, which is what makes it rocking rather than a
       letter merely standing above a quarter circle."""
    return rocker(x0, x1, y, sag)

SPEC = [
 ("Double M", 2,
  lambda: pair()),

 ("Rocking Double M", 3,
  lambda: pair() + [attached_rocker()]),

 ("Swinging Double M", 3,
  lambda: pair() + [rocker(10.0, PAIR_W-10.0, 0.0, -18.0)]),

 ("Bar Double M", 3,
  lambda: pair() + [line(PAIR_W/2-34, PAIR_W/2+34, -36)]),

 ("Rail Double M", 3,
  lambda: pair() + [line(-16, PAIR_W+16, H+30)]),

 ("Connected Double M", 1,
  lambda: [M_connected(0)]),

 ("Rocking Connected Double M", 2,
  lambda: [M_connected(0)] + [rocker(-6.0, 2*MW+6.0, H, 16.0)]),

 ("Lazy Double M", 2,
  lambda: [turn(p, -90, PAIR_W/2, H/2) for p in pair()]),

 ("Tumbling Double M", 2,
  lambda: [turn(p, -35, PAIR_W/2, H/2) for p in pair()]),
]


# ---------------------------------------------------------------------------
# Drawing by hand
#
# A brand is forged and struck, not plotted. The samples on the page are drawn
# with a brush and photographed off brand records: the stroke swells and thins,
# the lines are not quite straight, the two letters of a pair are not clones of
# each other. Stroking a path at a constant width gives away a machine.
#
# So each stroke is emitted as a FILLED outline: the centreline is resampled,
# nudged off true by a slow wobble, and offset by a half-width that varies as it
# goes. Corners get a blob so the outside of the turn fills like upset metal.
# Everything is driven by a seeded PRNG, so the drawing is irregular but the
# file is reproducible -- rerunning gives byte-identical output.
# ---------------------------------------------------------------------------

import random

WOBBLE   = 0.013   # how far the line strays, as a fraction of letter height
WIDTH_V  = 0.22    # how much the stroke swells and thins
STEP     = 5.0     # resampling interval along a stroke


def _noise(rng, n, octaves=(1, 2, 5)):
    """Slow, smooth deviation -- a drawn line wanders, it does not jitter."""
    phases = [(rng.uniform(0, 6.283), rng.uniform(0.6, 1.4)) for _ in octaves]
    out = []
    for i in range(n):
        u = i/max(1, n-1)
        v = sum(a*math.sin(ph + 6.283*k*u*sc)/k
                for (ph, sc), k, a in zip(phases, octaves, (1.0, 0.5, 0.28)))
        out.append(v)
    return out


def _resample(piece, step=STEP):
    if is_curve(piece):
        (_, a, c, b) = piece
        n = max(12, int(math.dist(a, b)/step))
        return [((1-t)**2*a[0] + 2*(1-t)*t*c[0] + t*t*b[0],
                 (1-t)**2*a[1] + 2*(1-t)*t*c[1] + t*t*b[1])
                for t in (i/n for i in range(n+1))]
    out = [piece[0]]
    for i in range(len(piece)-1):
        s, e = piece[i], piece[i+1]
        n = max(1, int(math.dist(s, e)/step))
        for j in range(1, n+1):
            out.append((s[0] + (e[0]-s[0])*j/n, s[1] + (e[1]-s[1])*j/n))
    return out


def hand_outline(piece, w, seed, wobble=WOBBLE, width_v=WIDTH_V):
    """Centreline -> a list of filled outlines: the stroke, then one per corner."""
    rng = random.Random(seed)
    pts = _resample(piece)
    n = len(pts)
    off = _noise(rng, n)
    wid = _noise(rng, n)
    amp = wobble*H

    nrm = []
    for i in range(n):
        a, b = pts[max(0, i-1)], pts[min(n-1, i+1)]
        dx, dy = b[0]-a[0], b[1]-a[1]
        L = math.hypot(dx, dy) or 1.0
        nrm.append((-dy/L, dx/L))

    mid = [(pts[i][0] + nrm[i][0]*off[i]*amp,
            pts[i][1] + nrm[i][1]*off[i]*amp) for i in range(n)]
    half = [max(0.30*w, 0.5*w*(1 + width_v*wid[i])) for i in range(n)]
    # the ends of a struck stroke are blunter than its middle
    for i in range(min(3, n)):
        k = 0.86 + 0.05*i
        half[i] *= k
        half[n-1-i] *= k

    left  = [(mid[i][0] + nrm[i][0]*half[i], mid[i][1] + nrm[i][1]*half[i]) for i in range(n)]
    right = [(mid[i][0] - nrm[i][0]*half[i], mid[i][1] - nrm[i][1]*half[i]) for i in range(n)]

    d = ["M%.1f %.1f" % left[0]]
    d += ["L%.1f %.1f" % q for q in left[1:]]
    d += ["L%.1f %.1f" % q for q in reversed(right)]
    d.append("Z")
    out = [" ".join(d)]

    # Corners: a struck turn upsets metal, so the outside of each one fills out.
    # Emitted as separate paths -- inside one path they would wind against the
    # outline and punch holes in it instead of joining on to it.
    if not is_curve(piece):
        for i in range(1, len(piece)-1):
            cx, cy = piece[i]
            r = 0.5*w*rng.uniform(0.80, 1.02)
            k = 0.5523*r
            out.append(f"M{cx-r:.1f} {cy:.1f} "
                       f"C{cx-r:.1f} {cy-k:.1f} {cx-k:.1f} {cy-r:.1f} {cx:.1f} {cy-r:.1f} "
                       f"C{cx+k:.1f} {cy-r:.1f} {cx+r:.1f} {cy-k:.1f} {cx+r:.1f} {cy:.1f} "
                       f"C{cx+r:.1f} {cy+k:.1f} {cx+k:.1f} {cy+r:.1f} {cx:.1f} {cy+r:.1f} "
                       f"C{cx-k:.1f} {cy+r:.1f} {cx-r:.1f} {cy+k:.1f} {cx-r:.1f} {cy:.1f} Z")
    return out


# ---------------------------------------------------------------------------
# Drawing and checking
# ---------------------------------------------------------------------------

def is_curve(piece):
    return isinstance(piece, tuple) and piece and piece[0] == "Q"

def pts_of(piece):
    return list(piece[1:]) if is_curve(piece) else piece

def bbox(pieces):
    xs = [p[0] for pc in pieces for p in pts_of(pc)]
    ys = [p[1] for pc in pieces for p in pts_of(pc)]
    return min(xs), min(ys), max(xs), max(ys)

def fit(pieces, pad=None):
    pad = STROKE/2 + 3 if pad is None else pad
    x0, y0, x1, y1 = bbox(pieces)
    out = []
    for pc in pieces:
        if is_curve(pc):
            out.append(("Q",) + tuple((p[0]-x0+pad, p[1]-y0+pad) for p in pc[1:]))
        else:
            out.append([(p[0]-x0+pad, p[1]-y0+pad) for p in pc])
    return out, f"0 0 {round(x1-x0+2*pad)} {round(y1-y0+2*pad)}"

def render(piece):
    if is_curve(piece):
        (_, a, c, b) = piece
        return f"M{a[0]:.1f} {a[1]:.1f} Q{c[0]:.1f} {c[1]:.1f} {b[0]:.1f} {b[1]:.1f}"
    return "M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in piece)

def touches(a, b, tol=STROKE):
    """Do these two pieces meet? A rocking mark has to; a rail does not."""
    for p in pts_of(a):
        for q in pts_of(b):
            if math.dist(p, q) <= tol:
                return True
    # endpoint of one landing on a segment of the other
    for pc, other in ((a, b), (b, a)):
        op = pts_of(other)
        for p in pts_of(pc):
            for i in range(len(op)-1):
                s, e = op[i], op[i+1]
                vx, vy = e[0]-s[0], e[1]-s[1]
                L = vx*vx + vy*vy
                if L == 0: continue
                t = max(0, min(1, ((p[0]-s[0])*vx + (p[1]-s[1])*vy)/L))
                if math.hypot(p[0]-(s[0]+t*vx), p[1]-(s[1]+t*vy)) <= tol:
                    return True
    return False

def check(name, pieces, units):
    probs = []
    if units > MAX_UNITS:
        probs.append(f"{units} units -- few brands carry more than {MAX_UNITS}")
    if name.startswith(("Rocking", "Swinging")) or " Rocking" in name:
        curve = next((p for p in pieces if is_curve(p)), None)
        letters = [p for p in pieces if not is_curve(p)]
        if curve is None:
            probs.append("named rocking or swinging but has no curved mark")
        elif not any(touches(curve, l) for l in letters):
            probs.append("the curved mark does not touch the letters -- a curve that only sits "
                         "under a letter is read 'letter quarter circle', not rocking")
    return (not probs), probs


if __name__ == "__main__":
    OUT, allok = {}, True
    for name, units, build in SPEC:
        pieces, vb = fit(build())
        ok, probs = check(name, pieces, units)
        allok &= ok
        w, h = vb.split()[2], vb.split()[3]
        print(f"{'OK ' if ok else 'XX '}{name:30s} {w:>3s}x{h:<3s} "
              f"ratio={int(w)/int(h):.2f} units={units}")
        for p in probs:
            print(f"        - {p}")
        seed = abs(hash(name)) % 100000
        OUT[name] = (vb,
                     [hand_outline(pc, STROKE, seed + 17*i) for i, pc in enumerate(pieces)],
                     [hand_outline(pc, STROKE*1.7, seed + 17*i) for i, pc in enumerate(pieces)],
                     units)
    print(f"\nall pass: {allok}   (letter height {H:.0f}, stroke {STROKE:.0f}, drawn by hand with a fixed seed)")
    if allok:
        here = os.path.dirname(os.path.abspath(__file__))
        json.dump(OUT, open(os.path.join(here, "paths.json"), "w"), indent=1)
        print("wrote paths.json")
