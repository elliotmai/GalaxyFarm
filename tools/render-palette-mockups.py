#!/usr/bin/env python3
"""
Comprehensive mockups for the shortlisted palettes (docs/ui-redesign.md).

    python3 tools/render-palette-mockups.py

Eleven screens per palette across all three surfaces, written to
docs/mockups/. Herd Book typography on desktop and the customer portal,
Operations on the phone, Stockman on the barn screen — the split decided in
docs/ui-redesign.md — with one palette holding all three together.

Every frame is built at true device pixel size using the density tokens from
`packages/ui/src/tokens/theme.css`. A 64 px kiosk target in the output is a
real 64 px target rather than something that looks about right.

The screen list is chosen to break things rather than to flatter them: the
animal detail page because it is the hardest screen in the product, the edit
form because focus rings and error states are where a palette actually fails,
the component inventory because every state has to be seen at once, and the
customer portal because it is the one surface a stranger judges.

Output is pure ASCII. Served without a charset the browser guesses, and a page
that guesses Latin-1 renders every middot and en dash as mojibake — numeric
entities cannot be misread and cost nothing. The preview pulls its webfonts
from Google over the network; it is a design tool that runs on a laptop, not
anything the app ships.
"""

import pathlib
# tools/palette-audit.py is the single source of the palette values. Its
# filename has a hyphen, so it is loaded by path rather than imported.
_spec_path = pathlib.Path(__file__).resolve().parent / "palette-audit.py"
_ns: dict = {}
exec(compile(_spec_path.read_text(encoding="utf-8"), str(_spec_path), "exec"), _ns)
PALETTES = _ns["PALETTES"]
SAFETY = _ns["SAFETY"]
ratio = _ns["ratio"]
audit = _ns["audit"]
safety_clash = _ns["safety_clash"]



SAFETY_INK = {1: "#ffffff", 2: "#111111", 3: "#111111", 4: "#ffffff", 5: "#ffffff"}

SERIF = "'Source Serif 4', Georgia, serif"
SANS = "'IBM Plex Sans', system-ui, sans-serif"
MONO = "'IBM Plex Mono', monospace"
INTER = "Inter, sans-serif"
COND = "'Barlow Condensed', 'Arial Narrow', 'Liberation Sans Narrow', sans-serif"

DESK = {"target": 36, "text": 15, "gap": 12, "radius": 3}
MOB = {"target": 44, "text": 16, "gap": 14, "radius": 10}
KIOSK = {"target": 64, "text": 20, "gap": 20, "radius": 0}


# ═══ shared atoms ════════════════════════════════════════════════════════
def chip_hb(p, text, tone="q"):
    """Herd Book stamp — outlined, letterspaced, near-square."""
    col = {"a": p["primary"], "al": p["alert"], "ok": p["ok"], "q": p["muted"]}[tone]
    return (f'<span style="border:1px solid {col};color:{col};font-family:{SANS};font-size:10px;'
            f'font-weight:600;letter-spacing:.12em;text-transform:uppercase;padding:2px 7px;'
            f'border-radius:2px;white-space:nowrap;display:inline-block">{text}</span>')


def chip_op(p, text, tone="q"):
    """Operations token — soft fill, rounded."""
    col = {"a": p["primary"], "al": p["alert"], "ok": p["ok"], "q": p["muted"]}[tone]
    return (f'<span style="background:{col}14;color:{col};font-family:{INTER};font-size:11px;'
            f'font-weight:500;padding:3px 8px;border-radius:6px;white-space:nowrap;'
            f'display:inline-block">{text}</span>')


def flag_sk(p, text, tone="al"):
    """Stockman flag — solid, square, condensed caps."""
    col = {"a": p["primary"], "al": p["alert"], "ok": p["ok"]}.get(tone)
    if tone == "q":
        return (f'<span style="border:2px solid {p["rule"]};color:{p["muted"]};font-family:{COND};'
                f'font-size:20px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;'
                f'padding:2px 10px;white-space:nowrap;display:inline-block">{text}</span>')
    return (f'<span style="background:{col};color:#fff;font-family:{COND};font-size:20px;'
            f'font-weight:600;letter-spacing:.06em;text-transform:uppercase;padding:2px 10px;'
            f'white-space:nowrap;display:inline-block">{text}</span>')


def safety(level, size, ink=None):
    return (f'<span style="display:inline-flex;align-items:center;justify-content:center;'
            f'width:{size}px;height:{size}px;border-radius:2px;background:{SAFETY[level]};'
            f'color:{SAFETY_INK[level]};font-family:{SANS};font-size:{ink or size*0.58:.0f}px;'
            f'font-weight:700;flex:none">{level}</span>')


def btn(p, text, kind="primary", h=36, fam=None, upper=False, radius=3):
    fam = fam or SANS
    tt = "uppercase" if upper else "none"
    ls = ".05em" if upper else "0"
    if kind == "primary":
        style = f'background:{p["primary"]};color:{p["on_primary"]};border:1px solid {p["primary"]}'
    elif kind == "danger":
        style = f'background:{p["surface"]};color:{p["alert"]};border:1px solid {p["alert"]}'
    elif kind == "disabled":
        style = (f'background:{p["surface"]};color:{p["muted"]}88;'
                 f'border:1px solid {p["rule"]}')
    else:
        style = f'background:{p["surface"]};color:{p["ink"]};border:1px solid {p["rule"]}'
    return (f'<span style="display:inline-flex;align-items:center;justify-content:center;'
            f'height:{h}px;padding:0 {h*0.44:.0f}px;{style};border-radius:{radius}px;'
            f'font-family:{fam};font-size:{h*0.39:.0f}px;font-weight:600;text-transform:{tt};'
            f'letter-spacing:{ls};white-space:nowrap">{text}</span>')


def lbl(p, text, size=10, fam=None):
    return (f'<div style="font-family:{fam or SANS};font-size:{size}px;font-weight:600;'
            f'letter-spacing:.14em;text-transform:uppercase;color:{p["muted"]};'
            f'line-height:1.2">{text}</div>')


def mark(p, size, on_dark=False):
    """Flying Double M Connected, in the palette's ink."""
    c = "#ffffff" if on_dark else p["ink"]
    return (f'<svg viewBox="0 0 100 100" width="{size}" height="{size}" aria-hidden="true" '
            f'style="flex:none;display:block">'
            f'<g fill="none" stroke="{{c}}" stroke-width="7.84" stroke-linecap="round" stroke-linejoin="round"><path d="M22 77.89 L27.6 33.09 L38.8 54.37 L50 33.09 L61.2 54.37 L72.4 33.09 L78 77.89"/><path d="M50 33.09 L50 77.89"/><path d="M27.6 33.09 Q18.64 17.41 11.92 24.13 M72.4 33.09 Q81.36 17.41 88.08 24.13"/></g></svg>')


# ═══ the weight chart ════════════════════════════════════════════════════
WEIGHTS = [("12 Oct", 612), ("20 Nov", 684), ("28 Dec", 731), ("3 Feb", 798),
           ("15 Mar", 856), ("22 Apr", 921), ("1 Jun", 1004), ("10 Jul", 1092),
           ("12 Aug", 1184)]


def weight_chart(p, w=560, h=190):
    """
    One animal's weigh-ins over ten months.

    A single series, so no legend — the panel title names it. Recessive grid,
    a 2px line, a dot at each weigh-in because the readings are discrete
    events rather than a continuous signal, and a direct label on the last
    point only. The real one carries a crosshair and tooltip; a mockup that
    faked hover would be claiming something it cannot do.
    """
    pad_l, pad_r, pad_t, pad_b = 46, 84, 14, 26
    plot_w, plot_h = w - pad_l - pad_r, h - pad_t - pad_b
    lo, hi = 560, 1240
    n = len(WEIGHTS)

    def x(i):
        return pad_l + plot_w * i / (n - 1)

    def y(v):
        return pad_t + plot_h * (1 - (v - lo) / (hi - lo))

    grid = ""
    for v in (600, 800, 1000, 1200):
        yy = y(v)
        grid += (f'<line x1="{pad_l}" y1="{yy:.1f}" x2="{pad_l+plot_w}" y2="{yy:.1f}" '
                 f'stroke="{p["rule"]}" stroke-width="1"/>'
                 f'<text x="{pad_l-9}" y="{yy+3.5:.1f}" text-anchor="end" font-family="{MONO}" '
                 f'font-size="10" fill="{p["muted"]}">{v}</text>')

    pts = " ".join(f"{x(i):.1f},{y(v):.1f}" for i, (_, v) in enumerate(WEIGHTS))
    area = (f'{pad_l},{pad_t+plot_h} ' + pts + f' {pad_l+plot_w},{pad_t+plot_h}')

    dots = ""
    for i, (_, v) in enumerate(WEIGHTS):
        last = i == n - 1
        r = 4.5 if last else 3
        dots += (f'<circle cx="{x(i):.1f}" cy="{y(v):.1f}" r="{r}" fill="{p["primary"]}" '
                 f'stroke="{p["surface"]}" stroke-width="2"/>')

    xlabels = ""
    for i in (0, 4, n - 1):
        xlabels += (f'<text x="{x(i):.1f}" y="{h-8}" text-anchor="middle" font-family="{MONO}" '
                    f'font-size="10" fill="{p["muted"]}">{WEIGHTS[i][0]}</text>')

    lastx, lasty = x(n - 1), y(WEIGHTS[-1][1])
    return f'''<svg viewBox="0 0 {w} {h}" width="100%" height="{h}" role="img"
     aria-label="Weigh-ins from October to August, 612 lb rising to 1,184 lb">
  {grid}
  <polygon points="{area}" fill="{p["primary"]}" opacity="0.07"/>
  <polyline points="{pts}" fill="none" stroke="{p["primary"]}" stroke-width="2"
            stroke-linejoin="round" stroke-linecap="round"/>
  {dots}
  <text x="{lastx+10:.1f}" y="{lasty-6:.1f}" font-family="{SERIF}" font-size="15"
        font-weight="600" fill="{p["ink"]}">1,184 lb</text>
  <text x="{lastx+10:.1f}" y="{lasty+9:.1f}" font-family="{SANS}" font-size="10"
        fill="{p["muted"]}">latest</text>
  {xlabels}
</svg>'''


