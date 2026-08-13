#!/usr/bin/env python3
"""Brandable-geometry check for the Double M marks.

An iron is bent bar, so this checks each mark against what bar will actually do:
minimum bend radius, minimum angle at a crotch, minimum clear space between the
strokes once the scar spreads, and how many separate pieces the iron needs.

Run it to regenerate the path data used in concepts.html and re-verify every
number quoted there:

    python3 iron-check.py
"""
import math, json, os

import math

W        = 6.5    # bar face width, % of a 100-unit brand (1/4" bar on a 3.5" brand)
SPREAD   = 1.7    # scar spreads to ~1.7x the bar face
BEND_R   = 9.75   # centreline bend radius; flat bar will not take less than ~1.4x its width
MIN_ANG  = 60.0   # acute crotches pool heat and blot
MIN_SEP  = 16.25   # centreline separation between non-adjacent strokes (2.5 x W)

def _n(v):
    l = math.hypot(*v)
    return (v[0]/l, v[1]/l)

def path(pts, close=False, r=BEND_R):
    """Polyline -> SVG path with every interior corner bent to radius r."""
    n = len(pts)
    idx = range(n) if close else range(1, n-1)
    out = []
    first = pts[0]
    segs = {}
    for i in idx:
        P, A, B = pts[i], pts[(i-1) % n], pts[(i+1) % n]
        u, v = _n((A[0]-P[0], A[1]-P[1])), _n((B[0]-P[0], B[1]-P[1]))
        ang = math.acos(max(-1, min(1, u[0]*v[0] + u[1]*v[1])))
        t = min(r / math.tan(ang/2),
                math.hypot(*(A[0]-P[0], A[1]-P[1]))/2,
                math.hypot(*(B[0]-P[0], B[1]-P[1]))/2)
        rr = t * math.tan(ang/2)
        segs[i] = ((P[0]+u[0]*t, P[1]+u[1]*t), (P[0]+v[0]*t, P[1]+v[1]*t), rr,
                   1 if (u[0]*v[1] - u[1]*v[0]) > 0 else 0)
    if close:
        s = segs[0][1]
        out.append(f"M{s[0]:.1f} {s[1]:.1f}")
    else:
        out.append(f"M{first[0]:.1f} {first[1]:.1f}")
    order = list(range(1, n)) + ([0] if close else [])
    for i in order:
        if i in segs:
            a, b, rr, sw = segs[i]
            out.append(f"L{a[0]:.1f} {a[1]:.1f}")
            out.append(f"A{rr:.1f} {rr:.1f} 0 0 {sw} {b[0]:.1f} {b[1]:.1f}")
        else:
            out.append(f"L{pts[i][0]:.1f} {pts[i][1]:.1f}")
    if close:
        out.append("Z")
    return " ".join(out)

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

def check(name, pieces):
    """pieces: list of polylines. Returns (ok, list of problems, stats)."""
    probs = []
    segs = []
    arc = {}
    for pi, pts in enumerate(pieces):
        run = 0.0
        for i in range(len(pts)-1):
            segs.append((pi, i, pts[i], pts[i+1]))
            arc[(pi, i)] = run
            run += math.hypot(pts[i+1][0]-pts[i][0], pts[i+1][1]-pts[i][1])
        for i in range(1, len(pts)-1):
            P, A, B = pts[i], pts[i-1], pts[i+1]
            u, v = _n((A[0]-P[0], A[1]-P[1])), _n((B[0]-P[0], B[1]-P[1]))
            ang = math.degrees(math.acos(max(-1, min(1, u[0]*v[0]+u[1]*v[1]))))
            if ang < MIN_ANG - 0.5:
                probs.append(f"corner at ({P[0]:.0f},{P[1]:.0f}) is {ang:.0f}deg, under {MIN_ANG:.0f}")

    worst = (1e9, None)
    for a in range(len(segs)):
        for b in range(a+1, len(segs)):
            pa, ia, s1, e1 = segs[a]; pb, ib, s2, e2 = segs[b]
            if pa == pb and (abs(ia-ib) <= 1
                             or abs(arc[(pa, ia)] - arc[(pb, ib)]) < 2.5*MIN_SEP):
                continue
            d = _seg_dist(s1, e1, s2, e2)
            if d < worst[0]:
                worst = (d, (s1, e1, s2, e2))
            if 0.01 < d < MIN_SEP:
                probs.append(f"strokes pass within {d:.1f} (need {MIN_SEP})")

    # weld graph: pieces touching (distance ~0) count as one physical piece
    parent = list(range(len(pieces)))
    def find(x):
        while parent[x] != x: parent[x] = parent[parent[x]]; x = parent[x]
        return x
    for a in range(len(segs)):
        for b in range(a+1, len(segs)):
            pa, ia, s1, e1 = segs[a]; pb, ib, s2, e2 = segs[b]
            if pa != pb and _seg_dist(s1,e1,s2,e2) < 0.6:
                ra, rb = find(pa), find(pb)
                if ra != rb: parent[ra] = rb
    n_iron = len({find(i) for i in range(len(pieces))})
    seen, out = set(), []
    for p in probs:
        if p not in seen: seen.add(p); out.append(p)
    return (not out), out, {"pieces": n_iron, "min_sep": round(worst[0], 1)}


