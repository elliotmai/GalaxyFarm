#!/usr/bin/env python3
"""Brandable-geometry check for the Double M marks.

Rules follow TSCRA's brand-design guidance and standard iron-making practice:

  - Brands read left to right, top to bottom, outside in. Joined characters are
    read "connected".
  - Keep it simple. A brand is 2 or more units; many have 3; few have more.
  - Sharp corners trap heat. Letters with them -- A, K, V, M, N, X, Y, Z -- are
    made with a 1/4" gap where the corners meet, and notches roughly 1/4" wide
    and deep are cut wherever bars join or intersect, so heat can escape. The
    notch is cut into the FACE; the bar behind stays continuous, so a notched
    corner does not make it a second piece of iron.
  - Closed counters (B, O, R, 8, 6, 9) need a gap cut for the same reason.
  - Face of the bar 1/4" to 1/2" wide, edges slightly rounded.
  - Characters about 4" x 3" for calves, 6" x 3.5" for grown cattle.
  - At least 1" between characters, and between any two parallel lines.

Everything below is expressed against a letter height of 100, so a 4" character
puts 1" at 25 units and 1/4" at 6.25.

Run to re-verify every number quoted in concepts.html and regenerate its path
data:

    python3 iron-check.py
"""
import math, json, os

# ---------------------------------------------------------------------------
# Constants, per 100 units of letter height (a 4 inch character)
# ---------------------------------------------------------------------------

BAR      = 10.0     # face width; 1/4"-1/2" on a 4" character is 6.25%-12.5%
NOTCH    = 6.25     # 1/4" -- the gap left at a sharp corner or a joint
MIN_SEP  = 25.0     # 1"   -- between characters, and between parallel lines
SPREAD   = 1.7      # the scar spreads to about this much of the bar face
SHARP    = 90.0     # corners under this get a notch filed in the iron's face
BEND_R   = 10.0     # corner radius, capped per-corner so it cannot eat the letter
MAX_UNITS = 3       # "few brands have more than 3 units"


def _n(v):
    l = math.hypot(*v)
    return (v[0]/l, v[1]/l)

def _ang(P, A, B):
    u, v = _n((A[0]-P[0], A[1]-P[1])), _n((B[0]-P[0], B[1]-P[1]))
    return math.degrees(math.acos(max(-1, min(1, u[0]*v[0] + u[1]*v[1]))))


# ---------------------------------------------------------------------------
# Drawing: sharp corners break, gentle ones bend
# ---------------------------------------------------------------------------

def unpack(piece):
    """A piece is a polyline, optionally tagged (pts, notch_start, notch_end)
       where an end abuts another bar and so needs its own filed notch."""
    if piece and isinstance(piece[0], (list, tuple)) and len(piece) == 3 \
       and isinstance(piece[1], bool):
        return piece[0], piece[1], piece[2]
    return piece, False, False


def render(piece, r=BEND_R, gap=NOTCH, sharp=SHARP):
    """Polyline -> SVG path, continuous, every corner attached and rounded.

    The bar runs through a corner without a break -- a brand is one unbroken
    drawing, and rounded angles are what the trade calls a `running` letter.
    The 1/4" notch is real but it is a cut in the FACE of the iron, a groove
    that lets heat out; it is not a gap in the design and does not appear here.

    Radius is capped at a quarter of the shorter arm so an acute corner is
    softened rather than swallowed -- the mistake an earlier pass made when it
    let a fixed radius eat the letterforms."""
    pts, ns, ne = unpack(piece)
    d = [f"M{pts[0][0]:.1f} {pts[0][1]:.1f}"]
    for i in range(1, len(pts)-1):
        P, A, B = pts[i], pts[i-1], pts[i+1]
        th = _ang(P, A, B)
        u, v = _n((A[0]-P[0], A[1]-P[1])), _n((B[0]-P[0], B[1]-P[1]))
        half = math.tan(math.radians(th)/2)
        t = min(r/half, 0.25*min(math.dist(P, A), math.dist(P, B)))
        rr = t*half
        sw = 1 if (u[0]*v[1] - u[1]*v[0]) > 0 else 0
        d.append(f"L{P[0]+u[0]*t:.1f} {P[1]+u[1]*t:.1f}")
        d.append(f"A{rr:.1f} {rr:.1f} 0 0 {sw} {P[0]+v[0]*t:.1f} {P[1]+v[1]*t:.1f}")
    d.append(f"L{pts[-1][0]:.1f} {pts[-1][1]:.1f}")
    return " ".join(d)