# ═══ the pedigree certificate grid ═══════════════════════════════════════
PEDIGREE = {
    "sire": ("Ridgeline Monarch", "MA 4471882", [
        ("Monarch's Legacy", "MA 4102336"), ("Cedar Hill Ruby", "MA 4188907")]),
    "dam": ("Galaxy Farm Willow", "MA 4520114", [
        ("Bar-K Foundation", "MA 4009551"), ("Willow Creek Belle", "MA 4233780")]),
}


def pedigree_grid(p):
    """
    Three generations, laid out the way a registration certificate lays them
    out: the animal implied at the left, sire above dam, each splitting again.
    The old design drew this as a constellation; on paper it has been this
    grid for a hundred years and the grid is what a buyer can actually read.
    """
    def box(name, reg, big=False):
        return (f'<div style="border:1px solid {p["rule"]};background:{p["surface"]};'
                f'padding:{9 if big else 7}px 11px;display:flex;flex-direction:column;gap:1px;'
                f'justify-content:center;min-width:0">'
                f'<div style="font-family:{SERIF};font-size:{14 if big else 12.5}px;'
                f'font-weight:600;color:{p["ink"]};white-space:nowrap;overflow:hidden;'
                f'text-overflow:ellipsis">{name}</div>'
                f'<div style="font-family:{MONO};font-size:9.5px;color:{p["muted"]}">{reg}</div></div>')

    rule = p["rule"]
    halves = ""
    for side, heading in (("sire", "Sire"), ("dam", "Dam")):
        nm, reg, parents = PEDIGREE[side]
        halves += f'''
  <div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
      {lbl(p, heading, 9)}<span style="flex:1;height:1px;background:{rule}"></span>
    </div>
    <div style="display:grid;grid-template-columns:1.15fr 1fr;gap:5px;align-items:stretch">
      <div style="display:flex">{box(nm, reg, True)}</div>
      <div style="display:grid;grid-template-rows:auto auto;gap:5px">
        {box(*parents[0])}{box(*parents[1])}
      </div>
    </div>
  </div>'''

    return f'<div style="display:flex;flex-direction:column;gap:9px">{halves}\n</div>'


# ═══ desktop chrome ══════════════════════════════════════════════════════
NAV = [("◈", "Today"), ("✦", "Animals"), ("▢", "Land"), ("⚙", "Kit"), ("◇", "Business")]


def sidebar(p, active=1, h=900):
    nav = ""
    for i, (g, name) in enumerate(NAV):
        on = i == active
        on_bg = "background:" + p["primary"] + "12;" if on else ""
        nav += (f'<div style="display:flex;align-items:center;gap:12px;height:36px;padding:0 12px;'
                f'border-radius:3px;{on_bg}'
                f'color:{p["ink"] if on else p["muted"]};font-family:{SANS};font-size:15px;'
                f'font-weight:{600 if on else 400}">'
                f'<span style="color:{p["primary"]};width:16px;text-align:center">{g}</span>{name}</div>')
    util = "".join(
        f'<div style="display:flex;align-items:center;height:34px;padding:0 12px;color:{p["muted"]};'
        f'font-family:{SANS};font-size:14px">{n}</div>' for n in ("Contacts", "Reports", "Settings"))
    return f'''<aside style="width:236px;flex:none;background:{p["surface"]};
    border-right:1px solid {p["rule"]};display:flex;flex-direction:column;padding:18px 12px">
  <div style="display:flex;align-items:center;gap:11px;padding:0 12px 18px">
    {mark(p, 30)}
    <span style="font-family:{SERIF};font-size:18px;font-weight:600">Galaxy Farm</span>
  </div>
  <div style="display:flex;flex-direction:column;gap:2px">{nav}</div>
  <div style="height:1px;background:{p["rule"]};margin:12px"></div>
  <div style="display:flex;flex-direction:column">{util}</div>
  <div style="margin-top:auto;padding:12px;display:flex;align-items:center;gap:8px">
    <span style="width:7px;height:7px;border-radius:50%;background:{p["ok"]};flex:none"></span>
    <span style="font-family:{SANS};font-size:13px;color:{p["muted"]}">Up to date</span>
  </div>
</aside>'''


# ═══ 1 · desktop dashboard ═══════════════════════════════════════════════
PENS = [("North Trap", "2 head", 4, "Level 4"), ("Creek Pen", "3 head", 2, "Level 2"),
        ("South Trap", "4 head", 2, "Level 2"), ("Barn Stall", "1 head", 3, "Level 3"),
        ("Corral", "empty", 0, "Resting")]


def desktop_dashboard(p):
    rows = ""
    for name, occ, lv, tag in PENS:
        tone = "al" if lv >= 4 else "ok" if lv == 2 else "q" if lv == 0 else "a"
        rows += (f'<tr style="border-bottom:1px solid {p["rule"]}">'
                 f'<td style="padding:10px 14px;font-family:{SERIF};font-size:16px;font-weight:600;'
                 f'color:{p["muted"] if lv == 0 else p["ink"]}">{name}</td>'
                 f'<td style="padding:10px 14px;font-family:{MONO};font-size:12px;'
                 f'color:{p["muted"]}">{occ}</td>'
                 f'<td style="padding:10px 14px">{safety(lv, 20) if lv else ""}</td>'
                 f'<td style="padding:10px 14px">{chip_hb(p, tag, tone)}</td>'
                 f'<td style="padding:10px 14px;text-align:right;font-family:{SANS};font-size:13px;'
                 f'color:{p["primary"]}">Open</td></tr>')

    stats = ""
    for name, val, col in (("Head", "24", None), ("Pens in use", "4 <span style='font-size:14px;color:%s'>of 9</span>" % p["muted"], None),
                           ("Tanks uncovered", "3", p["alert"]), ("Eggs this week", "84", None)):
        stats += (f'<div style="flex:1;background:{p["surface"]};border:1px solid {p["rule"]};'
                  f'border-radius:3px;padding:12px 14px">{lbl(p, name)}'
                  f'<div style="font-family:{SERIF};font-variant-numeric:tabular-nums;font-size:28px;'
                  f'font-weight:600;color:{col or p["ink"]};margin-top:2px">{val}</div></div>')

    return f'''<div style="width:1440px;height:900px;background:{p["ground"]};color:{p["ink"]};
    font-family:{SANS};display:flex;overflow:hidden">
  {sidebar(p, 0)}
  <main style="flex:1;min-width:0;padding:28px 34px;display:flex;flex-direction:column;gap:20px">
    <div style="display:flex;align-items:flex-end;justify-content:space-between;
                border-bottom:1px solid {p["muted"]}55;padding-bottom:14px">
      <div>{lbl(p, "Thursday · 13 August", 11)}
        <div style="font-family:{SERIF};font-size:36px;font-weight:600;letter-spacing:-0.02em;
                    margin-top:3px">Today</div></div>
      <div style="display:flex;gap:10px">{btn(p, "Log weight", "ghost")}{btn(p, "Add animal")}</div>
    </div>

    <div style="background:{p["surface"]};border:1px solid {p["rule"]};
                border-left:4px solid {p["alert"]};border-radius:3px;padding:15px 18px;
                display:flex;align-items:center;justify-content:space-between">
      <div style="display:flex;align-items:center;gap:16px">
        {chip_hb(p, "Calving watch", "al")}
        <div><div style="font-family:{SERIF};font-size:21px;font-weight:600">Juniper</div>
        <div style="font-family:{MONO};font-size:11px;color:{p["muted"]};margin-top:1px">
        TAG 118 · MAINE-ANJOU · NORTH TRAP</div></div>
      </div>
      <div style="display:flex;align-items:center;gap:26px">
        <div style="width:220px">
          <div style="display:flex;justify-content:space-between;font-family:{SANS};font-size:11px;
                      color:{p["muted"]};margin-bottom:5px"><span>Gestation</span>
            <span style="font-family:{MONO};color:{p["ink"]}">279 / 283</span></div>
          <div style="height:6px;border-radius:3px;background:{p["rule"]};overflow:hidden">
            <div style="height:100%;width:98.6%;background:{p["alert"]}"></div></div>
        </div>
        {btn(p, "Open", "ghost")}
      </div>
    </div>

    <div style="display:flex;gap:12px">{stats}</div>

    <div style="background:{p["surface"]};border:1px solid {p["rule"]};border-radius:3px;
                flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;
                  border-bottom:1px solid {p["muted"]}55">
        {lbl(p, "Pen board", 11)}
        <span style="font-family:{SANS};font-size:13px;color:{p["muted"]}">4 in use · 1 empty</span>
      </div>
      <table style="width:100%;border-collapse:collapse">{rows}</table>
      <div style="margin-top:auto;padding:12px 14px;border-top:1px solid {p["rule"]};
                  font-family:{SANS};font-size:13px;color:{p["muted"]}">
        Covers go on the evening before. <span style="color:{p["primary"]}">Manage the tanks</span>
      </div>
    </div>
  </main>
</div>'''


# ═══ 2 · desktop herd list ═══════════════════════════════════════════════
HERD = [
    ("Juniper", "118", "Maine-Anjou", "Cow", "1,184", "North Trap", 4, "Bred"),
    ("Marigold", "204", "Chianina", "Cow", "1,326", "Creek Pen", 2, "Open"),
    ("Willow", "092", "Shorthorn", "Cow", "1,241", "Creek Pen", 2, "Bred"),
    ("Comet", "311", "Maine-Anjou", "Heifer", "842", "South Trap", 2, "Show"),
    ("Bandit", "277", "Chianina", "Steer", "1,020", "South Trap", 3, "Show"),
    ("Nutmeg", "153", "Shorthorn", "Cow", "1,178", "Creek Pen", 2, "Bred"),
    ("Rook", "298", "Maine-Anjou", "Bull", "1,904", "Barn Stall", 4, "Herd sire"),
    ("Clover", "331", "Shorthorn", "Heifer", "688", "South Trap", 2, "Growing"),
]


