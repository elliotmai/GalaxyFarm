#!/usr/bin/env python3
"""
The redesign directions, drawn at every density (docs/ui-redesign.md).

Committed as a script rather than as nine hand-built mockups, because the
directions will be revisited and nine files drawn by hand drift apart the first
time one of them is. Run it and the whole set is regenerated:

    python3 tools/render-mockups.py

Every frame is built at true device pixel size using the density tokens from
`packages/ui/src/tokens/theme.css`, so a 64 px kiosk target in the output is a
real 64 px target rather than something that looks about right. The values in
DENSITY below must stay in step with that file — a mockup that flatters a
direction by quietly using a different scale is worth less than no mockup.

The content is deliberately identical across all nine: same herd, same cow
inside her calving window, same five pens. The only thing varying between any
two frames is the design decision being tested.

Output is a standalone preview at docs/ui-mockups.html. It pulls the webfonts
from Google over the network — it is a design tool that runs on a laptop, not
anything the app ships.
"""

# ── Density tokens, verbatim from theme.css ──────────────────────────────
DENSITY = {
    "desktop": {"target": 36, "text": 15, "gap": 12, "radius": 6,  "w": 1440, "h": 900},
    "mobile":  {"target": 44, "text": 16, "gap": 14, "radius": 10, "w": 390,  "h": 844},
    "kiosk":   {"target": 64, "text": 20, "gap": 20, "radius": 14, "w": 1280, "h": 800},
}

# ── The three directions ─────────────────────────────────────────────────
DIRECTIONS = {
    "herdbook": {
        "name": "Herd Book",
        "g": "#faf9f5", "s": "#ffffff", "i": "#16150f", "m": "#6e6a5e",
        "r": "#e2dfd4", "rf": "#c3bfb1", "a": "#24422f", "al": "#8a2e1f", "ok": "#4a6b52",
        "head": "'Source Serif 4', Georgia, serif",
        "body": "'IBM Plex Sans', sans-serif",
        "num":  "'Source Serif 4', Georgia, serif",
        "mono": "'IBM Plex Mono', monospace",
        # A document keeps its corners tight whatever the density.
        "rcap": 3,
        "upper_head": False,
        "head_ls": "-0.02em",
    },
    "operations": {
        "name": "Operations",
        "g": "#fbfbfc", "s": "#ffffff", "i": "#14161a", "m": "#5c636e",
        "r": "#e4e7eb", "rf": "#cbd0d8", "a": "#2563c4", "al": "#c1332b", "ok": "#16794c",
        "head": "Inter, sans-serif",
        "body": "Inter, sans-serif",
        "num":  "Inter, sans-serif",
        "mono": "'IBM Plex Mono', monospace",
        # The only direction that spends the radius token in full.
        "rcap": 99,
        "upper_head": False,
        "head_ls": "-0.022em",
    },
    "stockman": {
        "name": "Stockman",
        "g": "#f4f4f2", "s": "#ffffff", "i": "#0a0a0a", "m": "#55554f",
        "r": "#c9c9c2", "rf": "#0a0a0a", "a": "#17508c", "al": "#c62828", "ok": "#2e7d32",
        "head": "'Barlow Condensed', sans-serif",
        "body": "'IBM Plex Sans', sans-serif",
        "num":  "'IBM Plex Sans', sans-serif",
        "mono": "'IBM Plex Mono', monospace",
        # Signage does not have rounded corners.
        "rcap": 0,
        "upper_head": True,
        "head_ls": "0.015em",
    },
}

NAV = [("◈", "Today"), ("✦", "Animals"), ("▢", "Land"), ("⚙", "Kit"), ("◇", "Business")]
PENS = [
    ("North Trap", "2 head", 4, "Level 4"),
    ("Creek Pen",  "3 head", 2, "Level 2"),
    ("South Trap", "4 head", 2, "Level 2"),
    ("Barn Stall", "1 head", 3, "Level 3"),
    ("Corral",     "empty",  0, "Resting"),
]


def rad(d, k, mult=1.0):
    """Radius token, capped by the direction's own ceiling."""
    return min(k["radius"] * mult, d["rcap"])


