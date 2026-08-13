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
  - Corners are attached and turned through an arc. A round has to be round on
    the INSIDE edge too: the centreline radius must clear half the bar, or the
    inner edge collapses to a cusp and the corner is a point again.
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

BAR      = 7.0      # face width. 1/4" on a 4" character. An earlier pass took this to
                    # 10 because thin strokes "looked light" -- that aesthetic call is
                    # what made a round corner impossible, since the minimum radius
                    # scales with the bar while the letter does not.
NOTCH    = 6.25     # 1/4" -- the gap left at a sharp corner or a joint
MIN_SEP  = 25.0     # 1"   -- between characters, and between parallel lines
SPREAD   = 1.7      # the scar spreads to about this much of the bar face
SHARP    = 90.0     # corners under this get a notch filed in the iron's face
BEND_R   = 7.0      # centreline radius = one bar width, so the inner edge is a real
                    # arc of half a bar and the apex still keeps its point
MAX_UNITS = 3       # "few brands have more than 3 units"
MIN_STRAIGHT = 0.22 # each arm must keep this much straight run, or the corners
                    # meet and the letter turns into an arch


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


def corners(pts, r=BEND_R):
    """Per-vertex (angle, tangent length, centreline radius).

    Adjacent corners share the arm between them, so the tangents are budgeted
    against that arm rather than capped at a flat fraction of it. Capping each
    corner independently is what drove the radius below half the bar and left
    every M apex a cusp -- attached, but not round."""
    n = len(pts)
    ang = [0.0]*n
    t   = [0.0]*n
    for i in range(1, n-1):
        ang[i] = _ang(pts[i], pts[i-1], pts[i+1])
        t[i] = r / math.tan(math.radians(ang[i])/2)
    for _ in range(3):
        for i in range(n-1):
            arm = math.dist(pts[i], pts[i+1])
            need = t[i] + t[i+1]
            if need > 0.9*arm and need > 0:
                k = 0.9*arm/need
                if i > 0:     t[i]   *= k
                if i+1 < n-1: t[i+1] *= k
    rr = [t[i]*math.tan(math.radians(ang[i])/2) if ang[i] else 0.0 for i in range(n)]
    return ang, t, rr


def render(piece, r=BEND_R):
    """Polyline -> SVG path. One unbroken run, every corner attached and turned
       through a real arc -- round on the inside edge as well as the outside.

       The 1/4" notch is real but it is a groove cut in the FACE of the iron so
       heat can escape a corner. It is a fabrication detail, not a gap in the
       design, and it is not drawn."""
    pts, ns, ne = unpack(piece)
    ang, t, rr = corners(pts, r)
    d = [f"M{pts[0][0]:.1f} {pts[0][1]:.1f}"]
    for i in range(1, len(pts)-1):
        P, A, B = pts[i], pts[i-1], pts[i+1]
        u, v = _n((A[0]-P[0], A[1]-P[1])), _n((B[0]-P[0], B[1]-P[1]))
        sw = 1 if (u[0]*v[1] - u[1]*v[0]) > 0 else 0
        d.append(f"L{P[0]+u[0]*t[i]:.1f} {P[1]+u[1]*t[i]:.1f}")
        d.append(f"A{rr[i]:.1f} {rr[i]:.1f} 0 0 {sw} {P[0]+v[0]*t[i]:.1f} {P[1]+v[1]*t[i]:.1f}")
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
        ang, t2, rr = corners(pts)
        for i in range(1, len(pts)-1):
            if ang[i] < SHARP:
                notched += 1
            inner = rr[i] - BAR/2
            if inner <= 0:
                probs.append(f"corner at ({pts[i][0]:.0f},{pts[i][1]:.0f}) is a cusp on the inside "
                             f"edge -- centre radius {rr[i]:.1f} against a {BAR/2:.1f} half-bar")
            elif inner < BAR/2 - 1e-6:
                probs.append(f"corner at ({pts[i][0]:.0f},{pts[i][1]:.0f}) turns too tight -- "
                             f"inner radius {inner:.1f}, want {BAR/2:.1f}")
        for i in range(len(pts)-1):
            arm = math.dist(pts[i], pts[i+1])
            left = (arm - t2[i] - t2[i+1]) / arm
            if left < MIN_STRAIGHT:
                probs.append(f"arm ({pts[i][0]:.0f},{pts[i][1]:.0f})-({pts[i+1][0]:.0f},"
                             f"{pts[i+1][1]:.0f}) is {left:.0%} straight -- under {MIN_STRAIGHT:.0%}, "
                             f"the corners meet and it reads as an arch, not a letter")

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

H, MW = 100.0, 84.0          # the M is wider than a 4x3 character, and has to be:
                             # the bar needs room to turn, and a narrower M leaves no
                             # straight run between the arcs -- it reads as an arch
VD    = 0.42*H               # a 45 degree apex: deep enough to read as an M, open
                             # enough that rounding the corner does not eat the peak

def M(x, y=0.0, w=MW, h=H, vd=VD):
    """A plain M: upright legs, apexes and valley turned through real arcs.

       Width and valley depth are given outright rather than scaled from the
       height, because the bar does not shrink with the letter. A smaller M has
       to be squatter -- a shallower, wider valley opens the apex enough for the
       bar to get round it."""
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
  lambda: [M(0), M(MW+GAPC, H*0.20, w=78, h=80, vd=40)]),
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