def desktop_herd(p):
    rows = ""
    for nm, tag, breed, kind, wt, pen, lv, status in HERD:
        tone = "a" if status in ("Show", "Herd sire") else "ok" if status == "Bred" else "q"
        rows += (f'<tr style="border-bottom:1px solid {p["rule"]}">'
                 f'<td style="padding:9px 14px"><div style="font-family:{SERIF};font-size:15.5px;'
                 f'font-weight:600">{nm}</div></td>'
                 f'<td style="padding:9px 14px;font-family:{MONO};font-size:12.5px;'
                 f'color:{p["muted"]}">{tag}</td>'
                 f'<td style="padding:9px 14px;font-family:{SANS};font-size:14px">{breed}</td>'
                 f'<td style="padding:9px 14px;font-family:{SANS};font-size:14px;'
                 f'color:{p["muted"]}">{kind}</td>'
                 f'<td style="padding:9px 14px;text-align:right;font-family:{SERIF};font-size:15px;'
                 f'font-variant-numeric:tabular-nums;font-weight:600">{wt}</td>'
                 f'<td style="padding:9px 14px;font-family:{SANS};font-size:14px;'
                 f'color:{p["muted"]}">{pen}</td>'
                 f'<td style="padding:9px 14px">{safety(lv, 20)}</td>'
                 f'<td style="padding:9px 14px">{chip_hb(p, status, tone)}</td></tr>')

    heads = ""
    for h, align in (("Name", "left"), ("Tag", "left"), ("Breed", "left"), ("Class", "left"),
                     ("Weight", "right"), ("Pen", "left"), ("Safety", "left"), ("Status", "left")):
        heads += (f'<th scope="col" style="padding:9px 14px;text-align:{align};font-family:{SANS};'
                  f'font-size:10px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;'
                  f'color:{p["muted"]};border-bottom:1px solid {p["muted"]}55">{h}</th>')

    filters = ""
    for f, on in (("All", True), ("Cows", False), ("Heifers", False), ("Steers", False),
                  ("Bulls", False), ("On program", False)):
        filters += (f'<span style="display:inline-flex;align-items:center;height:30px;padding:0 13px;'
                    f'border:1px solid {p["primary"] if on else p["rule"]};border-radius:3px;'
                    f'background:{p["primary"] + "10" if on else "transparent"};'
                    f'color:{p["primary"] if on else p["muted"]};font-family:{SANS};font-size:13px;'
                    f'font-weight:{600 if on else 400}">{f}</span>')

    return f'''<div style="width:1440px;height:900px;background:{p["ground"]};color:{p["ink"]};
    font-family:{SANS};display:flex;overflow:hidden">
  {sidebar(p, 1)}
  <main style="flex:1;min-width:0;padding:28px 34px;display:flex;flex-direction:column;gap:16px">
    <div style="display:flex;align-items:flex-end;justify-content:space-between;
                border-bottom:1px solid {p["muted"]}55;padding-bottom:14px">
      <div>{lbl(p, "Cattle", 11)}
        <div style="font-family:{SERIF};font-size:36px;font-weight:600;letter-spacing:-0.02em;
                    margin-top:3px">Herd</div>
        <div style="font-family:{SANS};font-size:14px;color:{p["muted"]};margin-top:3px">
          24 active · 3 sold this year</div></div>
      <div style="display:flex;gap:10px">{btn(p, "Export", "ghost")}{btn(p, "Add animal")}</div>
    </div>

    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      <div style="display:flex;align-items:center;gap:9px;height:36px;padding:0 12px;
                  background:{p["surface"]};border:1px solid {p["rule"]};border-radius:3px;
                  width:260px">
        <span style="color:{p["muted"]};font-size:14px">⌕</span>
        <span style="font-family:{SANS};font-size:14px;color:{p["muted"]}">Name or tag…</span>
      </div>
      {filters}
    </div>

    <div style="background:{p["surface"]};border:1px solid {p["rule"]};border-radius:3px;
                flex:1;min-height:0;overflow:hidden">
      <table style="width:100%;border-collapse:collapse"><thead><tr>{heads}</tr></thead>
      <tbody>{rows}</tbody></table>
    </div>
  </main>
</div>'''


# ═══ 3 · desktop animal detail — the hard screen ═════════════════════════
TABS = ["Overview", "Breeding", "Calving", "Health", "Weights", "Feed",
        "Pedigree", "Sales", "Photos"]

HEALTH = [("12 Aug", "Ivermectin pour-on", "Routine", "Eli"),
          ("2 Jul", "Vitamin A/D/E", "Routine", "Eli"),
          ("18 May", "Foot trim — left rear", "Lameness", "Dr. Reyes"),
          ("4 Apr", "Bangs vaccination", "Required", "Dr. Reyes")]


def desktop_animal(p):
    tabs = ""
    for i, t in enumerate(TABS):
        on = i == 0
        tabs += (f'<span style="padding:9px 13px 11px;font-family:{SANS};font-size:14px;'
                 f'color:{p["ink"] if on else p["muted"]};font-weight:{600 if on else 400};'
                 f'border-bottom:2px solid {p["primary"] if on else "transparent"};'
                 f'margin-bottom:-1px;white-space:nowrap">{t}</span>')

    facts = ""
    for k, v in (("Date of birth", "14 March 2022"), ("Registration", "MA 4612093"),
                 ("Breed", "Maine-Anjou"), ("Colour", "Black, white face"),
                 ("Sire", "Ridgeline Monarch"), ("Dam", "Galaxy Farm Willow"),
                 ("Halter", "Red"), ("Acquired", "Born on farm")):
        facts += (f'<div style="display:flex;flex-direction:column;gap:2px">{lbl(p, k, 9)}'
                  f'<div style="font-family:{SANS};font-size:14.5px;'
                  f'font-variant-numeric:tabular-nums">{v}</div></div>')

    health = ""
    for d, what, why, who in HEALTH:
        health += (f'<tr style="border-bottom:1px solid {p["rule"]}">'
                   f'<td style="padding:7px 0;font-family:{MONO};font-size:11.5px;'
                   f'color:{p["muted"]};white-space:nowrap">{d}</td>'
                   f'<td style="padding:7px 12px;font-family:{SANS};font-size:13.5px">{what}</td>'
                   f'<td style="padding:7px 0">{chip_hb(p, why, "q")}</td>'
                   f'<td style="padding:7px 0;text-align:right;font-family:{SANS};font-size:12.5px;'
                   f'color:{p["muted"]};white-space:nowrap">{who}</td></tr>')

    return f'''<div style="width:1440px;height:960px;background:{p["ground"]};color:{p["ink"]};
    font-family:{SANS};display:flex;overflow:hidden">
  {sidebar(p, 1, 960)}
  <main style="flex:1;min-width:0;padding:26px 34px 30px;display:flex;flex-direction:column;gap:16px;
               overflow:hidden">

    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:20px">
      <div style="min-width:0">
        <div style="font-family:{SANS};font-size:11px;font-weight:600;letter-spacing:.14em;
                    text-transform:uppercase;color:{p["muted"]}">
          Cattle · Herd · <span style="color:{p["primary"]}">Juniper</span></div>
        <div style="display:flex;align-items:baseline;gap:14px;margin-top:4px">
          <span style="font-family:{SERIF};font-size:40px;font-weight:600;
                       letter-spacing:-0.025em">Juniper</span>
          <span style="font-family:{MONO};font-size:15px;color:{p["muted"]}">TAG 118</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:9px;flex-wrap:wrap">
          {safety(4, 24)}
          {chip_hb(p, "Calving window", "al")}
          {chip_hb(p, "Papered", "q")}
          {chip_hb(p, "Maine-Anjou", "q")}
          {chip_hb(p, "North Trap", "q")}
        </div>
      </div>
      <div style="display:flex;gap:9px;flex:none">
        {btn(p, "Log weight", "ghost")}{btn(p, "Record health", "ghost")}{btn(p, "Edit")}
      </div>
    </div>

    <div style="display:flex;gap:2px;border-bottom:1px solid {p["muted"]}55;overflow:hidden">{tabs}</div>

    <div style="display:grid;grid-template-columns:1.45fr 1fr;gap:18px;align-items:start">
      <div style="display:flex;flex-direction:column;gap:18px;min-width:0">

        <div style="background:{p["surface"]};border:1px solid {p["rule"]};border-radius:3px;
                    padding:16px 18px">
          <div style="display:flex;align-items:baseline;justify-content:space-between;
                      margin-bottom:14px">
            {lbl(p, "Weigh-ins", 10)}
            <div style="display:flex;align-items:baseline;gap:16px">
              <span style="font-family:{SANS};font-size:12px;color:{p["muted"]}">Average daily gain</span>
              <span style="font-family:{SERIF};font-size:19px;font-weight:600;
                           font-variant-numeric:tabular-nums">1.88 <span
                style="font-size:12px;color:{p["muted"]};font-family:{SANS};font-weight:400">lb/day</span></span>
            </div>
          </div>
          {weight_chart(p, 600, 196)}
        </div>

        <div style="background:{p["surface"]};border:1px solid {p["rule"]};border-radius:3px;
                    padding:16px 18px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
            {lbl(p, "Health record", 10)}
            <span style="font-family:{SANS};font-size:13px;color:{p["primary"]}">All 18 entries</span>
          </div>
          <table style="width:100%;border-collapse:collapse">{health}</table>
        </div>

        <div style="background:{p["surface"]};border:1px solid {p["rule"]};border-radius:3px;
                    padding:16px 18px">
          <div style="display:flex;align-items:center;justify-content:space-between;
                      margin-bottom:12px">
            {lbl(p, "Feeding", 10)}
            {chip_hb(p, "Late gestation", "a")}
          </div>
          <div style="display:flex;flex-direction:column;gap:9px">
            <div style="display:flex;justify-content:space-between;align-items:baseline;
                        padding-bottom:8px;border-bottom:1px solid {p["rule"]}">
              <span style="font-family:{SANS};font-size:14px">Coastal hay, free choice</span>
              <span style="font-family:{MONO};font-size:12px;color:{p["muted"]}">AM + PM</span></div>
            <div style="display:flex;justify-content:space-between;align-items:baseline;
                        padding-bottom:8px;border-bottom:1px solid {p["rule"]}">
              <span style="font-family:{SANS};font-size:14px">Breeder cube, 4 lb</span>
              <span style="font-family:{MONO};font-size:12px;color:{p["muted"]}">AM</span></div>
            <div style="display:flex;justify-content:space-between;align-items:baseline">
              <span style="font-family:{SANS};font-size:14px">Mineral tub</span>
              <span style="font-family:{MONO};font-size:12px;color:{p["muted"]}">Free choice</span></div>
          </div>
          <div style="margin-top:12px;padding-top:11px;border-top:1px solid {p["rule"]};
                      font-family:{SANS};font-size:12.5px;color:{p["muted"]}">
            Bag runs out in 9 days at this rate.
            <span style="color:{p["primary"]}">Feed plans</span>
          </div>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:18px;min-width:0">
        <div style="background:{p["surface"]};border:1px solid {p["rule"]};
                    border-left:4px solid {p["alert"]};border-radius:3px;padding:15px 17px">
          {lbl(p, "Calving watch", 10)}
          <div style="display:flex;align-items:baseline;gap:9px;margin:6px 0 10px">
            <span style="font-family:{SERIF};font-size:30px;font-weight:600;
                         font-variant-numeric:tabular-nums;color:{p["alert"]}">Day 279</span>
            <span style="font-family:{SANS};font-size:14px;color:{p["muted"]}">of 283</span>
          </div>
          <div style="height:6px;border-radius:3px;background:{p["rule"]};overflow:hidden">
            <div style="height:100%;width:98.6%;background:{p["alert"]}"></div></div>
          <div style="font-family:{SANS};font-size:12.5px;color:{p["muted"]};margin-top:9px">
            Bred 4 Nov to Ridgeline Monarch · due 13–17 August</div>
        </div>

        <div style="background:{p["surface"]};border:1px solid {p["rule"]};border-radius:3px;
                    padding:16px 18px">
          {lbl(p, "Pedigree", 10)}
          <div style="margin-top:12px">{pedigree_grid(p)}</div>
        </div>

        <div style="background:{p["surface"]};border:1px solid {p["rule"]};border-radius:3px;
                    padding:16px 18px">
          {lbl(p, "Facts", 10)}
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px 18px;margin-top:12px">
            {facts}</div>
        </div>
      </div>
    </div>
  </main>
</div>'''