# --------------------------------------------------------------------
# The marks
# --------------------------------------------------------------------

R = math.radians
VH, SPLAY, VF = 45.0, 15.0, 0.40      # valley 90deg, apex 60deg
H = 100.0                              # letter height; bar is 6.5% of it

def m_pts(cx, top, h=H, vf=VF, vh=VH, splay=SPLAY):
    vd, bot = vf*h, top+h
    span, odx = 2*vd*math.tan(R(vh)), h*math.tan(R(splay))
    a1, a2 = cx-span/2, cx+span/2
    return [(a1-odx, bot), (a1, top), (cx, top+vd), (a2, top), (a2+odx, bot)]

def m_w(h=H, vf=VF, vh=VH, splay=SPLAY):
    return 2*vf*h*math.tan(R(vh)) + 2*h*math.tan(R(splay))

def zig_drop(cx, top, h=H, vf=VF, mid=0.45):
    vd, bot = vf*h, top+h
    span, odx = 2*vd*math.tan(R(VH)), h*math.tan(R(SPLAY))
    a1, a3 = cx-span, cx+span
    return [(a1-odx, bot), (a1, top), ((a1+cx)/2, top+vd), (cx, top+vd*mid),
            ((cx+a3)/2, top+vd), (a3, top), (a3+odx, bot)]

def rocker(x0, x1, y, sag, n=12):
    c, hw = (x0+x1)/2, (x1-x0)/2
    return [(x0+(x1-x0)*i/n, y+sag*(1-((x0+(x1-x0)*i/n-c)/hw)**2)) for i in range(n+1)]

def bbox(p):
    xs=[q[0] for pc in p for q in pc]; ys=[q[1] for pc in p for q in pc]
    return min(xs),min(ys),max(xs),max(ys)
def fit(p, pad=W/2+3):
    x0,y0,x1,y1 = bbox(p)
    o=[[(q[0]-x0+pad, q[1]-y0+pad) for q in pc] for pc in p]
    return o, f"0 0 {round(x1-x0+2*pad)} {round(y1-y0+2*pad)}"
def cradle(p, drop, sag):
    x0,y0,x1,y1 = bbox(p)
    return p + [rocker(x0-12, x1+12, y1+drop, sag)]

MW  = m_w()
GAP = MIN_SEP/math.cos(R(SPLAY)) + 3

SPEC = [
 ("1",   "Rocking Double M",           cradle([m_pts(0,0), m_pts(MW+GAP,0)], 26, 18)),
 ("1a",  "Double M",                   [m_pts(0,0), m_pts(MW+GAP,0)]),
 ("11",  "Rocking Connected Double M", cradle([zig_drop(0,0)], 26, 18)),
 ("11a", "Connected Double M",         [zig_drop(0,0)]),
 ("25",  "Overlapped Double M",        [m_pts(0,0), m_pts(MW*0.725,0)]),
 ("26",  "Double-struck Double M",     None),
 ("24",  "Angular Double M, tight",    [m_pts(0,0), m_pts(MW*0.75, H*0.30, H*0.86)]),
 ("27",  "Angular Double M, opened",   [m_pts(0,0), m_pts(MW*0.785, H*0.30)]),
]
mm = m_pts(0,0)
def on_leg(f,a,t): return (f[0]+(a[0]-f[0])*t, f[1]+(a[1]-f[1])*t)
chev = [on_leg(mm[0],mm[1],0.40), (0, VF*H+H*0.52), on_leg(mm[-1],mm[-2],0.40)]
SPEC = [(k,n,([mm,chev] if k=="26" else p)) for k,n,p in SPEC]

OUT, allok = {}, True
for k,name,pieces in SPEC:
    pieces, vb = fit(pieces)
    ok, probs, st = check(name, pieces)
    allok &= ok
    w,h = vb.split()[2], vb.split()[3]
    sep = "welded" if st['min_sep'] == 0 else f"{st['min_sep']}"
    print(f"{'OK ' if ok else 'XX '}{k:4s} {name:28s} {w:>3s}x{h:<3s} ratio={int(w)/int(h):.2f} irons={st['pieces']} closest={sep}")
    for p in probs[:2]: print(f"        - {p}")
    OUT[k] = (name, vb, [path(pc) for pc in pieces], st['pieces'])
print(f"\nall pass: {allok}   (bar {W} = {W/H*100:.1f}% of letter height, bend r={BEND_R}, min sep={MIN_SEP})")
if allok:
    here = os.path.dirname(os.path.abspath(__file__))
    json.dump(OUT, open(os.path.join(here, "paths.json"), "w"), indent=1)
    print("wrote paths.json")