def head(d, text, size, weight=600, color=None):
    t = text.upper() if d["upper_head"] else text
    c = color or d["i"]
    return (f'<div style="font-family:{d["head"]};font-size:{size}px;font-weight:{weight};'
            f'letter-spacing:{d["head_ls"]};line-height:1.1;color:{c}">{t}</div>')


def label(d, text, size):
    """Small caps label. Every direction letterspaces it; Stockman condenses it."""
    fam = d["head"] if d is DIRECTIONS["stockman"] else d["body"]
    ls = ".09em" if d["upper_head"] else ".14em"
    wt = 600 if d["upper_head"] else 600
    return (f'<div style="font-family:{fam};font-size:{size}px;font-weight:{wt};'
            f'letter-spacing:{ls};text-transform:uppercase;color:{d["m"]};line-height:1.2">{text}</div>')


def num(d, value, size, color=None, weight=600):
    c = color or d["i"]
    return (f'<span style="font-family:{d["num"]};font-variant-numeric:tabular-nums;'
            f'font-size:{size}px;font-weight:{weight};letter-spacing:-0.02em;color:{c};'
            f'line-height:1.05">{value}</span>')


def chip(d, text, kind, k):
    """Status chip — each direction has its own idea of what one is."""
    col = {"al": d["al"], "ok": d["ok"], "q": d["m"], "a": d["a"]}[kind]
    key = d["name"]
    if key == "Herd Book":                       # a stamp
        return (f'<span style="border:1px solid {col};color:{col};font-family:{d["body"]};'
                f'font-size:{max(9, k["text"]-5)}px;font-weight:600;letter-spacing:.12em;'
                f'text-transform:uppercase;padding:{k["gap"]//5}px {k["gap"]//2}px;'
                f'border-radius:2px;white-space:nowrap;display:inline-block">{text}</span>')
    if key == "Operations":                      # a soft token
        bg = {"al": "#fdeceb", "ok": "#e8f4ee", "q": "#f1f3f5", "a": "#eef2f8"}[kind]
        return (f'<span style="background:{bg};color:{col};font-family:{d["body"]};'
                f'font-size:{max(10, k["text"]-4)}px;font-weight:500;'
                f'padding:{k["gap"]//5}px {k["gap"]//2}px;border-radius:{rad(d,k,0.7)}px;'
                f'white-space:nowrap;display:inline-block">{text}</span>')
    # Stockman — a solid flag
    if kind == "q":
        return (f'<span style="border:2px solid {d["r"]};color:{d["m"]};font-family:{d["head"]};'
                f'font-size:{k["text"]}px;font-weight:600;letter-spacing:.06em;'
                f'text-transform:uppercase;padding:{k["gap"]//6}px {k["gap"]//2}px;'
                f'white-space:nowrap;display:inline-block">{text}</span>')
    return (f'<span style="background:{col};color:#fff;font-family:{d["head"]};'
            f'font-size:{k["text"]}px;font-weight:600;letter-spacing:.06em;'
            f'text-transform:uppercase;padding:{k["gap"]//6}px {k["gap"]//2}px;'
            f'white-space:nowrap;display:inline-block">{text}</span>')


def surface(d, k, pad=None, extra=""):
    """A container. Herd Book rules it, Operations boxes it, Stockman edges it."""
    p = pad if pad is not None else k["gap"]
    key = d["name"]
    if key == "Herd Book":
        return f'background:{d["s"]};border:1px solid {d["r"]};border-radius:{rad(d,k)}px;padding:{p}px;{extra}'
    if key == "Operations":
        return (f'background:{d["s"]};border:1px solid {d["r"]};border-radius:{rad(d,k)}px;'
                f'padding:{p}px;box-shadow:0 1px 2px rgb(20 22 26 / 5%);{extra}')
    return f'background:{d["s"]};border:2px solid {d["i"]};padding:{p}px;{extra}'