# ═══ 4 · desktop form, with every input state ════════════════════════════
def field(p, label, value, state="default", hint=None):
    border, ink, extra = p["rule"], p["ink"], ""
    if state == "focus":
        border, extra = p["primary"], f"box-shadow:0 0 0 3px {p['primary']}26;"
    elif state == "error":
        border = p["alert"]
    elif state == "disabled":
        border, ink, extra = p["rule"], p["muted"] + "99", f"background:{p['ground']};"
    hint_html = ""
    if hint:
        col = p["alert"] if state == "error" else p["muted"]
        hint_html = (f'<div style="font-family:{SANS};font-size:12px;color:{col};'
                     f'margin-top:4px">{hint}</div>')
    return (f'<div style="display:flex;flex-direction:column;gap:5px">{lbl(p, label, 9)}'
            f'<div style="height:36px;border:1px solid {border};border-radius:3px;'
            f'background:{p["surface"]};{extra}display:flex;align-items:center;padding:0 11px;'
            f'font-family:{SANS};font-size:14px;color:{ink}">{value}</div>{hint_html}</div>')


def desktop_form(p):
    return f'''<div style="width:1060px;height:660px;background:{p["ground"]};color:{p["ink"]};
    font-family:{SANS};padding:26px 30px;display:flex;flex-direction:column;gap:18px;overflow:hidden">
  <div style="display:flex;align-items:flex-end;justify-content:space-between;
              border-bottom:1px solid {p["muted"]}55;padding-bottom:13px">
    <div>{lbl(p, "Cattle · Herd", 10)}
      <div style="font-family:{SERIF};font-size:29px;font-weight:600;letter-spacing:-0.02em;
                  margin-top:3px">Edit Juniper</div></div>
    <div style="display:flex;gap:9px">{btn(p, "Cancel", "ghost")}{btn(p, "Save changes")}</div>
  </div>

  <div style="background:{p["alert"]}0f;border:1px solid {p["alert"]}44;border-radius:3px;
              padding:11px 14px;display:flex;align-items:center;gap:11px">
    <span style="color:{p["alert"]};font-size:15px">!</span>
    <span style="font-family:{SANS};font-size:13.5px;color:{p["alert"]}">
      Two fields need attention before this can be saved.</span>
  </div>

  <div style="background:{p["surface"]};border:1px solid {p["rule"]};border-radius:3px;
              padding:20px 22px;display:flex;flex-direction:column;gap:20px;flex:1">
    <div>
      <div style="display:flex;align-items:center;gap:11px;margin-bottom:14px">
        {lbl(p, "Identity", 9)}
        <span style="flex:1;height:1px;background:{p["rule"]}"></span></div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">
        {field(p, "Name", "Juniper")}
        {field(p, "Tag number", "118", "focus", "Being edited")}
        {field(p, "Registration", "MA 4612093")}
      </div>
    </div>

    <div>
      <div style="display:flex;align-items:center;gap:11px;margin-bottom:14px">
        {lbl(p, "Breeding", 9)}
        <span style="flex:1;height:1px;background:{p["rule"]}"></span></div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">
        {field(p, "Bred on", "4 November 2024")}
        {field(p, "Calved on", "2 October 2024", "error",
               "A calving date cannot precede its breeding date.")}
        {field(p, "Sire", "Ridgeline Monarch")}
      </div>
    </div>

    <div>
      <div style="display:flex;align-items:center;gap:11px;margin-bottom:14px">
        {lbl(p, "Placement", 9)}
        <span style="flex:1;height:1px;background:{p["rule"]}"></span></div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">
        {field(p, "Pen", "North Trap")}
        {field(p, "Safety level", "4 — handle with a second person", "error",
               "Required when the animal is in a shared pen.")}
        {field(p, "Registry sync", "Locked while an import is running", "disabled")}
      </div>
    </div>

    <div style="margin-top:auto;padding-top:16px;border-top:1px solid {p["rule"]};
                display:flex;align-items:center;justify-content:space-between">
      {btn(p, "Delete animal", "danger")}
      <span style="font-family:{SANS};font-size:12.5px;color:{p["muted"]}">
        Deleting asks you to type the name. It stays in Trash for 30 days.</span>
    </div>
  </div>
</div>'''


# ═══ 5 · component inventory ═════════════════════════════════════════════
def components(p):
    def row(label, content):
        return (f'<div style="display:grid;grid-template-columns:132px 1fr;gap:18px;'
                f'align-items:center;padding:13px 0;border-bottom:1px solid {p["rule"]}">'
                f'{lbl(p, label, 9)}<div style="display:flex;gap:9px;align-items:center;'
                f'flex-wrap:wrap">{content}</div></div>')

    ramp = "".join(
        f'<div style="display:flex;flex-direction:column;align-items:center;gap:4px">'
        f'{safety(l, 30)}<span style="font-family:{MONO};font-size:9.5px;'
        f'color:{p["muted"]}">{SAFETY[l][1:].upper()}</span></div>' for l in sorted(SAFETY))

    swatches = "".join(
        f'<div style="display:flex;flex-direction:column;gap:5px;min-width:78px">'
        f'<span style="height:34px;border-radius:3px;background:{p[k]};'
        f'border:1px solid {p["rule"]}"></span>'
        f'<span style="font-family:{SANS};font-size:10.5px;color:{p["muted"]}">{name}</span>'
        f'<span style="font-family:{MONO};font-size:9.5px;color:{p["muted"]}">{p[k].upper()}</span>'
        f'</div>'
        for name, k in (("Ground", "ground"), ("Surface", "surface"), ("Rule", "rule"),
                        ("Muted", "muted"), ("Ink", "ink"), ("Primary", "primary"),
                        ("Confirm", "ok"), ("Alert", "alert")))

    return f'''<div style="width:1060px;height:720px;background:{p["ground"]};color:{p["ink"]};
    font-family:{SANS};padding:26px 30px;overflow:hidden;display:flex;flex-direction:column;gap:16px">
  <div>
    <div style="font-family:{SERIF};font-size:27px;font-weight:600;
                letter-spacing:-0.02em">Component inventory</div>
    <div style="font-family:{SANS};font-size:13.5px;color:{p["muted"]};margin-top:3px">
      Every state a palette has to survive, in one place.</div>
  </div>

  <div style="display:flex;gap:12px;flex-wrap:wrap">{swatches}</div>

  <div style="background:{p["surface"]};border:1px solid {p["rule"]};border-radius:3px;
              padding:4px 20px 8px;flex:1;overflow:hidden">
    {row("Buttons", btn(p, "Primary") + btn(p, "Secondary", "ghost") + btn(p, "Destructive", "danger") + btn(p, "Disabled", "disabled"))}
    {row("Stamps", chip_hb(p, "Papered") + chip_hb(p, "Calving window", "al") + chip_hb(p, "Bred", "ok") + chip_hb(p, "On program", "a"))}
    {row("Safety scale", f'<div style="display:flex;gap:11px">{ramp}</div>')}
    {row("Fields", f'<div style="display:flex;gap:12px;width:100%">'
                   f'<div style="flex:1">{field(p, "Default", "Juniper")}</div>'
                   f'<div style="flex:1">{field(p, "Focus", "118", "focus")}</div>'
                   f'<div style="flex:1">{field(p, "Error", "2 Oct", "error")}</div>'
                   f'<div style="flex:1">{field(p, "Disabled", "Locked", "disabled")}</div></div>')}
    {row("Link", f'<span style="font-family:{SANS};font-size:14px;color:{p["primary"]};'
                 f'text-decoration:underline;text-underline-offset:3px">Manage the tanks</span>'
                 f'<span style="font-family:{SANS};font-size:14px;color:{p["muted"]}">·</span>'
                 f'<span style="font-family:{SANS};font-size:14px;color:{p["muted"]};'
                 f'text-decoration:underline;text-underline-offset:3px">Visited</span>')}
    {row("Meter", f'<div style="width:280px"><div style="height:6px;border-radius:3px;'
                  f'background:{p["rule"]};overflow:hidden"><div style="height:100%;width:66%;'
                  f'background:{p["primary"]}"></div></div></div>'
                  f'<div style="width:280px"><div style="height:6px;border-radius:3px;'
                  f'background:{p["rule"]};overflow:hidden"><div style="height:100%;width:98.6%;'
                  f'background:{p["alert"]}"></div></div></div>')}
  </div>
</div>'''