# ---------------------------------------------------------------------------
# Measuring
# ---------------------------------------------------------------------------

def _seg_dist(p1, p2, p3, p4):
    def pt_seg(p, a, b):
        vx, vy = b[0]-a[0], b[1]-a[1]
        L = vx*vx + vy*vy
        t = 0 if L == 0 else max(0, min(1, ((p[0]-a[0])*vx + (p[1]-a[1])*vy)/L))
        return math.hypot(p[0]-(a[0]+t*vx), p[1]-(a[1]+t*vy))
    d1 = (p2[0]-p1[0], p2[1]-p1[1]); d2 = (p4[0]-p3[0], p4[1]-p3[1])
    den = d1[0]*d2[1] - d1[1]*d2[0]
    if abs(den) > 1e-9:
        t = ((p3[0]-p1[0])*d2[1] - (p3[1]-p1[1])*d2[0]) / den
        s = ((p3[0]-p1[0])*d1[1] - (p3[1]-p1[1])*d1[0]) / den
        if 0 <= t <= 1 and 0 <= s <= 1:
            return 0.0
    return min(pt_seg(p1,p3,p4), pt_seg(p2,p3,p4), pt_seg(p3,p1,p2), pt_seg(p4,p1,p2))


def check(pieces, units):
    """Returns (ok, problems, stats). Sharp corners are fine here -- they get
       notched by render() -- so what is checked is spacing, and that no two
       separate runs of bar come closer than an inch without actually joining."""
    probs, notched = [], 0
    segs, arc = [], {}
    for pi, piece in enumerate(pieces):
        pts, _, _ = unpack(piece)
        run = 0.0
        for i in range(len(pts)-1):
            segs.append((pi, i, pts[i], pts[i+1]))
            arc[(pi, i)] = run
            run += math.dist(pts[i], pts[i+1])
        for i in range(1, len(pts)-1):
            if _ang(pts[i], pts[i-1], pts[i+1]) < SHARP:
                notched += 1

    worst = 1e9
    for a in range(len(segs)):
        for b in range(a+1, len(segs)):
            pa, ia, s1, e1 = segs[a]; pb, ib, s2, e2 = segs[b]
            if pa == pb and (abs(ia-ib) <= 1
                             or abs(arc[(pa, ia)] - arc[(pb, ib)]) < 2.5*MIN_SEP):
                continue
            d = _seg_dist(s1, e1, s2, e2)
            # A notch is a deliberate gap between two bar ENDS at a joint. Two
            # lines *running* close is the fault; two ends facing each other
            # across a filed notch is the fix, so only flag the former.
            ends = min(math.dist(a, b) for a in (s1, e1) for b in (s2, e2))
            if d <= 1.6*NOTCH and abs(ends - d) < 0.5:
                continue
            worst = min(worst, d)
            if 0.01 < d < MIN_SEP:
                probs.append(f"two lines run {d:.1f} apart, under the {MIN_SEP:.0f} minimum")

    if units > MAX_UNITS:
        probs.append(f"{units} units -- few brands carry more than {MAX_UNITS}")

    seen, out = set(), []
    for p in probs:
        if p not in seen: seen.add(p); out.append(p)
    return (not out), out, {"notches": notched, "closest": round(worst, 1) if worst < 1e9 else None}


# ---------------------------------------------------------------------------
# The marks. Normal letterforms -- the notch does the work, not the shape.
# ---------------------------------------------------------------------------

H, MW = 100.0, 72.0          # 4" tall, 3" wide: the character size TSCRA gives
VD    = 0.58*H               # how far the middle of the M descends

def M(x, y=0.0, w=MW, h=H, vd=None):
    """A plain M. Vertical legs, pointed apexes, pointed valley -- every one of
       those corners gets a notch when it is drawn."""
    vd = VD if vd is None else vd*h/H
    return [(x, y+h), (x, y), (x+w/2, y+vd), (x+w, y), (x+w, y+h)]