def button(d, k, text, primary=True):
    h = k["target"]
    if primary:
        bg, fg, bd = d["a"], "#ffffff", d["a"]
    else:
        bg, fg, bd = "transparent", d["i"], d["rf"]
    fam = d["head"] if d["upper_head"] else d["body"]
    tt = "uppercase" if d["upper_head"] else "none"
    ls = ".06em" if d["upper_head"] else "0"
    return (f'<span style="display:inline-flex;align-items:center;justify-content:center;'
            f'height:{h}px;padding:0 {k["gap"]*1.4:.0f}px;background:{bg};color:{fg};'
            f'border:1px solid {bd};border-radius:{rad(d,k)}px;font-family:{fam};'
            f'font-size:{k["text"]}px;font-weight:600;text-transform:{tt};letter-spacing:{ls};'
            f'white-space:nowrap">{text}</span>')


def mark(d, size, color=None):
    """The Rocking Double Star, taking the direction's colours."""
    c = color or d["i"]
    a = color or d["a"]
    star = ("50,16 57.94,39.08 82.34,39.49 62.84,54.17 69.99,77.51 "
            "50,63.5 30.01,77.51 37.16,54.17 17.66,39.49 42.06,39.08")
    return (f'<svg viewBox="0 0 100 100" width="{size}" height="{size}" aria-hidden="true" '
            f'style="flex:none;display:block">'
            f'<path d="M12 78 Q50 98 88 78" fill="none" stroke="{a}" stroke-width="8" '
            f'stroke-linecap="round" stroke-linejoin="round"/>'
            f'<polygon points="{star}" fill="{c}" stroke="{c}" stroke-width="5" stroke-linejoin="round" '
            f'transform="translate(40 42) scale(0.7059) translate(-50 -50)"/>'
            f'<polygon points="{star}" fill="{c}" stroke="{c}" stroke-width="5" stroke-linejoin="round" '
            f'transform="translate(72 62) scale(0.3676) translate(-50 -50)"/></svg>')


def safety_mark(d, level, k, size=None):
    """The saturated safety ramp — deliberately untouched by any direction."""
    ramp = {0: "#8a8a82", 2: "#3f8f4f", 3: "#c98a1e", 4: "#c0392b"}
    s = size or k["text"] + 4
    if level == 0:
        return ""
    return (f'<span style="display:inline-flex;align-items:center;justify-content:center;'
            f'width:{s}px;height:{s}px;border-radius:2px;background:{ramp[level]};color:#fff;'
            f'font-family:{d["body"]};font-size:{s*0.6:.0f}px;font-weight:700;flex:none">{level}</span>')