# ═══ 6–8 · mobile, Operations ════════════════════════════════════════════
def _mob_shell(p, body, active=0, chrome=True):
    bottom = ""
    for i, (g, name) in enumerate(NAV):
        on = i == active
        bottom += (f'<div style="flex:1;display:flex;flex-direction:column;align-items:center;'
                   f'justify-content:center;gap:3px;height:58px;'
                   f'color:{p["primary"] if on else p["muted"]}">'
                   f'<span style="font-size:17px;line-height:1">{g}</span>'
                   f'<span style="font-family:{INTER};font-size:10px;'
                   f'font-weight:{600 if on else 400}">{name}</span></div>')
    top = (f'<div style="height:52px;flex:none;background:{p["surface"]};'
           f'border-bottom:1px solid {p["rule"]};display:flex;align-items:center;'
           f'justify-content:space-between;padding:0 14px">'
           f'<div style="display:flex;align-items:center;gap:9px">{mark(p, 24)}'
           f'<span style="font-family:{INTER};font-size:16px;font-weight:600;'
           f'letter-spacing:-0.02em">Galaxy Farm</span></div>'
           f'<span style="width:8px;height:8px;border-radius:50%;background:{p["ok"]}"></span>'
           f'</div>') if chrome else ""
    return f'''<div style="width:390px;height:844px;background:{p["ground"]};color:{p["ink"]};
    font-family:{INTER};display:flex;flex-direction:column;overflow:hidden">
  {top}{body}
  <nav style="flex:none;background:{p["surface"]};border-top:1px solid {p["rule"]};
              display:flex;padding-bottom:8px">{bottom}</nav>
</div>'''


def mobile_today(p):
    stats = ""
    for name, val, col in (("Head", "24", p["ink"]), ("Pens", "4/9", p["ink"]),
                           ("Uncovered", "3", p["alert"])):
        stats += (f'<div style="flex:1;background:{p["surface"]};border:1px solid {p["rule"]};'
                  f'border-radius:10px;padding:11px 12px;box-shadow:0 1px 2px rgb(0 0 0/4%)">'
                  f'<div style="font-family:{INTER};font-size:11px;color:{p["muted"]}">{name}</div>'
                  f'<div style="font-variant-numeric:tabular-nums;font-size:24px;font-weight:600;'
                  f'letter-spacing:-0.02em;color:{col};margin-top:1px">{val}</div></div>')

    rows = ""
    for nm, occ, lv, tag in PENS[:4]:
        tone = "al" if lv >= 4 else "ok" if lv == 2 else "a"
        rows += (f'<div style="display:flex;align-items:center;justify-content:space-between;'
                 f'gap:10px;min-height:44px;padding:10px 0;border-bottom:1px solid {p["rule"]}">'
                 f'<div style="display:flex;align-items:center;gap:11px">{safety(lv, 24)}'
                 f'<div><div style="font-size:15px;font-weight:500">{nm}</div>'
                 f'<div style="font-size:11.5px;color:{p["muted"]}">{occ}</div></div></div>'
                 f'{chip_op(p, tag, tone)}</div>')

    body = f'''<div style="flex:1;padding:14px;display:flex;flex-direction:column;gap:14px;
                overflow:hidden">
    <div><div style="font-size:11.5px;color:{p["muted"]}">Thursday, 13 August</div>
      <div style="font-size:27px;font-weight:600;letter-spacing:-0.025em;margin-top:1px">Today</div></div>

    <div style="background:{p["surface"]};border:1px solid {p["rule"]};
                border-left:3px solid {p["alert"]};border-radius:10px;padding:14px;
                box-shadow:0 1px 2px rgb(0 0 0/4%)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:9px">
        {chip_op(p, "Calving watch", "al")}
        <span style="font-variant-numeric:tabular-nums;font-size:20px;font-weight:600;
                     color:{p["alert"]}">279</span></div>
      <div style="font-size:18px;font-weight:600;letter-spacing:-0.02em">Juniper</div>
      <div style="font-size:11.5px;color:{p["muted"]};margin-top:2px">
        Tag 118 · North Trap · day 279 of 283</div>
      <div style="height:4px;border-radius:2px;background:{p["rule"]};margin-top:11px;overflow:hidden">
        <div style="height:100%;width:98.6%;background:{p["alert"]}"></div></div>
    </div>

    <div style="display:flex;gap:8px">{stats}</div>

    <div style="flex:1;min-height:0">
      <div style="font-size:11.5px;color:{p["muted"]};padding-bottom:6px;
                  border-bottom:1px solid {p["rule"]}">Pen board</div>{rows}</div>

    <div style="height:44px;background:{p["primary"]};color:{p["on_primary"]};border-radius:10px;
                display:flex;align-items:center;justify-content:center;font-size:16px;
                font-weight:600">＋ Log something</div>
  </div>'''
    return _mob_shell(p, body, 0)


def mobile_animal(p):
    tabs = ""
    for i, t in enumerate(["Overview", "Weights", "Health", "Breeding", "Pedigree"]):
        on = i == 0
        tabs += (f'<span style="padding:8px 8px 10px;font-family:{INTER};font-size:13px;'
                 f'color:{p["ink"] if on else p["muted"]};font-weight:{600 if on else 400};'
                 f'border-bottom:2px solid {p["primary"] if on else "transparent"};'
                 f'white-space:nowrap">{t}</span>')

    facts = ""
    for k, v in (("Born", "14 Mar 2022"), ("Breed", "Maine-Anjou"),
                 ("Sire", "Ridgeline Monarch"), ("Dam", "GF Willow"),
                 ("Halter", "Red"), ("Pen", "North Trap")):
        facts += (f'<div style="display:flex;justify-content:space-between;align-items:baseline;'
                  f'padding:9px 0;border-bottom:1px solid {p["rule"]}">'
                  f'<span style="font-size:13px;color:{p["muted"]}">{k}</span>'
                  f'<span style="font-size:14px;font-variant-numeric:tabular-nums">{v}</span></div>')

    body = f'''<div style="flex:1;overflow:hidden;display:flex;flex-direction:column">
    <div style="padding:14px 14px 0">
      <div style="font-size:11px;color:{p["muted"]}">Animals · Herd</div>
      <div style="display:flex;align-items:baseline;gap:10px;margin-top:3px">
        <span style="font-size:28px;font-weight:600;letter-spacing:-0.025em">Juniper</span>
        <span style="font-size:13px;color:{p["muted"]};font-variant-numeric:tabular-nums">118</span>
      </div>
      <div style="display:flex;gap:7px;margin-top:9px;flex-wrap:wrap;align-items:center">
        {safety(4, 22)}{chip_op(p, "Calving window", "al")}{chip_op(p, "Papered")}
      </div>
    </div>

    <div style="display:flex;gap:2px;border-bottom:1px solid {p["rule"]};margin-top:12px;
                padding:0 8px;overflow:hidden">{tabs}</div>

    <div style="flex:1;padding:14px;display:flex;flex-direction:column;gap:13px;overflow:hidden">
      <div style="background:{p["surface"]};border:1px solid {p["rule"]};
                  border-left:3px solid {p["alert"]};border-radius:10px;padding:13px">
        <div style="font-size:11px;color:{p["muted"]}">Calving watch</div>
        <div style="display:flex;align-items:baseline;gap:8px;margin:3px 0 9px">
          <span style="font-size:26px;font-weight:600;color:{p["alert"]};
                       font-variant-numeric:tabular-nums">Day 279</span>
          <span style="font-size:13px;color:{p["muted"]}">of 283</span></div>
        <div style="height:4px;border-radius:2px;background:{p["rule"]};overflow:hidden">
          <div style="height:100%;width:98.6%;background:{p["alert"]}"></div></div>
      </div>

      <div style="background:{p["surface"]};border:1px solid {p["rule"]};border-radius:10px;
                  padding:13px">
        <div style="display:flex;align-items:baseline;justify-content:space-between;
                    margin-bottom:6px">
          <span style="font-size:11px;color:{p["muted"]}">Weigh-ins</span>
          <span style="font-size:13px;font-weight:600;
                       font-variant-numeric:tabular-nums">1.88 lb/day</span></div>
        {weight_chart(p, 330, 128)}
      </div>

      <div style="background:{p["surface"]};border:1px solid {p["rule"]};border-radius:10px;
                  padding:4px 13px 6px;flex:1;min-height:0;overflow:hidden">{facts}</div>
    </div>
  </div>'''
    return _mob_shell(p, body, 1)


def mobile_sheet(p):
    """The Sheet primitive — a log flow over a dimmed list."""
    keys = ""
    for k in ("1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"):
        keys += (f'<div style="height:52px;display:flex;align-items:center;justify-content:center;'
                 f'background:{p["surface"]};border:1px solid {p["rule"]};border-radius:10px;'
                 f'font-family:{INTER};font-size:21px;font-weight:500;'
                 f'font-variant-numeric:tabular-nums">{k}</div>')

    body = f'''<div style="flex:1;position:relative;overflow:hidden">
    <div style="position:absolute;inset:0;padding:14px;display:flex;flex-direction:column;gap:12px;
                filter:blur(1.5px);opacity:.45">
      <div style="font-size:27px;font-weight:600;letter-spacing:-0.025em">Herd</div>
      <div style="height:44px;background:{p["surface"]};border:1px solid {p["rule"]};
                  border-radius:10px"></div>
      <div style="height:60px;background:{p["surface"]};border:1px solid {p["rule"]};
                  border-radius:10px"></div>
      <div style="height:60px;background:{p["surface"]};border:1px solid {p["rule"]};
                  border-radius:10px"></div>
    </div>
    <div style="position:absolute;inset:0;background:{p["ink"]}44"></div>

    <div style="position:absolute;left:0;right:0;bottom:0;background:{p["surface"]};
                border-top:1px solid {p["rule"]};border-radius:16px 16px 0 0;padding:10px 16px 18px;
                box-shadow:0 -12px 34px -14px rgb(0 0 0/32%);display:flex;flex-direction:column;
                gap:14px">
      <div style="width:38px;height:4px;border-radius:2px;background:{p["rule"]};
                  margin:0 auto 2px"></div>
      <div style="display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:19px;font-weight:600;letter-spacing:-0.02em">Log a weight</span>
        <span style="font-size:13px;color:{p["primary"]};font-weight:500">Cancel</span></div>

      <div style="display:flex;align-items:center;gap:11px;padding:11px 12px;
                  background:{p["ground"]};border:1px solid {p["rule"]};border-radius:10px">
        {safety(4, 24)}
        <div style="flex:1;min-width:0"><div style="font-size:15px;font-weight:600">Juniper</div>
        <div style="font-size:11.5px;color:{p["muted"]}">Tag 118 · last 1,092 lb on 10 Jul</div></div>
        <span style="font-size:13px;color:{p["primary"]};font-weight:500">Change</span></div>

      <div style="text-align:center;padding:4px 0 2px">
        <div style="font-size:11px;color:{p["muted"]};margin-bottom:2px">Weight</div>
        <div style="font-size:44px;font-weight:600;letter-spacing:-0.03em;
                    font-variant-numeric:tabular-nums">1,184<span
          style="font-size:19px;color:{p["muted"]};font-weight:400"> lb</span></div>
        <div style="font-size:12px;color:{p["ok"]};margin-top:3px">+92 lb since July · 1.88 lb/day</div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">{keys}</div>

      <div style="height:44px;background:{p["primary"]};color:{p["on_primary"]};border-radius:10px;
                  display:flex;align-items:center;justify-content:center;font-size:16px;
                  font-weight:600">Save weigh-in</div>
    </div>
  </div>'''
    return _mob_shell(p, body, 1)