def M_connected(x, y=0.0, w=MW, h=H):
    """Two M's sharing their middle leg -- read 'connected'. The shared leg is a
       spur off the zigzag, welded and notched at the top, because a bar cannot
       run down a line and back up it."""
    vd = VD*h/H
    zig = [(x, y+h), (x, y), (x+w/2, y+vd), (x+w, y),
           (x+1.5*w, y+vd), (x+2*w, y), (x+2*w, y+h)]
    leg = [(x+w, y), (x+w, y+h)]                  # welded at the apex
    return [zig, leg]

def rocker(x0, x1, y, sag, n=12):
    c, hw = (x0+x1)/2, (x1-x0)/2
    return [(x0+(x1-x0)*i/n, y+sag*(1-((x0+(x1-x0)*i/n-c)/hw)**2)) for i in range(n+1)]

def bar(x0, x1, y):
    return [(x0, y), (x1, y)]

GAPC = MIN_SEP               # an inch between characters

# Named in brand grammar -- modifier first, letter last -- rather than by the
# numbering the earlier sheets used. See README for what happened to each of
# those. Overlapped and Double-struck are absent on purpose: both put lines
# closer than the 1" minimum by definition, so neither can be made.
SPEC = [
 ("Rocking Double M",           2 + 1,
  lambda: [M(0), M(MW+GAPC)] + [rocker(-14, 2*MW+GAPC+14, H+MIN_SEP, 22)]),
 ("Double M",                   2,
  lambda: [M(0), M(MW+GAPC)]),
 ("Bar Double M",               2 + 1,
  lambda: [M(0), M(MW+GAPC)] + [bar(-10, 2*MW+GAPC+10, -MIN_SEP)]),
 ("Rocking Connected Double M", 1 + 1,
  lambda: M_connected(0) + [rocker(-14, 2*MW+14, H+MIN_SEP, 22)]),
 ("Connected Double M",         1,
  lambda: M_connected(0)),
 ("Bar Connected Double M",     1 + 1,
  lambda: M_connected(0) + [bar(-10, 2*MW+10, -MIN_SEP)]),
 ("Dropped Double M",           2,
  lambda: [M(0), M(MW+GAPC, MIN_SEP)]),
 ("Dam and Calf Double M",      2,
  lambda: [M(0), M(MW+GAPC, H*0.30, MW*0.70, H*0.70)]),
 ("Lazy Double M",              2,
  lambda: [[(y, x) for (x, y) in M(0)], [(y, x) for (x, y) in M(MW+GAPC)]]),
]

def fit(pieces, pad=BAR/2+3):
    flat = [unpack(pc)[0] for pc in pieces]
    xs = [q[0] for pc in flat for q in pc]; ys = [q[1] for pc in flat for q in pc]
    x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
    out = []
    for pc in pieces:
        pts, ns, ne = unpack(pc)
        moved = [(q[0]-x0+pad, q[1]-y0+pad) for q in pts]
        out.append((moved, ns, ne) if (ns or ne) else moved)
    return out, f"0 0 {round(x1-x0+2*pad)} {round(y1-y0+2*pad)}"


if __name__ == "__main__":
    OUT, allok = {}, True
    for name, units, build in SPEC:
        pieces, vb = fit(build())
        ok, probs, st = check(pieces, units)
        allok &= ok
        w, h = vb.split()[2], vb.split()[3]
        print(f"{'OK ' if ok else 'XX '}{name:30s} {w:>3s}x{h:<3s} "
              f"ratio={int(w)/int(h):.2f} units={units} filed-corners={st['notches']} "
              f"closest={st['closest']}")
        for p in probs[:3]:
            print(f"        - {p}")
        OUT[name] = (vb, [render(pc) for pc in pieces], units, st['notches'])
    print(f"\nall pass: {allok}   (bar {BAR}, notch {NOTCH}, min spacing {MIN_SEP}, "
          f"per 100 units of letter height)")
    if allok:
        here = os.path.dirname(os.path.abspath(__file__))
        json.dump(OUT, open(os.path.join(here, "paths.json"), "w"), indent=1)
        print("wrote paths.json")