# ── DESKTOP ──────────────────────────────────────────────────────────────
def desktop(d, k):
    side_w = 236
    nav = ""
    for idx, (glyph, name) in enumerate(NAV):
        on = idx == 1
        bg = f'background:{d["a"]}14;' if on else ""
        col = d["i"] if on else d["m"]
        wt = 600 if on else 400
        nav += (f'<div style="display:flex;align-items:center;gap:{k["gap"]}px;height:{k["target"]}px;'
                f'padding:0 {k["gap"]}px;border-radius:{rad(d,k)}px;{bg}color:{col};'
                f'font-family:{d["body"]};font-size:{k["text"]}px;font-weight:{wt}">'
                f'<span style="color:{d["a"]};width:16px;text-align:center">{glyph}</span>{name}</div>')

    util = ""
    for name in ("Contacts", "Reports", "Settings"):
        util += (f'<div style="display:flex;align-items:center;height:{k["target"]}px;'
                 f'padding:0 {k["gap"]}px;color:{d["m"]};font-family:{d["body"]};'
                 f'font-size:{k["text"]-1}px">{name}</div>')

    rows = ""
    for name, occ, lvl, tag in PENS:
        kind = "al" if lvl >= 4 else ("ok" if lvl == 2 else ("q" if lvl == 0 else "a"))
        nm_col = d["m"] if lvl == 0 else d["i"]
        rows += (
            f'<tr style="border-bottom:1px solid {d["r"]}">'
            f'<td style="padding:{k["gap"]*0.8:.0f}px {k["gap"]}px;font-family:{d["head"]};'
            f'font-size:{k["text"]+1}px;font-weight:600;color:{nm_col}">{name}</td>'
            f'<td style="padding:{k["gap"]*0.8:.0f}px {k["gap"]}px;font-family:{d["mono"]};'
            f'font-size:{k["text"]-2}px;color:{d["m"]}">{occ}</td>'
            f'<td style="padding:{k["gap"]*0.8:.0f}px {k["gap"]}px">'
            f'{safety_mark(d, lvl, k)}</td>'
            f'<td style="padding:{k["gap"]*0.8:.0f}px {k["gap"]}px">{chip(d, tag, kind, k)}</td>'
            f'<td style="padding:{k["gap"]*0.8:.0f}px {k["gap"]}px;text-align:right;'
            f'font-family:{d["body"]};font-size:{k["text"]-1}px;color:{d["a"]}">Open</td>'
            f'</tr>')

    stats = ""
    for lab, val, col in (("Head", "24", None), ("Pens in use", "7<span style=\"font-size:%dpx;color:%s\"> / 9</span>" % (k["text"], d["m"]), None),
                          ("Tanks uncovered", "3", d["al"])):
        stats += (f'<div style="{surface(d,k)};flex:1">'
                  f'{label(d, lab, k["text"]-4)}'
                  f'<div style="margin-top:{k["gap"]//3}px">{num(d, val, k["text"]+13, col)}</div></div>')

    return f'''
<div style="width:{k["w"]}px;height:{k["h"]}px;background:{d["g"]};color:{d["i"]};
            font-family:{d["body"]};font-size:{k["text"]}px;display:flex;overflow:hidden">

  <aside style="width:{side_w}px;flex:none;background:{d["s"]};
                border-right:1px solid {d["r"]};display:flex;flex-direction:column;
                padding:{k["gap"]*1.5:.0f}px {k["gap"]}px">
    <div style="display:flex;align-items:center;gap:{k["gap"]}px;padding:0 {k["gap"]}px {k["gap"]*1.5:.0f}px">
      {mark(d, 30)}
      {head(d, "Galaxy Farm", k["text"]+3)}
    </div>
    <div style="display:flex;flex-direction:column;gap:2px">{nav}</div>
    <div style="height:1px;background:{d["r"]};margin:{k["gap"]}px {k["gap"]}px"></div>
    <div style="display:flex;flex-direction:column">{util}</div>
    <div style="margin-top:auto;padding:{k["gap"]}px;display:flex;align-items:center;gap:8px">
      <span style="width:7px;height:7px;border-radius:50%;background:{d["ok"]};flex:none"></span>
      <span style="font-family:{d["body"]};font-size:{k["text"]-2}px;color:{d["m"]}">Up to date</span>
    </div>
  </aside>

  <main style="flex:1;min-width:0;padding:{k["gap"]*2.4:.0f}px {k["gap"]*2.8:.0f}px;
               display:flex;flex-direction:column;gap:{k["gap"]*1.6:.0f}px">

    <div style="display:flex;align-items:flex-end;justify-content:space-between;
                border-bottom:1px solid {d["rf"]};padding-bottom:{k["gap"]}px">
      <div>
        {label(d, "Thursday · 13 August", k["text"]-4)}
        <div style="margin-top:{k["gap"]//3}px">{head(d, "Today", 34)}</div>
      </div>
      <div style="display:flex;gap:{k["gap"]}px">
        {button(d, k, "Log weight", False)}
        {button(d, k, "Add animal", True)}
      </div>
    </div>

    <div style="{surface(d, k, k["gap"]*1.2)};display:flex;align-items:center;
                justify-content:space-between;gap:{k["gap"]}px;
                border-left:4px solid {d["al"]}">
      <div style="display:flex;align-items:center;gap:{k["gap"]*1.2:.0f}px">
        {chip(d, "Calving watch", "al", k)}
        <div>
          {head(d, "Juniper", k["text"]+5)}
          <div style="font-family:{d["mono"]};font-size:{k["text"]-3}px;color:{d["m"]};
                      margin-top:2px">TAG 118 · MAINE-ANJOU · NORTH TRAP</div>
        </div>
      </div>
      <div style="text-align:right">
        {num(d, "Day 279", k["text"]+6)}
        <div style="font-family:{d["body"]};font-size:{k["text"]-2}px;color:{d["m"]}">of 283</div>
      </div>
    </div>

    <div style="display:flex;gap:{k["gap"]}px">{stats}</div>

    <div style="{surface(d, k, 0)};flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden">
      <div style="display:flex;align-items:center;justify-content:space-between;
                  padding:{k["gap"]}px {k["gap"]}px;border-bottom:1px solid {d["rf"]}">
        {label(d, "Pen board", k["text"]-4)}
        <span style="font-family:{d["body"]};font-size:{k["text"]-2}px;color:{d["m"]}">
          4 in use · 1 empty</span>
      </div>
      <table style="width:100%;border-collapse:collapse">{rows}</table>
    </div>
  </main>
</div>'''