# ═══ 9–10 · kiosk, Stockman ══════════════════════════════════════════════
def kiosk_penboard(p):
    cards = ""
    for nm, occ, lv, _ in PENS[:4]:
        edge = {4: p["alert"], 3: SAFETY[3], 2: p["ok"], 0: p["rule"]}[lv]
        cards += (f'<div style="flex:1;background:{p["surface"]};border:2px solid {p["ink"]};'
                  f'border-left:10px solid {edge};padding:18px 20px;display:flex;'
                  f'flex-direction:column;gap:11px;min-width:0">'
                  f'<div style="display:flex;align-items:center;justify-content:space-between;gap:12px">'
                  f'<span style="font-family:{COND};font-size:38px;font-weight:600;'
                  f'text-transform:uppercase;letter-spacing:.015em;line-height:1">{nm}</span>'
                  f'{safety(lv, 44, 26)}</div>'
                  f'<div style="font-family:{MONO};font-size:17px;color:{p["muted"]}">{occ.upper()}</div>'
                  f'<div style="margin-top:auto;font-family:{SANS};font-size:15px;'
                  f'color:{p["muted"]}">Juniper · Calf 214</div></div>')

    actions = ""
    for t in ("Log weight", "Treatment", "Move animal", "Eggs"):
        actions += (f'<div style="flex:1;height:80px;display:flex;align-items:center;'
                    f'justify-content:center;background:{p["surface"]};'
                    f'border:3px solid {p["primary"]};color:{p["primary"]};font-family:{COND};'
                    f'font-size:29px;font-weight:600;text-transform:uppercase;'
                    f'letter-spacing:.05em">{t}</div>')

    return f'''<div style="width:1280px;height:800px;background:{p["ground"]};color:{p["ink"]};
    font-family:{SANS};display:flex;flex-direction:column;overflow:hidden">
  <div style="flex:none;background:{p["surface"]};border-bottom:4px solid {p["ink"]};
              padding:18px 24px;display:flex;align-items:center;justify-content:space-between">
    <div style="display:flex;align-items:center;gap:18px">
      {mark(p, 52)}
      <div><div style="font-family:{COND};font-size:46px;font-weight:600;text-transform:uppercase;
                       letter-spacing:.015em;line-height:1">Pen board</div>
      <div style="font-family:{SANS};font-size:17px;color:{p["muted"]};margin-top:4px">
        Thursday 13 August · 6:42 am</div></div>
    </div>
    <div style="display:flex;align-items:center;gap:11px">
      <span style="width:14px;height:14px;border-radius:50%;background:{p["ok"]}"></span>
      <span style="font-family:{SANS};font-size:19px;color:{p["muted"]}">Up to date</span></div>
  </div>

  <div style="flex:none;background:{p["alert"]};color:#fff;padding:15px 24px;display:flex;
              align-items:center;justify-content:space-between">
    <div style="display:flex;align-items:center;gap:20px">
      <span style="font-family:{COND};font-size:36px;font-weight:700;text-transform:uppercase;
                   letter-spacing:.04em">Calving watch</span>
      <span style="font-family:{COND};font-size:36px;font-weight:600;
                   text-transform:uppercase">Juniper · 118</span></div>
    <span style="font-variant-numeric:tabular-nums;font-size:31px;font-weight:700">Day 279 / 283</span>
  </div>

  <div style="flex:1;padding:24px;display:flex;gap:20px;min-height:0">{cards}</div>
  <div style="flex:none;padding:0 24px 24px;display:flex;gap:20px">{actions}</div>
</div>'''


def kiosk_weight(p):
    keys = ""
    for k in ("7", "8", "9", "4", "5", "6", "1", "2", "3", "0", "00", "⌫"):
        keys += (f'<div style="height:88px;display:flex;align-items:center;justify-content:center;'
                 f'background:{p["surface"]};border:3px solid {p["ink"]};font-family:{SANS};'
                 f'font-size:40px;font-weight:600;font-variant-numeric:tabular-nums">{k}</div>')

    return f'''<div style="width:1280px;height:800px;background:{p["ground"]};color:{p["ink"]};
    font-family:{SANS};display:flex;flex-direction:column;overflow:hidden">
  <div style="flex:none;background:{p["surface"]};border-bottom:4px solid {p["ink"]};
              padding:16px 24px;display:flex;align-items:center;justify-content:space-between">
    <div style="display:flex;align-items:center;gap:18px">
      {flag_sk(p, "← Back", "q")}
      <span style="font-family:{COND};font-size:44px;font-weight:600;text-transform:uppercase;
                   letter-spacing:.015em;line-height:1">Log weight</span></div>
    {flag_sk(p, "Level 4", "al")}
  </div>

  <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:24px;min-height:0">
    <div style="display:flex;flex-direction:column;gap:20px;min-width:0">
      <div style="background:{p["surface"]};border:3px solid {p["ink"]};padding:20px 22px;
                  display:flex;align-items:center;gap:18px">
        {safety(4, 56, 32)}
        <div style="min-width:0">
          <div style="font-family:{COND};font-size:42px;font-weight:600;text-transform:uppercase;
                      line-height:1">Juniper</div>
          <div style="font-family:{MONO};font-size:17px;color:{p["muted"]};margin-top:5px">
            TAG 118 · NORTH TRAP</div></div>
      </div>

      <div style="background:{p["surface"]};border:3px solid {p["primary"]};padding:24px;
                  flex:1;display:flex;flex-direction:column;justify-content:center;
                  align-items:center;gap:8px">
        <div style="font-family:{COND};font-size:22px;font-weight:600;letter-spacing:.09em;
                    text-transform:uppercase;color:{p["muted"]}">Weight</div>
        <div style="font-size:92px;font-weight:600;letter-spacing:-0.03em;line-height:1;
                    font-variant-numeric:tabular-nums">1,184</div>
        <div style="font-family:{COND};font-size:26px;font-weight:600;text-transform:uppercase;
                    color:{p["muted"]}">pounds</div>
        <div style="font-family:{SANS};font-size:19px;color:{p["ok"]};margin-top:6px">
          +92 lb since 10 July · 1.88 lb/day</div>
      </div>

      <div style="display:flex;gap:20px">
        <div style="flex:1;height:80px;display:flex;align-items:center;justify-content:center;
                    background:{p["surface"]};border:3px solid {p["rule"]};color:{p["muted"]};
                    font-family:{COND};font-size:29px;font-weight:600;text-transform:uppercase;
                    letter-spacing:.05em">Cancel</div>
        <div style="flex:2;height:80px;display:flex;align-items:center;justify-content:center;
                    background:{p["primary"]};color:{p["on_primary"]};font-family:{COND};
                    font-size:29px;font-weight:600;text-transform:uppercase;
                    letter-spacing:.05em">Save weigh-in</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;align-content:start">
      {keys}</div>
  </div>
</div>'''