# ── MOBILE ───────────────────────────────────────────────────────────────
def mobile(d, k):
    bottom = ""
    for idx, (glyph, name) in enumerate(NAV):
        on = idx == 0
        col = d["a"] if on else d["m"]
        wt = 600 if on else 400
        bottom += (f'<div style="flex:1;display:flex;flex-direction:column;align-items:center;'
                   f'justify-content:center;gap:3px;height:{k["target"]+14}px;color:{col}">'
                   f'<span style="font-size:{k["text"]+2}px;line-height:1">{glyph}</span>'
                   f'<span style="font-family:{d["body"]};font-size:{k["text"]-5}px;'
                   f'font-weight:{wt}">{name}</span></div>')

    rows = ""
    for name, occ, lvl, tag in PENS[:4]:
        kind = "al" if lvl >= 4 else ("ok" if lvl == 2 else ("q" if lvl == 0 else "a"))
        rows += (f'<div style="display:flex;align-items:center;justify-content:space-between;'
                 f'gap:{k["gap"]}px;min-height:{k["target"]}px;padding:{k["gap"]*0.7:.0f}px 0;'
                 f'border-bottom:1px solid {d["r"]}">'
                 f'<div style="display:flex;align-items:center;gap:{k["gap"]*0.7:.0f}px;min-width:0">'
                 f'{safety_mark(d, lvl, k)}'
                 f'<div style="min-width:0">'
                 f'{head(d, name, k["text"]+1)}'
                 f'<div style="font-family:{d["mono"]};font-size:{k["text"]-5}px;color:{d["m"]}">{occ}</div>'
                 f'</div></div>{chip(d, tag, kind, k)}</div>')

    stats = ""
    for lab, val, col in (("Head", "24", None), ("Pens", "7/9", None), ("Uncovered", "3", d["al"])):
        stats += (f'<div style="{surface(d, k, k["gap"]*0.8)};flex:1;min-width:0">'
                  f'{label(d, lab, k["text"]-6)}'
                  f'<div style="margin-top:2px">{num(d, val, k["text"]+7, col)}</div></div>')

    return f'''
<div style="width:{k["w"]}px;height:{k["h"]}px;background:{d["g"]};color:{d["i"]};
            font-family:{d["body"]};font-size:{k["text"]}px;display:flex;
            flex-direction:column;overflow:hidden">

  <div style="height:{k["target"]+8}px;flex:none;background:{d["s"]};
              border-bottom:1px solid {d["r"]};display:flex;align-items:center;
              justify-content:space-between;padding:0 {k["gap"]}px">
    <div style="display:flex;align-items:center;gap:{k["gap"]*0.7:.0f}px">
      {mark(d, 26)}{head(d, "Galaxy Farm", k["text"]+1)}
    </div>
    <span style="width:8px;height:8px;border-radius:50%;background:{d["ok"]}"></span>
  </div>

  <div style="flex:1;min-height:0;overflow:hidden;padding:{k["gap"]*1.2:.0f}px {k["gap"]}px;
              display:flex;flex-direction:column;gap:{k["gap"]}px">

    <div>
      {label(d, "Thursday · 13 August", k["text"]-6)}
      <div style="margin-top:3px">{head(d, "Today", 28)}</div>
    </div>

    <div style="{surface(d, k, k["gap"])};border-left:4px solid {d["al"]}">
      <div style="display:flex;align-items:center;justify-content:space-between;
                  gap:{k["gap"]}px;margin-bottom:{k["gap"]*0.6:.0f}px">
        {chip(d, "Calving watch", "al", k)}
        {num(d, "279", k["text"]+6, d["al"])}
      </div>
      {head(d, "Juniper", k["text"]+5)}
      <div style="font-family:{d["mono"]};font-size:{k["text"]-5}px;color:{d["m"]};margin-top:2px">
        TAG 118 · NORTH TRAP · DAY 279 OF 283</div>
    </div>

    <div style="display:flex;gap:{k["gap"]*0.6:.0f}px">{stats}</div>

    <div style="flex:1;min-height:0;display:flex;flex-direction:column">
      <div style="display:flex;align-items:center;justify-content:space-between;
                  padding-bottom:{k["gap"]*0.5:.0f}px;border-bottom:2px solid {d["rf"]}">
        {label(d, "Pen board", k["text"]-6)}
      </div>
      {rows}
    </div>
  </div>

  <div style="flex:none;display:flex;align-items:center;justify-content:center;
              padding:0 {k["gap"]}px {k["gap"]*0.8:.0f}px">
    <div style="width:100%;display:flex;align-items:center;justify-content:center;
                height:{k["target"]}px;background:{d["a"]};color:#fff;
                border-radius:{rad(d,k)}px;font-family:{d["head"] if d["upper_head"] else d["body"]};
                font-size:{k["text"]}px;font-weight:600;
                text-transform:{"uppercase" if d["upper_head"] else "none"};
                letter-spacing:{".06em" if d["upper_head"] else "0"}">＋ Log something</div>
  </div>

  <nav style="flex:none;background:{d["s"]};border-top:1px solid {d["r"]};
              display:flex;padding-bottom:{k["gap"]*0.6:.0f}px">{bottom}</nav>
</div>'''


# ── KIOSK ────────────────────────────────────────────────────────────────
def kiosk(d, k):
    cards = ""
    for name, occ, lvl, tag in PENS[:4]:
        kind = "al" if lvl >= 4 else ("ok" if lvl == 2 else ("q" if lvl == 0 else "a"))
        edge = {4: d["al"], 3: "#c98a1e", 2: d["ok"], 0: d["r"]}[lvl]
        cards += (f'<div style="{surface(d, k, k["gap"]*1.1)};flex:1;min-width:0;'
                  f'border-left:8px solid {edge};display:flex;flex-direction:column;'
                  f'gap:{k["gap"]*0.5:.0f}px">'
                  f'<div style="display:flex;align-items:center;justify-content:space-between;gap:{k["gap"]}px">'
                  f'{head(d, name, k["text"]+8)}{safety_mark(d, lvl, k, k["text"]+14)}</div>'
                  f'<div style="font-family:{d["mono"]};font-size:{k["text"]-3}px;color:{d["m"]}">{occ.upper()}</div>'
                  f'<div style="margin-top:auto">{chip(d, tag, kind, k)}</div></div>')

    actions = ""
    for text in ("Log weight", "Treatment", "Move animal", "Eggs"):
        actions += (f'<div style="flex:1;height:{k["target"]+16}px;display:flex;align-items:center;'
                    f'justify-content:center;background:{d["s"]};border:2px solid {d["a"]};'
                    f'border-radius:{rad(d,k)}px;color:{d["a"]};'
                    f'font-family:{d["head"] if d["upper_head"] else d["body"]};'
                    f'font-size:{k["text"]+3}px;font-weight:600;'
                    f'text-transform:{"uppercase" if d["upper_head"] else "none"};'
                    f'letter-spacing:{".06em" if d["upper_head"] else "0"}">{text}</div>')

    return f'''
<div style="width:{k["w"]}px;height:{k["h"]}px;background:{d["g"]};color:{d["i"]};
            font-family:{d["body"]};font-size:{k["text"]}px;display:flex;
            flex-direction:column;overflow:hidden">

  <div style="flex:none;display:flex;align-items:center;justify-content:space-between;
              padding:{k["gap"]*1.2:.0f}px {k["gap"]*1.6:.0f}px;
              border-bottom:3px solid {d["rf"]};background:{d["s"]}">
    <div style="display:flex;align-items:center;gap:{k["gap"]}px">
      {mark(d, 46)}
      <div>
        {head(d, "Pen board", k["text"]+16)}
        <div style="font-family:{d["body"]};font-size:{k["text"]-2}px;color:{d["m"]};margin-top:2px">
          Thursday 13 August · 6:42 am</div>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:{k["gap"]*0.7:.0f}px">
      <span style="width:12px;height:12px;border-radius:50%;background:{d["ok"]}"></span>
      <span style="font-family:{d["body"]};font-size:{k["text"]}px;color:{d["m"]}">Up to date</span>
    </div>
  </div>

  <div style="flex:none;padding:{k["gap"]}px {k["gap"]*1.6:.0f}px;
              background:{d["al"]};color:#fff;display:flex;align-items:center;
              justify-content:space-between;gap:{k["gap"]}px">
    <div style="display:flex;align-items:center;gap:{k["gap"]}px">
      <span style="font-family:{d["head"]};font-size:{k["text"]+8}px;font-weight:700;
                   letter-spacing:{d["head_ls"]};text-transform:uppercase">Calving watch</span>
      <span style="font-family:{d["head"]};font-size:{k["text"]+8}px;font-weight:600">
        Juniper · Tag 118</span>
    </div>
    <span style="font-family:{d["num"]};font-variant-numeric:tabular-nums;
                 font-size:{k["text"]+10}px;font-weight:700">Day 279 / 283</span>
  </div>

  <div style="flex:1;min-height:0;padding:{k["gap"]*1.6:.0f}px;display:flex;
              gap:{k["gap"]}px">{cards}</div>

  <div style="flex:none;padding:0 {k["gap"]*1.6:.0f}px {k["gap"]*1.6:.0f}px;
              display:flex;gap:{k["gap"]}px">{actions}</div>
</div>'''