# ═══ 11 · the customer portal ════════════════════════════════════════════
def portal(p):
    invoices = ""
    for d, num, amt, status, tone in (("1 Aug", "INV-0142", "$1,850.00", "Paid", "ok"),
                                      ("1 Jul", "INV-0131", "$1,850.00", "Paid", "ok"),
                                      ("1 Jun", "INV-0119", "$1,850.00", "Paid", "ok")):
        invoices += (f'<tr style="border-bottom:1px solid {p["rule"]}">'
                     f'<td style="padding:9px 0;font-family:{MONO};font-size:12px;'
                     f'color:{p["muted"]}">{d}</td>'
                     f'<td style="padding:9px 12px;font-family:{MONO};font-size:12.5px">{num}</td>'
                     f'<td style="padding:9px 12px;text-align:right;font-family:{SERIF};'
                     f'font-size:15px;font-weight:600;font-variant-numeric:tabular-nums">{amt}</td>'
                     f'<td style="padding:9px 0;text-align:right">{chip_hb(p, status, tone)}</td></tr>')

    return f'''<div style="width:1280px;height:900px;background:{p["ground"]};color:{p["ink"]};
    font-family:{SANS};display:flex;flex-direction:column;overflow:hidden">
  <div style="flex:none;background:{p["surface"]};border-bottom:1px solid {p["rule"]};
              padding:16px 40px;display:flex;align-items:center;justify-content:space-between">
    <div style="display:flex;align-items:center;gap:12px">{mark(p, 32)}
      <span style="font-family:{SERIF};font-size:20px;font-weight:600">Galaxy Farm</span>
      <span style="font-family:{SANS};font-size:13px;color:{p["muted"]};
                   border-left:1px solid {p["rule"]};padding-left:12px;margin-left:4px">
        Show Calf Program</span></div>
    <div style="display:flex;align-items:center;gap:22px">
      <span style="font-family:{SANS};font-size:14px;color:{p["muted"]}">My calves</span>
      <span style="font-family:{SANS};font-size:14px;color:{p["muted"]}">Invoices</span>
      <span style="font-family:{SANS};font-size:14px;color:{p["muted"]}">Forms</span>
      <span style="font-family:{SANS};font-size:14px;color:{p["ink"]};font-weight:600">
        Sarah Whitfield</span></div>
  </div>

  <div style="flex:1;padding:34px 40px;display:flex;flex-direction:column;gap:24px;
              max-width:1080px;width:100%;margin:0 auto;min-height:0">
    <div>
      <div style="font-family:{SERIF};font-size:34px;font-weight:600;letter-spacing:-0.02em">
        Your calf, Ember</div>
      <div style="font-family:{SANS};font-size:15px;color:{p["muted"]};margin-top:5px">
        Boarding since 3 March · Fort Worth Stock Show program</div>
    </div>

    <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:24px;flex:1;min-height:0">
      <div style="display:flex;flex-direction:column;gap:20px;min-width:0">
        <div style="background:{p["surface"]};border:1px solid {p["rule"]};border-radius:3px;
                    padding:20px 22px">
          <div style="display:flex;align-items:baseline;justify-content:space-between;
                      margin-bottom:14px">
            {lbl(p, "Growth", 10)}
            <div style="display:flex;align-items:baseline;gap:14px">
              <span style="font-family:{SANS};font-size:12.5px;color:{p["muted"]}">
                Average daily gain</span>
              <span style="font-family:{SERIF};font-size:20px;font-weight:600;
                           font-variant-numeric:tabular-nums">1.88 <span style="font-size:12px;
                color:{p["muted"]};font-family:{SANS};font-weight:400">lb/day</span></span></div>
          </div>
          {weight_chart(p, 600, 200)}
        </div>

        <div style="background:{p["surface"]};border:1px solid {p["rule"]};border-radius:3px;
                    padding:20px 22px;flex:1">
          <div style="display:flex;align-items:center;justify-content:space-between;
                      margin-bottom:12px">{lbl(p, "Invoices", 10)}
            <span style="font-family:{SANS};font-size:13px;color:{p["primary"]}">All invoices</span>
          </div>
          <table style="width:100%;border-collapse:collapse">{invoices}</table>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:20px;min-width:0">
        <div style="background:{p["surface"]};border:1px solid {p["rule"]};border-radius:3px;
                    padding:20px 22px">
          {lbl(p, "This week", 10)}
          <div style="display:flex;flex-direction:column;gap:11px;margin-top:12px">
            <div style="display:flex;justify-content:space-between;align-items:baseline">
              <span style="font-family:{SANS};font-size:14px;color:{p["muted"]}">Current weight</span>
              <span style="font-family:{SERIF};font-size:19px;font-weight:600;
                           font-variant-numeric:tabular-nums">1,184 lb</span></div>
            <div style="display:flex;justify-content:space-between;align-items:baseline">
              <span style="font-family:{SANS};font-size:14px;color:{p["muted"]}">Rinsed and worked</span>
              <span style="font-family:{SANS};font-size:14px">6 of 7 days</span></div>
            <div style="display:flex;justify-content:space-between;align-items:baseline">
              <span style="font-family:{SANS};font-size:14px;color:{p["muted"]}">Next show</span>
              <span style="font-family:{SANS};font-size:14px">Fort Worth · 19 Jan</span></div>
          </div>
        </div>

        <div style="background:{p["surface"]};border:1px solid {p["rule"]};border-radius:3px;
                    padding:20px 22px">
          {lbl(p, "Paperwork", 10)}
          <div style="display:flex;flex-direction:column;gap:10px;margin-top:12px">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="font-family:{SANS};font-size:14px">Liability waiver</span>
              {chip_hb(p, "Signed", "ok")}</div>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="font-family:{SANS};font-size:14px">Boarding agreement</span>
              {chip_hb(p, "Signed", "ok")}</div>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="font-family:{SANS};font-size:14px">Health certificate</span>
              {chip_hb(p, "Due 4 Sep", "al")}</div>
          </div>
        </div>

        <div style="background:{p["surface"]};border:1px solid {p["rule"]};border-radius:3px;
                    padding:20px 22px;flex:1">
          {lbl(p, "Pedigree", 10)}
          <div style="margin-top:12px">{pedigree_grid(p)}</div>
        </div>
      </div>
    </div>
  </div>
</div>'''


SCREENS = [
    ("desktop_dashboard", "Dashboard",        "Desktop · Herd Book",  1440, 900),
    ("desktop_herd",      "Herd list",        "Desktop · Herd Book",  1440, 900),
    ("desktop_animal",    "Animal detail",    "Desktop · Herd Book",  1440, 960),
    ("desktop_form",      "Edit form",        "Desktop · Herd Book",  1060, 660),
    ("components",        "Components",       "Desktop · Herd Book",  1060, 720),
    ("mobile_today",      "Today",            "Mobile · Operations",   390, 844),
    ("mobile_animal",     "Animal detail",    "Mobile · Operations",   390, 844),
    ("mobile_sheet",      "Log sheet",        "Mobile · Operations",   390, 844),
    ("kiosk_penboard",    "Pen board",        "Kiosk · Stockman",     1280, 800),
    ("kiosk_weight",      "Weight entry",     "Kiosk · Stockman",     1280, 800),
    ("portal",            "Customer portal",  "Desktop · Herd Book",  1280, 900),
]


FONT_HREF = (
    "https://fonts.googleapis.com/css2"
    "?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600"
    "&family=IBM+Plex+Sans:wght@400;500;600"
    "&family=IBM+Plex+Mono:wght@400"
    "&family=Barlow+Condensed:wght@600"
    "&family=Inter:wght@400;500;600"
    "&display=swap"
)



FACES = ""  # the preview links Google Fonts instead of inlining them
SHORTLIST = ["olive", "navy", "harbor"]

FAVICON = {"olive": "🌿", "navy": "🖋️", "harbor": "⚓"}

GROUPS = [
    ("The desktop", "Herd Book",
     "Serif names and figures, hairline rules, a ledger table. The three screens "
     "that carry the most weight — and the animal detail page, which is the "
     "hardest screen in the product and the one a direction usually breaks on.",
     ["desktop_dashboard", "desktop_herd", "desktop_animal"]),
    ("Forms and parts", "Herd Book",
     "Where a palette actually fails: focus rings, error states, disabled "
     "controls, and a destructive action that has to look destructive without "
     "shouting. Every state in one place.",
     ["desktop_form", "components"]),
    ("The phone", "Operations",
     "One grotesque, soft cards, tinted chips, a bottom bar. Including the Sheet "
     "primitive proposed in the review — a log flow over a dimmed list, so the "
     "page behind never reflows.",
     ["mobile_today", "mobile_animal", "mobile_sheet"]),
    ("The barn screen", "Stockman",
     "Condensed caps, hard rules, 64 px targets, a solid alert band. No "
     "navigation: the pen board is the screen, and four things you might do "
     "standing in front of it.",
     ["kiosk_penboard", "kiosk_weight"]),
    ("The customer portal", "Herd Book",
     "The surface that has to sell something. A boarding client checking their "
     "calf's growth, their invoices and their paperwork — the screen where "
     "“professional” turns into money.",
     ["portal"]),
]

SCREEN_META = {name: (label, surface, w, h) for name, label, surface, w, h in SCREENS}


def scale_class(w):
    return {1440: "s1440", 1280: "s1280", 1060: "s1060", 390: "s390"}[w]


def figure(p, fn):
    label, surface, w, h = SCREEN_META[fn]
    html = globals()[fn](p)
    return f'''
      <figure class="fr {scale_class(w)}">
        <figcaption>
          <span class="fr-name">{label}</span>
          <span class="fr-surface">{surface}</span>
          <span class="fr-size">{w} × {h}</span>
        </figcaption>
        <div class="fr-scroll">
          <div class="fr-wrap" style="--w:{w}px;--h:{h}px">
            <div class="fr-inner" style="--w:{w}px;--h:{h}px">{html}</div>
          </div>
        </div>
      </figure>'''


def build(p):
    swatches = "".join(
        f'<div class="sw"><span class="sw-chip" style="background:{p[k]}"></span>'
        f'<span class="sw-role">{role}</span>'
        f'<span class="sw-hex">{p[k].upper()}</span></div>'
        for role, k in (("Ground", "ground"), ("Surface", "surface"), ("Rule", "rule"),
                        ("Muted", "muted"), ("Ink", "ink"), ("Primary", "primary"),
                        ("Confirm", "ok"), ("Alert", "alert")))

    got = {what: r for what, r, m, o in audit(p)}
    checks = "".join(
        f'<div class="ck"><span class="ck-n">{got[c]:.2f}</span>'
        f'<span class="ck-l">{c.replace(" on ", " / ")}</span></div>'
        for c in ("ink on ground", "muted on ground", "primary on ground",
                  "label on primary", "alert on ground", "ok on ground"))

    level, hgap, sgap, lrat, clear = safety_clash(p)
    by = "hue" if hgap >= 20 else "saturation" if sgap >= 0.18 else "depth"

    sections = ""
    for title, direction, blurb, screens in GROUPS:
        figs = "".join(figure(p, fn) for fn in screens)
        wrap_class = "views pair" if screens[0].startswith("mobile") else "views"
        sections += f'''
  <section class="group">
    <div class="group-head">
      <div>
        <p class="group-dir">{direction}</p>
        <h2>{title}</h2>
      </div>
      <p class="group-blurb">{blurb}</p>
    </div>
    <div class="{wrap_class}">{figs}</div>
  </section>'''

    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Galaxy Farm mockups - {p["name"]}</title>
<link rel="stylesheet" href="{FONT_HREF}">
<style>
{FACES}

:root {{
  --ground:#f2f2ee; --surface:#ffffff; --sunk:#e9e9e3; --ink:#191a17;
  --muted:#63665e; --rule:#dcdcd4; --rule-firm:#b9b9ae;
  --accent:{p["primary"]}; --alert:#8c3a2b;
}}
@media (prefers-color-scheme: dark) {{
  :root:not([data-theme="light"]) {{
    --ground:#121310; --surface:#1b1d19; --sunk:#24261f; --ink:#edeee7;
    --muted:#989c92; --rule:#2a2d27; --rule-firm:#454940;
    --accent:#8fb39a; --alert:#d4877a;
  }}
}}
:root[data-theme="dark"] {{
  --ground:#121310; --surface:#1b1d19; --sunk:#24261f; --ink:#edeee7;
  --muted:#989c92; --rule:#2a2d27; --rule-firm:#454940;
  --accent:#8fb39a; --alert:#d4877a;
}}

* {{ box-sizing:border-box; }}
body {{
  margin:0; background:var(--ground); color:var(--ink);
  font-family:"IBM Plex Sans", system-ui, sans-serif;
  font-size:16.5px; line-height:1.62; -webkit-font-smoothing:antialiased;
  overflow-x:hidden;
}}
h1,h2,h3 {{ font-family:"Source Serif 4",Georgia,serif; font-weight:600;
           line-height:1.14; margin:0; letter-spacing:-0.02em; text-wrap:balance; }}