RENDER = {"desktop": desktop, "mobile": mobile, "kiosk": kiosk}


def build():
    out = {}
    for dkey, d in DIRECTIONS.items():
        for mode, k in DENSITY.items():
            out[f"{dkey}-{mode}"] = RENDER[mode](d, k)
    return out


FONTS = (
    "https://fonts.googleapis.com/css2"
    "?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600"
    "&family=IBM+Plex+Sans:wght@400;500;600"
    "&family=IBM+Plex+Mono:wght@400"
    "&family=Barlow+Condensed:wght@600"
    "&family=Inter:wght@400;500;600"
    "&display=swap"
)

PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Galaxy Farm — direction mockups</title>
<link rel="stylesheet" href="{fonts}">
<style>
  body {{ margin:0; padding:40px; background:#e8e8e2; font-family:"IBM Plex Sans",sans-serif; }}
  h1 {{ font-family:"Source Serif 4",serif; font-weight:600; font-size:30px; margin:0 0 4px; }}
  h2 {{ font-family:"Source Serif 4",serif; font-weight:600; font-size:22px; margin:44px 0 14px; }}
  p.sub {{ color:#63665e; font-size:14px; margin:0 0 8px; }}
  figure {{ margin:0 0 26px; }}
  figcaption {{ font-size:11px; letter-spacing:.14em; text-transform:uppercase;
                color:#63665e; margin-bottom:7px; }}
  .frame {{ overflow:hidden; border:1px solid #b9b9ae; background:#fff;
            box-shadow:0 12px 30px -18px rgb(0 0 0/40%); }}
</style></head><body>
<h1>Galaxy Farm — direction mockups</h1>
<p class="sub">Generated by tools/render-mockups.py. Frames are true device size.</p>
{sections}
</body></html>"""


def main() -> None:
    import pathlib

    sections = []
    for dkey, d in DIRECTIONS.items():
        sections.append(f"<h2>{d['name']}</h2>")
        for mode, k in DENSITY.items():
            sections.append(
                f'<figure><figcaption>{mode} · {k["target"]}px target · '
                f'{k["text"]}px text · {k["gap"]}px gap · {k["radius"]}px radius '
                f'· {k["w"]}×{k["h"]}</figcaption>'
                f'<div class="frame" style="width:{k["w"]}px;height:{k["h"]}px">'
                f'{RENDER[mode](d, k)}</div></figure>'
            )

    out = pathlib.Path(__file__).resolve().parent.parent / "docs" / "ui-mockups.html"
    out.write_text(PAGE.format(fonts=FONTS, sections="\n".join(sections)), encoding="utf-8")
    print(f"wrote {out.relative_to(out.parent.parent)} — {len(DIRECTIONS) * len(DENSITY)} frames")


if __name__ == "__main__":
    main()