p {{ margin:0; }}
code {{ font-family:"IBM Plex Mono",monospace; font-size:.85em; }}
:focus-visible {{ outline:2px solid var(--accent); outline-offset:3px; }}
@media (prefers-reduced-motion: reduce) {{
  *,*::before,*::after {{ animation-duration:.01ms !important; transition-duration:.01ms !important; }}
}}

.wrap {{ max-width:1240px; margin:0 auto; padding:0 clamp(16px,4vw,52px) 110px; }}
.col {{ max-width:66ch; }}
.stack {{ display:flex; flex-direction:column; gap:17px; }}
.eyebrow {{ font-size:11.5px; font-weight:600; letter-spacing:.16em;
           text-transform:uppercase; color:var(--muted); }}
.lede {{ font-size:20px; line-height:1.55; }}
.note {{ font-size:15px; color:var(--muted); line-height:1.6; }}

/* ── Masthead ─────────────────────────────────────────────── */
.masthead {{ padding:clamp(50px,7.5vw,90px) 0 clamp(26px,4vw,42px); }}
.masthead h1 {{ font-size:clamp(42px,7.6vw,86px); letter-spacing:-0.03em; margin:16px 0 22px; }}

.hero-chip {{
  display:inline-flex; align-items:center; gap:13px; margin-bottom:4px;
}}
.hero-chip span.blob {{
  width:44px; height:44px; border-radius:4px; background:{p["primary"]};
  border:1px solid var(--rule-firm); flex:none;
}}
.hero-chip span.hex {{
  font-family:"IBM Plex Mono",monospace; font-size:15px; color:var(--muted);
}}

.swatches {{
  display:grid; grid-template-columns:repeat(2,1fr); gap:1px;
  background:var(--rule); border:1px solid var(--rule); border-radius:4px;
  overflow:hidden; margin-top:38px;
}}
@media (min-width:620px) {{ .swatches {{ grid-template-columns:repeat(4,1fr); }} }}
@media (min-width:1000px) {{ .swatches {{ grid-template-columns:repeat(8,1fr); }} }}
.sw {{ background:var(--ground); padding:13px 14px 15px; display:flex;
      flex-direction:column; gap:7px; min-width:0; }}
.sw-chip {{ height:38px; border-radius:3px; border:1px solid var(--rule-firm); display:block; }}
.sw-role {{ font-size:12px; color:var(--ink); font-weight:600; }}
.sw-hex {{ font-family:"IBM Plex Mono",monospace; font-size:10.5px; color:var(--muted); }}

.checks {{ display:grid; grid-template-columns:repeat(2,1fr); gap:1px;
          background:var(--rule); border:1px solid var(--rule); border-radius:4px;
          overflow:hidden; margin-top:16px; }}
@media (min-width:700px) {{ .checks {{ grid-template-columns:repeat(3,1fr); }} }}
@media (min-width:1060px) {{ .checks {{ grid-template-columns:repeat(6,1fr); }} }}
.ck {{ background:var(--ground); padding:13px 15px; display:flex;
      flex-direction:column; gap:2px; }}
.ck-n {{ font-family:"IBM Plex Mono",monospace; font-size:19px; font-weight:600;
        color:var(--accent); font-variant-numeric:tabular-nums; }}
.ck-l {{ font-size:11.5px; color:var(--muted); line-height:1.35; }}

/* ── Groups ───────────────────────────────────────────────── */
.group {{ padding-top:clamp(56px,7vw,92px); }}
.group-head {{
  display:grid; grid-template-columns:1fr; gap:12px;
  padding-bottom:20px; margin-bottom:24px; border-bottom:1px solid var(--rule-firm);
}}
@media (min-width:940px) {{
  .group-head {{ grid-template-columns:minmax(0,1fr) minmax(0,500px);
                column-gap:48px; align-items:end; }}
}}
.group-dir {{ font-family:"IBM Plex Mono",monospace; font-size:12.5px;
             color:var(--muted); letter-spacing:.1em; }}
.group-head h2 {{ font-size:clamp(28px,4vw,40px); margin-top:5px; }}
.group-blurb {{ font-size:15.5px; line-height:1.55; color:var(--muted); }}

.views {{ display:flex; flex-direction:column; gap:30px; }}
.views.pair {{ flex-direction:row; flex-wrap:wrap; align-items:flex-start; gap:24px; }}

.fr {{ margin:0; display:flex; flex-direction:column; gap:8px; min-width:0; }}
.fr figcaption {{ display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; }}
.fr-name {{ font-size:11.5px; font-weight:600; letter-spacing:.15em;
           text-transform:uppercase; color:var(--ink); }}
.fr-surface {{ font-family:"IBM Plex Mono",monospace; font-size:11.5px; color:var(--muted); }}
.fr-size {{ font-family:"IBM Plex Mono",monospace; font-size:11.5px;
           color:var(--muted); margin-left:auto; opacity:.7; }}
.fr-scroll {{ overflow-x:auto; overflow-y:hidden; max-width:100%; }}
.fr-wrap {{
  width:calc(var(--w) * var(--k)); height:calc(var(--h) * var(--k)); overflow:hidden;
  border:1px solid var(--rule-firm); border-radius:4px;
  box-shadow:0 1px 3px rgb(25 26 23/8%), 0 18px 40px -22px rgb(25 26 23/32%);
}}
.fr-inner {{ width:var(--w); height:var(--h); transform:scale(var(--k)); transform-origin:top left; }}

.s1440 {{ --k:.46; }}  .s1280 {{ --k:.50; }}  .s1060 {{ --k:.60; }}  .s390 {{ --k:.62; }}
@media (min-width:700px)  {{ .s1440 {{ --k:.58; }} .s1280 {{ --k:.62; }} .s1060 {{ --k:.74; }} .s390 {{ --k:.66; }} }}
@media (min-width:940px)  {{ .s1440 {{ --k:.66; }} .s1280 {{ --k:.72; }} .s1060 {{ --k:.86; }} .s390 {{ --k:.72; }} }}
@media (min-width:1180px) {{ .s1440 {{ --k:.78; }} .s1280 {{ --k:.86; }} .s1060 {{ --k:1;   }} .s390 {{ --k:.85; }} }}

.callout {{ border-left:3px solid var(--accent); padding:4px 0 4px 22px;
           display:flex; flex-direction:column; gap:10px; max-width:66ch; }}
.foot {{ margin-top:70px; padding-top:26px; border-top:1px solid var(--rule);
        font-size:14.5px; color:var(--muted); max-width:66ch; }}
</style></head><body>

<div class="wrap">

<header class="masthead">
  <p class="eyebrow">Comprehensive mockups · palette {SHORTLIST.index(p["key"]) + 1} of 3</p>
  <div class="hero-chip"><span class="blob"></span>
    <span class="hex">{p["primary"].upper()}</span></div>
  <h1>{p["name"]}</h1>
  <div class="col stack">
    <p class="lede">{p["story"]}</p>
    <p class="note"><b>Note.</b> {p["note"]}</p>
    <p class="note">
      Eleven screens across all three surfaces, at true device size. Herd Book
      typography on desktop and the customer portal, Operations on the phone,
      Stockman on the barn screen — one palette holding all three together.
    </p>
  </div>

  <div class="swatches">{swatches}</div>
  <div class="checks">{checks}</div>
  <p class="note" style="margin-top:14px;max-width:66ch">
    Every pair clears WCAG AA for body text at 4.5:1. The primary separates from
    the nearest safety-scale green — level {level} — by <b>{by}</b>:
    {hgap:.1f}° of hue, {lrat:.2f}:1 contrast. Computed by
    <code>tools/palette-audit.py</code>.
  </p>
</header>
{sections}

<section class="group">
  <div class="group-head">
    <div><p class="group-dir">What to look for</p><h2>Judging it</h2></div>
    <p class="group-blurb">Four places a palette usually gives itself away, and
    where to find each on this page.</p>
  </div>
  <div class="col stack">
    <ul style="margin:0;padding-left:21px;display:flex;flex-direction:column;gap:10px">
      <li style="font-size:16px;line-height:1.55"><b>The safety chips against the
      primary.</b> On the herd list and the animal detail header they sit inches
      apart. If the primary ever reads as a safety level, it shows there first.</li>
      <li style="font-size:16px;line-height:1.55"><b>The error state on the edit
      form.</b> Alert red has to beat the primary for attention without the two
      fighting. Two fields are deliberately in error.</li>
      <li style="font-size:16px;line-height:1.55"><b>The kiosk alert band.</b> The
      only large saturated fill in the product. It is the loudest the palette
      ever gets.</li>
      <li style="font-size:16px;line-height:1.55"><b>The customer portal.</b> The
      one surface a stranger judges. If the palette reads as a hobby anywhere, it
      reads that way here.</li>
    </ul>
    <div class="callout">
      <p>The safety ramp is identical on all three of these pages and outside
      every palette, exactly as §8 requires — including the amber corrected to
      <code>#BC811C</code> so it clears 3.0 against a light ground.</p>
    </div>
  </div>

  <p class="foot">
    These are compositions, not a running app. They settle how the palette
    behaves across surfaces, states and densities, which is what the choice
    turns on — but the weight chart's crosshair, the sheet's drag, and the tab
    strip's keyboard behaviour are all real work that these pages only imply.
  </p>
</section>

</div>
</body></html>
'''


def ascii_safe(doc: str) -> str:
    """
    Emit pure ASCII.

    The mockups are full of typographic characters — middots between facts, en
    dashes in date ranges, the nav glyphs. Served without a charset the browser
    guesses, and a page that guesses Latin-1 renders every one of them as
    mojibake. Numeric entities cannot be misread, and they cost nothing.

    Entities are not a thing inside a stylesheet, so the style block is folded
    to ASCII separately — the only non-ASCII in there is box drawing in
    comments.
    """
    head, sep, tail = doc.partition("</style>")
    head = "".join(c if ord(c) < 128 else "-" for c in head)
    tail = "".join(c if ord(c) < 128 else f"&#{ord(c)};" for c in tail)
    return head + sep + tail


ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "docs" / "mockups"


if __name__ == "__main__":
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    chosen = [p for k in SHORTLIST for p in PALETTES if p["key"] == k]
    for p in chosen:
        out_path = OUT_DIR / f'{p["key"]}.html'
        out_path.write_text(ascii_safe(build(p)), encoding="ascii")
        print(f'{p["name"]:<14} -> {out_path.relative_to(ROOT)}  ({out_path.stat().st_size/1024:.0f} KB)')
