#!/usr/bin/env python3
"""
Testable prototypes, one self-contained file per shortlisted palette
(docs/ui-redesign.md).

    python3 tools/render-prototypes.py

Not the presentation boards in docs/mockups/. Those show fixed-size device
frames scaled down, which is exactly the wrong thing to open on a phone. These
are the real responsive article: the layout switches at the same 48rem
`packages/ui/src/tokens/theme.css` switches at, so a phone gets Operations at
true size with a bottom bar and a laptop gets Herd Book with a sidebar. The
control strip in the corner forces the kiosk density, or add ?kiosk to the URL.

Which means the prototype is built the way the redesign is actually proposed:
one set of colour tokens, three type-and-shape treatments selected by density,
nothing branching on which palette is in use. If it holds together here it
holds together in the app.

The webfonts are inlined, so a file works with no network at all - opened off
the filesystem, AirDropped to a phone, or sitting in a barn at zero bars. That
is what makes the page about 760 KB.

Output is pure ASCII, because a page served without a charset is a page whose
encoding the browser guesses. Note that entities are decoded in markup but NOT
inside <script>, so any non-ASCII character the behaviour depends on is
written as a JavaScript escape sequence rather than as a literal.
"""

import pathlib

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
OUT_DIR = ROOT / "docs" / "prototypes"

# The webfont data and the palette values both live beside this file, so a
# prototype cannot drift from the audit that validated its colours.
FACES = (HERE / "webfonts.css").read_text(encoding="utf-8")

_audit = HERE / "palette-audit.py"
_ns: dict = {}
exec(compile(_audit.read_text(encoding="utf-8"), str(_audit), "exec"), _ns)
PALETTES = {p["key"]: p for p in _ns["PALETTES"]}

SHORTLIST = ["olive", "navy", "harbor"]

CSS = r"""
__FACES__

/* ══ Tokens ══════════════════════════════════════════════════════════
   Palette is fixed; density and type treatment switch with the surface,
   which is the whole proposal in one block.                          */
:root {
  --ground:__GROUND__; --surface:__SURFACE__; --ink:__INK__;
  --muted:__MUTED__;   --rule:__RULE__;       --primary:__PRIMARY__;
  --on-primary:__ONPRIMARY__; --alert:__ALERT__; --ok:__OK__;

  --s1:#2f6b3d; --s2:#3f8f4f; --s3:#bc811c; --s4:#c0392b; --s5:#8e1f14;
  --s1-ink:#fff; --s2-ink:#111; --s3-ink:#111; --s4-ink:#fff; --s5-ink:#fff;

  /* Mobile — Operations */
  --target:44px; --text:16px; --gap:14px; --radius:10px;
  --font-display:Inter, system-ui, sans-serif;
  --font-ui:Inter, system-ui, sans-serif;
  --font-num:Inter, system-ui, sans-serif;
  --font-mono:"IBM Plex Mono", ui-monospace, monospace;
  --display-weight:600; --display-tracking:-0.022em; --display-case:none;
  --chip-radius:6px; --chip-fill:1; --card-shadow:0 1px 2px rgb(0 0 0/5%);
  --border-w:1px;
}

/* Desktop — Herd Book. Same breakpoint theme.css already uses. */
@media (min-width:48rem) {
  :root {
    --target:36px; --text:15px; --gap:12px; --radius:3px;
    --font-display:"Source Serif 4", Georgia, serif;
    --font-ui:"IBM Plex Sans", system-ui, sans-serif;
    --font-num:"Source Serif 4", Georgia, serif;
    --display-weight:600; --display-tracking:-0.02em; --display-case:none;
    --chip-radius:2px; --chip-fill:0; --card-shadow:none;
    --border-w:1px;
  }
}

/* Kiosk — Stockman. Forced, never inferred from the viewport. */
:root[data-density="kiosk"] {
  --target:64px; --text:20px; --gap:20px; --radius:0px;
  --font-display:"Barlow Condensed", "Arial Narrow", sans-serif;
  --font-ui:"IBM Plex Sans", system-ui, sans-serif;
  --font-num:"IBM Plex Sans", system-ui, sans-serif;
  --display-weight:600; --display-tracking:.015em; --display-case:uppercase;
  --chip-radius:0px; --chip-fill:2; --card-shadow:none;
  --border-w:2px;
}

* { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }

html { background:var(--ground); }
body {
  margin:0; background:var(--ground); color:var(--ink);
  font-family:var(--font-ui); font-size:var(--text); line-height:1.5;
  -webkit-font-smoothing:antialiased;
  overflow-x:hidden;
  padding-bottom:env(safe-area-inset-bottom);
}
h1,h2,h3 { margin:0; font-family:var(--font-display); font-weight:var(--display-weight);
           letter-spacing:var(--display-tracking); text-transform:var(--display-case);
           line-height:1.12; }
p { margin:0; }
button { font:inherit; color:inherit; background:none; border:0; padding:0; cursor:pointer; }
:focus-visible { outline:2px solid var(--primary); outline-offset:2px; }
@media (prefers-reduced-motion: reduce) { *,*::before,*::after {
  animation-duration:.01ms !important; transition-duration:.01ms !important; } }

.num { font-family:var(--font-num); font-variant-numeric:tabular-nums; font-weight:600; }
.mono { font-family:var(--font-mono); }
.lbl { font-size:calc(var(--text) * .66); font-weight:600; letter-spacing:.14em;
       text-transform:uppercase; color:var(--muted); line-height:1.2; }
:root[data-density="kiosk"] .lbl { font-family:var(--font-display); letter-spacing:.09em;
       font-size:calc(var(--text) * .72); }

/* ══ Shell ═══════════════════════════════════════════════════════════ */
.app { display:flex; flex-direction:column; min-height:100dvh; }
@media (min-width:48rem) { .app { flex-direction:row; } }
:root[data-density="kiosk"] .app { flex-direction:column; }

/* Top bar — phone only */
.topbar {
  display:flex; align-items:center; justify-content:space-between; gap:12px;
  height:calc(var(--target) + 8px); flex:none; padding:0 var(--gap);
  background:var(--surface); border-bottom:1px solid var(--rule);
  position:sticky; top:0; z-index:20;
  padding-top:env(safe-area-inset-top);
}
@media (min-width:48rem) { .topbar { display:none; } }
:root[data-density="kiosk"] .topbar { display:none; }

.brand { display:flex; align-items:center; gap:10px; min-width:0; }
.brand-name { font-family:var(--font-display); font-size:calc(var(--text) * 1.05);
              font-weight:var(--display-weight); letter-spacing:var(--display-tracking);
              text-transform:var(--display-case); }

/* Sidebar — laptop only */
.rail { display:none; }
@media (min-width:48rem) {
  .rail {
    display:flex; flex-direction:column; width:236px; flex:none;
    background:var(--surface); border-right:1px solid var(--rule);
    padding:18px 12px; position:sticky; top:0; height:100dvh;
  }
}
:root[data-density="kiosk"] .rail { display:none; }

.rail-item {
  display:flex; align-items:center; gap:12px; height:var(--target);
  padding:0 12px; border-radius:var(--radius); color:var(--muted);
  font-size:var(--text); width:100%; text-align:left;
}
.rail-item[aria-current="page"] { background:color-mix(in srgb, var(--primary) 9%, transparent);
  color:var(--ink); font-weight:600; }
.rail-item .g { color:var(--primary); width:16px; text-align:center; flex:none; }

/* Bottom bar — phone only */
.tabbar {
  display:flex; flex:none; background:var(--surface); border-top:1px solid var(--rule);
  position:sticky; bottom:0; z-index:20;
  padding-bottom:env(safe-area-inset-bottom);
}
@media (min-width:48rem) { .tabbar { display:none; } }
:root[data-density="kiosk"] .tabbar { display:none; }

.tabbar button {
  flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:3px; min-height:calc(var(--target) + 14px); color:var(--muted);
  font-size:calc(var(--text) * .63);
}
.tabbar button[aria-current="page"] { color:var(--primary); font-weight:600; }
.tabbar .g { font-size:calc(var(--text) * 1.05); line-height:1; }

main { flex:1; min-width:0; padding:var(--gap); display:flex; flex-direction:column;
       gap:var(--gap); padding-bottom:calc(var(--gap) + 62px); }
@media (min-width:48rem) { main { padding:28px 34px; gap:20px; max-width:1400px; } }
:root[data-density="kiosk"] main { padding:var(--gap); gap:var(--gap); max-width:none; }

.screen[hidden] { display:none; }
.screen { display:flex; flex-direction:column; gap:var(--gap); flex:1; min-height:0; }

/* ══ Pieces ══════════════════════════════════════════════════════════ */
.card {
  background:var(--surface); border:var(--border-w) solid var(--rule);
  border-radius:var(--radius); padding:var(--gap); box-shadow:var(--card-shadow);
}
:root[data-density="kiosk"] .card { border-color:var(--ink); }

.pagehead { display:flex; align-items:flex-end; justify-content:space-between;
            gap:12px; flex-wrap:wrap; }
@media (min-width:48rem) { .pagehead { border-bottom:1px solid color-mix(in srgb, var(--muted) 45%, transparent);
                                       padding-bottom:14px; } }
.pagehead h1 { font-size:calc(var(--text) * 1.75); }
@media (min-width:48rem) { .pagehead h1 { font-size:36px; } }
:root[data-density="kiosk"] .pagehead h1 { font-size:calc(var(--text) * 2.3); }

.btn {
  display:inline-flex; align-items:center; justify-content:center;
  height:var(--target); padding:0 calc(var(--target) * .44);
  border-radius:var(--radius); font-family:var(--font-ui);
  font-size:calc(var(--text) * .92); font-weight:600; white-space:nowrap;
  border:1px solid var(--rule); background:var(--surface); color:var(--ink);
}
.btn--primary { background:var(--primary); color:var(--on-primary); border-color:var(--primary); }
.btn--danger { color:var(--alert); border-color:var(--alert); }
.btn[disabled] { color:color-mix(in srgb, var(--muted) 60%, transparent); cursor:not-allowed; }
:root[data-density="kiosk"] .btn { font-family:var(--font-display); text-transform:uppercase;
  letter-spacing:.05em; font-size:calc(var(--text) * 1.15); border-width:3px; }

.chip {
  display:inline-flex; align-items:center; gap:5px; white-space:nowrap;
  border-radius:var(--chip-radius); font-size:calc(var(--text) * .7);
  font-weight:600; padding:2px 8px; letter-spacing:.1em; text-transform:uppercase;
  border:1px solid currentColor; color:var(--muted);
}
.chip--alert { color:var(--alert); } .chip--ok { color:var(--ok); }
.chip--primary { color:var(--primary); }
/* Operations fills its chips; Herd Book outlines them. */
@media (max-width:47.99rem) {
  .chip { border-color:transparent; background:color-mix(in srgb, currentColor 12%, transparent);
          letter-spacing:0; text-transform:none; font-weight:500;
          font-size:calc(var(--text) * .72); }
}
:root[data-density="kiosk"] .chip {
  border:0; background:currentColor; font-family:var(--font-display);
  font-size:calc(var(--text) * 1.05); padding:2px 10px; letter-spacing:.06em;
}
:root[data-density="kiosk"] .chip > span { color:#fff; }
:root[data-density="kiosk"] .chip--muted { background:transparent; border:2px solid var(--rule); }
:root[data-density="kiosk"] .chip--muted > span { color:var(--muted); }

.safety {
  display:inline-flex; align-items:center; justify-content:center; flex:none;
  width:calc(var(--text) * 1.45); height:calc(var(--text) * 1.45); border-radius:2px;
  font-family:var(--font-ui); font-size:calc(var(--text) * .82); font-weight:700;
}
.safety[data-level="1"]{background:var(--s1);color:var(--s1-ink)}
.safety[data-level="2"]{background:var(--s2);color:var(--s2-ink)}
.safety[data-level="3"]{background:var(--s3);color:var(--s3-ink)}
.safety[data-level="4"]{background:var(--s4);color:var(--s4-ink)}
.safety[data-level="5"]{background:var(--s5);color:var(--s5-ink)}

.stats { display:grid; grid-template-columns:repeat(3,1fr); gap:calc(var(--gap) * .7); }
@media (min-width:48rem) { .stats { grid-template-columns:repeat(4,1fr); gap:12px; } }
.stat { background:var(--surface); border:var(--border-w) solid var(--rule);
        border-radius:var(--radius); padding:calc(var(--gap) * .8); }
:root[data-density="kiosk"] .stat { border-color:var(--ink); }
.stat .v { display:block; font-family:var(--font-num); font-variant-numeric:tabular-nums;
           font-weight:600; font-size:calc(var(--text) * 1.55); margin-top:2px; }
@media (min-width:48rem) { .stat .v { font-size:28px; } }

.alertcard { border-left:4px solid var(--alert); }
:root[data-density="kiosk"] .alertcard { background:var(--alert); color:#fff; border:0; }
:root[data-density="kiosk"] .alertcard .lbl,
:root[data-density="kiosk"] .alertcard .muted { color:#fff; opacity:.86; }

.meter { height:6px; border-radius:3px; background:var(--rule); overflow:hidden; }
.meter > i { display:block; height:100%; background:var(--alert); }

.hrow { padding:calc(var(--gap) * .6) 0; border-bottom:1px solid var(--rule); }
.hrow:last-child { border-bottom:0; }
.muted { color:var(--muted); }
.small { font-size:calc(var(--text) * .78); }
.row { display:flex; align-items:center; gap:calc(var(--gap) * .7); }
.between { display:flex; align-items:center; justify-content:space-between;
           gap:calc(var(--gap) * .7); }
.wrapf { flex-wrap:wrap; }

/* Lists become tables on a laptop — same data, right shape per surface. */
.listrow {
  display:flex; align-items:center; justify-content:space-between;
  gap:var(--gap); min-height:var(--target); padding:calc(var(--gap) * .6) 0;
  border-bottom:1px solid var(--rule); width:100%; text-align:left;
}
.datatable { display:none; width:100%; border-collapse:collapse; }
@media (min-width:48rem) {
  .datatable { display:table; }
  .cardlist { display:none; }
}
:root[data-density="kiosk"] .datatable { display:none; }
:root[data-density="kiosk"] .cardlist { display:block; }
.datatable th { text-align:left; padding:9px 14px; font-size:11px; font-weight:600;
  letter-spacing:.14em; text-transform:uppercase; color:var(--muted);
  border-bottom:1px solid color-mix(in srgb, var(--muted) 45%, transparent); }
.datatable td { padding:9px 14px; border-bottom:1px solid var(--rule); }
.datatable tr:last-child td { border-bottom:0; }
.datatable .nm { font-family:var(--font-display); font-size:calc(var(--text) * 1.03);
                 font-weight:600; }

/* Tabs */
.tabs { display:flex; gap:2px; overflow-x:auto; scrollbar-width:none;
        border-bottom:1px solid color-mix(in srgb, var(--muted) 40%, transparent); }
.tabs::-webkit-scrollbar { display:none; }
.tabs button { padding:9px 10px 11px; white-space:nowrap; color:var(--muted);
  border-bottom:2px solid transparent; margin-bottom:-1px;
  font-size:calc(var(--text) * .88); }
.tabs button[aria-selected="true"] { color:var(--ink); font-weight:600;
  border-bottom-color:var(--primary); }

/* Two-column on a laptop, stacked on a phone */
.split { display:flex; flex-direction:column; gap:var(--gap); }
@media (min-width:48rem) { .split { display:grid; grid-template-columns:1.45fr 1fr;
  gap:18px; align-items:start; } }

.facts { display:grid; grid-template-columns:1fr 1fr; gap:12px 18px; }
.facts > div { display:flex; flex-direction:column; gap:2px; min-width:0; }
.facts .fv { font-size:calc(var(--text) * .92); font-variant-numeric:tabular-nums; }

/* Pedigree — a registration grid, not a constellation */
.ped { display:flex; flex-direction:column; gap:9px; }
.ped-half > .lbl { margin-bottom:5px; }
.ped-grid { display:grid; grid-template-columns:1.15fr 1fr; gap:5px; align-items:stretch; }
.ped-stack { display:grid; grid-template-rows:auto auto; gap:5px; }
.ped-box { border:1px solid var(--rule); background:var(--surface); padding:8px 11px;
  display:flex; flex-direction:column; gap:1px; justify-content:center; min-width:0; }
.ped-box .n { font-family:var(--font-display); font-weight:600;
  font-size:calc(var(--text) * .86); white-space:nowrap; overflow:hidden;
  text-overflow:ellipsis; }
.ped-box .r { font-family:var(--font-mono); font-size:calc(var(--text) * .62);
  color:var(--muted); }

/* Form */
.fieldset { display:grid; grid-template-columns:1fr; gap:14px; }
@media (min-width:48rem) { .fieldset { grid-template-columns:repeat(3,1fr); gap:16px; } }
.field { display:flex; flex-direction:column; gap:5px; }
.field input, .field select {
  height:var(--target); border:1px solid var(--rule); border-radius:var(--radius);
  background:var(--surface); color:var(--ink); padding:0 11px;
  font-family:var(--font-ui); font-size:calc(var(--text) * .92); width:100%;
}
.field input:focus { outline:none; border-color:var(--primary);
  box-shadow:0 0 0 3px color-mix(in srgb, var(--primary) 22%, transparent); }
.field[data-state="error"] input { border-color:var(--alert); }
.field[data-state="error"] .hint { color:var(--alert); }
.field input:disabled { background:var(--ground);
  color:color-mix(in srgb, var(--muted) 65%, transparent); }
.hint { font-size:calc(var(--text) * .76); color:var(--muted); }

/* Chart */
.chartwrap { width:100%; overflow:hidden; }
.chartwrap svg { display:block; width:100%; height:auto; }

/* ══ Sheet — bottom on a phone, slide-over on a laptop ═══════════════ */
.sheet-backdrop {
  position:fixed; inset:0; background:color-mix(in srgb, var(--ink) 42%, transparent);
  z-index:40; opacity:0; pointer-events:none; transition:opacity .18s ease;
}
.sheet-backdrop[data-open="true"] { opacity:1; pointer-events:auto; }
.sheet {
  position:fixed; z-index:41; background:var(--surface);
  border:1px solid var(--rule); display:flex; flex-direction:column;
  transition:transform .22s cubic-bezier(.2,.7,.3,1), visibility 0s linear .22s;
  visibility:hidden;
  left:0; right:0; bottom:0; border-radius:16px 16px 0 0;
  max-height:92dvh; transform:translateY(102%);
  padding:10px var(--gap) calc(var(--gap) + env(safe-area-inset-bottom));
  box-shadow:0 -12px 34px -14px rgb(0 0 0/32%);
}
.sheet[data-open="true"] { transform:translateY(0); visibility:visible;
  transition:transform .22s cubic-bezier(.2,.7,.3,1), visibility 0s; }
@media (min-width:48rem) {
  .sheet { left:auto; top:0; bottom:0; width:min(440px, 92vw); border-radius:0;
           max-height:none; transform:translateX(102%); padding:20px 22px;
           box-shadow:-14px 0 40px -18px rgb(0 0 0/32%); }
  .sheet[data-open="true"] { transform:translateX(0); }
}
.grabber { width:38px; height:4px; border-radius:2px; background:var(--rule);
           margin:0 auto 10px; }
@media (min-width:48rem) { .grabber { display:none; } }

.keypad { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
.keypad button { height:calc(var(--target) * 1.15); border:1px solid var(--rule);
  border-radius:var(--radius); background:var(--surface);
  font-family:var(--font-ui); font-size:calc(var(--text) * 1.3); font-weight:500;
  font-variant-numeric:tabular-nums; }
.keypad button:active { background:var(--ground); }

/* ══ The tester's control strip ══════════════════════════════════════ */
.controls {
  position:fixed; z-index:60; right:12px; bottom:calc(12px + env(safe-area-inset-bottom));
  display:flex; gap:6px; align-items:center; padding:6px;
  background:var(--surface); border:1px solid var(--rule); border-radius:999px;
  box-shadow:0 6px 22px -8px rgb(0 0 0/34%); font-family:var(--font-ui);
}
@media (max-width:47.99rem) { .controls { bottom:calc(var(--target) + 26px + env(safe-area-inset-bottom)); } }
.controls button {
  min-height:34px; padding:0 12px; border-radius:999px; font-size:13px; font-weight:600;
  color:var(--muted);
}
.controls button[aria-pressed="true"] { background:var(--primary); color:var(--on-primary); }
.controls .what { font-size:11px; color:var(--muted); padding:0 4px 0 8px;
  letter-spacing:.1em; text-transform:uppercase; font-weight:600; }
/* The strip sits bottom-right, which is exactly where the keypad's backspace
   lands on a phone. Get it out of the way while the sheet is up. */
.sheet[data-open="true"] ~ .controls { opacity:0; pointer-events:none; }
.controls { transition:opacity .15s ease; }

/* Kiosk view: the pen board and nothing else */
.kioskonly { display:none; }
:root[data-density="kiosk"] .kioskonly { display:flex; }
:root[data-density="kiosk"] .notkiosk { display:none !important; }
.penboard-kiosk { display:grid; grid-template-columns:repeat(2,1fr); gap:var(--gap); flex:1; }
@media (min-width:60rem) { .penboard-kiosk { grid-template-columns:repeat(4,1fr); } }
.penboard-kiosk .pen { background:var(--surface); border:2px solid var(--ink);
  padding:var(--gap); display:flex; flex-direction:column; gap:10px; }
.kiosk-actions { display:grid; grid-template-columns:repeat(2,1fr); gap:var(--gap); }
@media (min-width:60rem) { .kiosk-actions { grid-template-columns:repeat(4,1fr); } }
.kiosk-actions .btn { height:calc(var(--target) + 16px); width:100%;
  border-color:var(--primary); color:var(--primary); }
"""


# ── content ──────────────────────────────────────────────────────────────
WEIGHTS = [("12 Oct", 612), ("20 Nov", 684), ("28 Dec", 731), ("3 Feb", 798),
           ("15 Mar", 856), ("22 Apr", 921), ("1 Jun", 1004), ("10 Jul", 1092),
           ("12 Aug", 1184)]

PENS = [("North Trap", "2 head", 4), ("Creek Pen", "3 head", 2),
        ("South Trap", "4 head", 2), ("Barn Stall", "1 head", 3),
        ("Corral", "empty", 0)]

HERD = [("Juniper", "118", "Maine-Anjou", "Cow", "1,184", "North Trap", 4, "Bred"),
        ("Marigold", "204", "Chianina", "Cow", "1,326", "Creek Pen", 2, "Open"),
        ("Willow", "092", "Shorthorn", "Cow", "1,241", "Creek Pen", 2, "Bred"),
        ("Comet", "311", "Maine-Anjou", "Heifer", "842", "South Trap", 2, "Show"),
        ("Bandit", "277", "Chianina", "Steer", "1,020", "South Trap", 3, "Show"),
        ("Nutmeg", "153", "Shorthorn", "Cow", "1,178", "Creek Pen", 2, "Bred"),
        ("Rook", "298", "Maine-Anjou", "Bull", "1,904", "Barn Stall", 4, "Herd sire"),
        ("Clover", "331", "Shorthorn", "Heifer", "688", "South Trap", 2, "Growing")]

HEALTH = [("12 Aug", "Ivermectin pour-on", "Routine", "Eli"),
          ("2 Jul", "Vitamin A/D/E", "Routine", "Eli"),
          ("18 May", "Foot trim &mdash; left rear", "Lameness", "Dr. Reyes"),
          ("4 Apr", "Bangs vaccination", "Required", "Dr. Reyes")]

PED = [("Sire", "Ridgeline Monarch", "MA 4471882",
        [("Monarch's Legacy", "MA 4102336"), ("Cedar Hill Ruby", "MA 4188907")]),
       ("Dam", "Galaxy Farm Willow", "MA 4520114",
        [("Bar-K Foundation", "MA 4009551"), ("Willow Creek Belle", "MA 4233780")])]

NAV = [("&#9672;", "Today", "today"), ("&#10022;", "Animals", "herd"),
       ("&#9634;", "Land", "land"), ("&#9881;", "Kit", "kit"),
       ("&#9671;", "Business", "business")]


def chart():
    """Weigh-ins. One series, so no legend; the panel title names it."""
    w, h = 600, 200
    pl, pr, pt, pb = 46, 84, 14, 26
    pw, ph = w - pl - pr, h - pt - pb
    lo, hi = 560, 1240
    n = len(WEIGHTS)
    X = lambda i: pl + pw * i / (n - 1)
    Y = lambda v: pt + ph * (1 - (v - lo) / (hi - lo))

    grid = "".join(
        f'<line x1="{pl}" y1="{Y(v):.1f}" x2="{pl+pw}" y2="{Y(v):.1f}" '
        f'stroke="var(--rule)" stroke-width="1"/>'
        f'<text x="{pl-9}" y="{Y(v)+3.5:.1f}" text-anchor="end" '
        f'font-family="var(--font-mono)" font-size="10" fill="var(--muted)">{v}</text>'
        for v in (600, 800, 1000, 1200))
    pts = " ".join(f"{X(i):.1f},{Y(v):.1f}" for i, (_, v) in enumerate(WEIGHTS))
    dots = "".join(
        f'<circle cx="{X(i):.1f}" cy="{Y(v):.1f}" r="{4.5 if i==n-1 else 3}" '
        f'fill="var(--primary)" stroke="var(--surface)" stroke-width="2"/>'
        for i, (_, v) in enumerate(WEIGHTS))
    xl = "".join(
        f'<text x="{X(i):.1f}" y="{h-8}" text-anchor="middle" '
        f'font-family="var(--font-mono)" font-size="10" fill="var(--muted)">{WEIGHTS[i][0]}</text>'
        for i in (0, 4, n - 1))
    lx, ly = X(n - 1), Y(WEIGHTS[-1][1])
    return (f'<svg viewBox="0 0 {w} {h}" role="img" aria-label="Weigh-ins from October '
            f'to August, 612 lb rising to 1,184 lb">{grid}'
            f'<polygon points="{pl},{pt+ph} {pts} {pl+pw},{pt+ph}" fill="var(--primary)" '
            f'opacity="0.07"/>'
            f'<polyline points="{pts}" fill="none" stroke="var(--primary)" stroke-width="2" '
            f'stroke-linejoin="round" stroke-linecap="round"/>{dots}'
            f'<text x="{lx+10:.1f}" y="{ly-6:.1f}" font-family="var(--font-num)" '
            f'font-size="15" font-weight="600" fill="var(--ink)">1,184 lb</text>'
            f'<text x="{lx+10:.1f}" y="{ly+9:.1f}" font-family="var(--font-ui)" '
            f'font-size="10" fill="var(--muted)">latest</text>{xl}</svg>')


def pedigree():
    out = ""
    for heading, nm, reg, parents in PED:
        kids = "".join(f'<div class="ped-box"><span class="n">{n}</span>'
                       f'<span class="r">{r}</span></div>' for n, r in parents)
        out += (f'<div class="ped-half"><div class="lbl">{heading}</div>'
                f'<div class="ped-grid"><div class="ped-box"><span class="n">{nm}</span>'
                f'<span class="r">{reg}</span></div>'
                f'<div class="ped-stack">{kids}</div></div></div>')
    return f'<div class="ped">{out}</div>'


def mark(size=26):
    """Flying Double M Connected. One colour, as the iron draws it."""
    return (f'<svg viewBox="0 0 100 100" width="{size}" height="{size}" aria-hidden="true" '
            f'style="flex:none;display:block">'
            f'<g fill="none" stroke="var(--ink)" stroke-width="7.84" stroke-linecap="round" stroke-linejoin="round"><path d="M22 77.89 L27.6 33.09 L38.8 54.37 L50 33.09 L61.2 54.37 L72.4 33.09 L78 77.89"/><path d="M50 33.09 L50 77.89"/><path d="M27.6 33.09 Q18.64 17.41 11.92 24.13 M72.4 33.09 Q81.36 17.41 88.08 24.13"/></g></svg>')


def chip(text, tone="muted"):
    return f'<span class="chip chip--{tone}"><span>{text}</span></span>'


def safety(level):
    return f'<span class="safety" data-level="{level}">{level}</span>'


def screen_today():
    penrows = "".join(
        f'<button class="listrow" data-goto="animal">'
        f'<span class="row">{safety(lv) if lv else ""}'
        f'<span><span style="font-weight:600">{nm}</span>'
        f'<span class="small muted" style="display:block">{occ}</span></span></span>'
        f'{chip("Level " + str(lv) if lv else "Resting", "alert" if lv >= 4 else "ok" if lv == 2 else "primary" if lv else "muted")}'
        f'</button>' for nm, occ, lv in PENS[:4])

    tablerows = "".join(
        f'<tr><td class="nm">{nm}</td><td class="mono small muted">{occ}</td>'
        f'<td>{safety(lv) if lv else ""}</td>'
        f'<td>{chip("Level " + str(lv) if lv else "Resting", "alert" if lv >= 4 else "ok" if lv == 2 else "primary" if lv else "muted")}</td>'
        f'</tr>' for nm, occ, lv in PENS)

    return f'''
<section class="screen" id="screen-today" aria-labelledby="today-h">
  <div class="pagehead">
    <div>
      <p class="lbl">Thursday &middot; 13 August</p>
      <h1 id="today-h" style="margin-top:4px">Today</h1>
    </div>
    <div class="row wrapf">
      <button class="btn" data-sheet="open">Log weight</button>
      <button class="btn btn--primary" data-goto="form">Add animal</button>
    </div>
  </div>

  <div class="card alertcard">
    <div class="between wrapf" style="align-items:flex-start">
      <div class="row wrapf" style="align-items:center">
        {chip("Calving watch", "alert")}
        <div>
          <h2 style="font-size:calc(var(--text) * 1.2)">Juniper</h2>
          <p class="mono small muted" style="margin-top:2px">TAG 118 &middot; NORTH TRAP</p>
        </div>
      </div>
      <div style="text-align:right">
        <span class="num" style="font-size:calc(var(--text) * 1.3)">Day 279</span>
        <span class="small muted" style="display:block">of 283</span>
      </div>
    </div>
    <div class="meter" style="margin-top:12px"><i style="width:98.6%"></i></div>
  </div>

  <div class="stats">
    <div class="stat"><span class="lbl">Head</span><span class="v">24</span></div>
    <div class="stat"><span class="lbl">Pens</span><span class="v">4/9</span></div>
    <div class="stat"><span class="lbl">Uncovered</span>
      <span class="v" style="color:var(--alert)">3</span></div>
    <div class="stat notkiosk" style="display:none"><span class="lbl">Eggs</span>
      <span class="v">84</span></div>
  </div>

  <div class="card" style="flex:1;min-height:0">
    <div class="between" style="margin-bottom:8px">
      <span class="lbl">Pen board</span>
      <span class="small muted">4 in use &middot; 1 empty</span>
    </div>
    <div class="cardlist">{penrows}</div>
    <table class="datatable"><tbody>{tablerows}</tbody></table>
  </div>
</section>'''


def screen_herd():
    cards = "".join(
        f'<button class="listrow" data-goto="animal">'
        f'<span class="row">{safety(lv)}'
        f'<span><span style="font-weight:600">{nm}</span>'
        f'<span class="small muted" style="display:block">{tag} &middot; {breed}</span></span></span>'
        f'<span style="text-align:right"><span class="num">{wt}</span>'
        f'<span class="small muted" style="display:block">{pen}</span></span>'
        f'</button>'
        for nm, tag, breed, kind, wt, pen, lv, st in HERD)

    rows = "".join(
        f'<tr><td class="nm">{nm}</td><td class="mono small muted">{tag}</td>'
        f'<td>{breed}</td><td class="muted">{kind}</td>'
        f'<td style="text-align:right"><span class="num">{wt}</span></td>'
        f'<td class="muted">{pen}</td><td>{safety(lv)}</td>'
        f'<td>{chip(st, "primary" if st in ("Show","Herd sire") else "ok" if st=="Bred" else "muted")}</td></tr>'
        for nm, tag, breed, kind, wt, pen, lv, st in HERD)

    return f'''
<section class="screen" id="screen-herd" hidden aria-labelledby="herd-h">
  <div class="pagehead">
    <div>
      <p class="lbl">Cattle</p>
      <h1 id="herd-h" style="margin-top:4px">Herd</h1>
      <p class="small muted" style="margin-top:4px">24 active &middot; 3 sold this year</p>
    </div>
    <div class="row wrapf">
      <button class="btn">Export</button>
      <button class="btn btn--primary" data-goto="form">Add animal</button>
    </div>
  </div>

  <div class="card" style="flex:1;min-height:0">
    <div class="cardlist">{cards}</div>
    <table class="datatable">
      <thead><tr><th>Name</th><th>Tag</th><th>Breed</th><th>Class</th>
      <th style="text-align:right">Weight</th><th>Pen</th><th>Safety</th><th>Status</th></tr></thead>
      <tbody>{rows}</tbody>
    </table>
  </div>
</section>'''


def screen_animal():
    tabs = "".join(
        f'<button role="tab" aria-selected="{"true" if i==0 else "false"}">{t}</button>'
        for i, t in enumerate(["Overview", "Weights", "Health", "Breeding",
                               "Pedigree", "Feed", "Sales"]))
    facts = "".join(
        f'<div><span class="lbl">{k}</span><span class="fv">{v}</span></div>'
        for k, v in (("Date of birth", "14 March 2022"), ("Registration", "MA 4612093"),
                     ("Breed", "Maine-Anjou"), ("Colour", "Black, white face"),
                     ("Sire", "Ridgeline Monarch"), ("Dam", "Galaxy Farm Willow"),
                     ("Halter", "Red"), ("Acquired", "Born on farm")))
    health_rows = "".join(
        f'<tr><td class="mono small muted" style="white-space:nowrap">{d}</td>'
        f'<td>{w}</td><td>{chip(y)}</td>'
        f'<td class="small muted" style="text-align:right;white-space:nowrap">{who}</td></tr>'
        for d, w, y, who in HEALTH)
    health_cards = "".join(
        f'<div class="hrow"><div class="between" style="align-items:baseline">'
        f'<span style="font-weight:500">{w}</span>'
        f'<span class="mono small muted" style="white-space:nowrap">{d}</span></div>'
        f'<div class="row" style="margin-top:5px">{chip(y)}'
        f'<span class="small muted">{who}</span></div></div>'
        for d, w, y, who in HEALTH)

    return f'''
<section class="screen" id="screen-animal" hidden aria-labelledby="animal-h">
  <div class="between wrapf" style="align-items:flex-start">
    <div style="min-width:0">
      <p class="lbl">Cattle &middot; Herd &middot; <span style="color:var(--primary)">Juniper</span></p>
      <div class="row" style="align-items:baseline;margin-top:4px">
        <h1 id="animal-h">Juniper</h1>
        <span class="mono muted">TAG 118</span>
      </div>
      <div class="row wrapf" style="margin-top:9px">
        {safety(4)}{chip("Calving window", "alert")}{chip("Papered")}{chip("North Trap")}
      </div>
    </div>
    <div class="row wrapf">
      <button class="btn" data-sheet="open">Log weight</button>
      <button class="btn btn--primary" data-goto="form">Edit</button>
    </div>
  </div>

  <div class="tabs" role="tablist">{tabs}</div>

  <div class="split">
    <div style="display:flex;flex-direction:column;gap:var(--gap);min-width:0">
      <div class="card">
        <div class="between" style="margin-bottom:10px">
          <span class="lbl">Weigh-ins</span>
          <span class="row"><span class="small muted">Average daily gain</span>
          <span class="num">1.88</span><span class="small muted">lb/day</span></span>
        </div>
        <div class="chartwrap">{chart()}</div>
      </div>

      <div class="card">
        <div class="between" style="margin-bottom:8px">
          <span class="lbl">Health record</span>
          <span class="small" style="color:var(--primary)">All 18 entries</span>
        </div>
        <div class="cardlist">{health_cards}</div>
        <table class="datatable" style="width:100%;border-collapse:collapse">
          <tbody>{health_rows}</tbody></table>
      </div>
    </div>

    <div style="display:flex;flex-direction:column;gap:var(--gap);min-width:0">
      <div class="card alertcard">
        <span class="lbl">Calving watch</span>
        <div class="row" style="align-items:baseline;margin:5px 0 9px">
          <span class="num" style="font-size:calc(var(--text) * 1.7);color:var(--alert)">Day 279</span>
          <span class="small muted">of 283</span>
        </div>
        <div class="meter"><i style="width:98.6%"></i></div>
        <p class="small muted" style="margin-top:9px">Bred 4 Nov to Ridgeline Monarch
        &middot; due 13&ndash;17 August</p>
      </div>

      <div class="card">
        <span class="lbl">Pedigree</span>
        <div style="margin-top:10px">{pedigree()}</div>
      </div>

      <div class="card">
        <span class="lbl">Facts</span>
        <div class="facts" style="margin-top:10px">{facts}</div>
      </div>
    </div>
  </div>
</section>'''


def screen_form():
    return f'''
<section class="screen" id="screen-form" hidden aria-labelledby="form-h">
  <div class="pagehead">
    <div>
      <p class="lbl">Cattle &middot; Herd</p>
      <h1 id="form-h" style="margin-top:4px">Edit Juniper</h1>
    </div>
    <div class="row wrapf">
      <button class="btn" data-goto="animal">Cancel</button>
      <button class="btn btn--primary">Save changes</button>
    </div>
  </div>

  <div class="card" style="border-color:var(--alert);
       background:color-mix(in srgb, var(--alert) 6%, var(--surface))">
    <div class="row"><span style="color:var(--alert);font-weight:700">!</span>
    <span class="small" style="color:var(--alert)">Two fields need attention before this
    can be saved.</span></div>
  </div>

  <div class="card" style="display:flex;flex-direction:column;gap:20px">
    <div>
      <div class="row" style="margin-bottom:12px"><span class="lbl">Identity</span>
        <span style="flex:1;height:1px;background:var(--rule)"></span></div>
      <div class="fieldset">
        <label class="field"><span class="lbl">Name</span>
          <input value="Juniper"></label>
        <label class="field"><span class="lbl">Tag number</span>
          <input value="118" inputmode="numeric"></label>
        <label class="field"><span class="lbl">Registration</span>
          <input value="MA 4612093"></label>
      </div>
    </div>

    <div>
      <div class="row" style="margin-bottom:12px"><span class="lbl">Breeding</span>
        <span style="flex:1;height:1px;background:var(--rule)"></span></div>
      <div class="fieldset">
        <label class="field"><span class="lbl">Bred on</span>
          <input value="4 November 2024"></label>
        <label class="field" data-state="error"><span class="lbl">Calved on</span>
          <input value="2 October 2024" aria-invalid="true">
          <span class="hint">A calving date cannot precede its breeding date.</span></label>
        <label class="field"><span class="lbl">Sire</span>
          <input value="Ridgeline Monarch"></label>
      </div>
    </div>

    <div>
      <div class="row" style="margin-bottom:12px"><span class="lbl">Placement</span>
        <span style="flex:1;height:1px;background:var(--rule)"></span></div>
      <div class="fieldset">
        <label class="field"><span class="lbl">Pen</span>
          <input value="North Trap"></label>
        <label class="field" data-state="error"><span class="lbl">Safety level</span>
          <input value="" placeholder="Choose a level" aria-invalid="true">
          <span class="hint">Required when the animal is in a shared pen.</span></label>
        <label class="field"><span class="lbl">Registry sync</span>
          <input value="Locked while an import is running" disabled></label>
      </div>
    </div>

    <div class="between wrapf" style="padding-top:14px;border-top:1px solid var(--rule)">
      <button class="btn btn--danger">Delete animal</button>
      <span class="small muted">Deleting asks you to type the name. It stays in Trash
      for 30 days.</span>
    </div>
  </div>
</section>'''


def screen_kiosk():
    pens = "".join(
        f'<div class="pen"><div class="between">'
        f'<h2 style="font-size:calc(var(--text) * 1.7)">{nm}</h2>{safety(lv) if lv else ""}</div>'
        f'<p class="mono muted">{occ.upper()}</p>'
        f'<div style="margin-top:auto">{chip("Level " + str(lv) if lv else "Resting", "alert" if lv>=4 else "ok" if lv==2 else "primary" if lv else "muted")}</div>'
        f'</div>' for nm, occ, lv in PENS[:4])
    acts = "".join(f'<button class="btn" data-sheet="open">{t}</button>'
                   for t in ("Log weight", "Treatment", "Move animal", "Eggs"))
    return f'''
<section class="screen kioskonly" id="screen-kiosk" style="display:none"
         aria-labelledby="kiosk-h">
  <div class="between wrapf">
    <div class="row">{mark(46)}
      <div><h1 id="kiosk-h">Pen board</h1>
      <p class="small muted" style="margin-top:3px">Thursday 13 August &middot; 6:42 am</p></div>
    </div>
    <div class="row"><span style="width:12px;height:12px;border-radius:50%;
      background:var(--ok);display:block"></span><span class="muted">Up to date</span></div>
  </div>

  <div class="card alertcard">
    <div class="between wrapf">
      <div class="row wrapf"><h2 style="font-size:calc(var(--text) * 1.5)">Calving watch</h2>
        <h2 style="font-size:calc(var(--text) * 1.5)">Juniper &middot; 118</h2></div>
      <span class="num" style="font-size:calc(var(--text) * 1.4)">Day 279 / 283</span>
    </div>
  </div>

  <div class="penboard-kiosk">{pens}</div>
  <div class="kiosk-actions">{acts}</div>
</section>'''


def sheet():
    keys = "".join(f'<button data-key="{k}">{k}</button>'
                   for k in ("1","2","3","4","5","6","7","8","9",".","0","&#9003;"))
    return f'''
<div class="sheet-backdrop" data-sheet="close"></div>
<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-h">
  <div class="grabber"></div>
  <div class="between" style="margin-bottom:14px">
    <h2 id="sheet-h" style="font-size:calc(var(--text) * 1.2)">Log a weight</h2>
    <button class="small" style="color:var(--primary);font-weight:600"
            data-sheet="close">Cancel</button>
  </div>

  <div class="row" style="padding:11px 12px;background:var(--ground);
       border:1px solid var(--rule);border-radius:var(--radius);margin-bottom:14px">
    {safety(4)}
    <div style="flex:1;min-width:0"><span style="font-weight:600">Juniper</span>
      <span class="small muted" style="display:block">Tag 118 &middot; last 1,092 lb on 10 Jul</span></div>
  </div>

  <div style="text-align:center;margin-bottom:14px">
    <p class="lbl">Weight</p>
    <div class="num" style="font-size:calc(var(--text) * 2.6);line-height:1.1"
         id="weightval">1,184<span class="muted"
         style="font-size:calc(var(--text) * .95);font-weight:400"> lb</span></div>
    <p class="small" style="color:var(--ok);margin-top:3px">+92 lb since July
    &middot; 1.88 lb/day</p>
  </div>

  <div class="keypad">{keys}</div>

  <button class="btn btn--primary" style="width:100%;margin-top:14px"
          data-sheet="close">Save weigh-in</button>
</div>'''


JS = r"""
(function () {
  var root = document.documentElement;

  function show(id) {
    document.querySelectorAll('.screen').forEach(function (s) {
      if (s.classList.contains('kioskonly')) return;
      s.hidden = (s.id !== 'screen-' + id);
    });
    document.querySelectorAll('[data-nav]').forEach(function (b) {
      if (b.dataset.nav === id) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    window.scrollTo(0, 0);
  }

  document.addEventListener('click', function (e) {
    var nav = e.target.closest('[data-nav]');
    if (nav) { show(nav.dataset.nav === 'herd' ? 'herd' : nav.dataset.nav); return; }

    var go = e.target.closest('[data-goto]');
    if (go) { show(go.dataset.goto); return; }

    var sh = e.target.closest('[data-sheet]');
    if (sh) {
      var open = sh.dataset.sheet === 'open';
      document.querySelector('.sheet').dataset.open = open;
      document.querySelector('.sheet-backdrop').dataset.open = open;
      return;
    }

    var tab = e.target.closest('[role="tab"]');
    if (tab) {
      tab.parentElement.querySelectorAll('[role="tab"]').forEach(function (t) {
        t.setAttribute('aria-selected', String(t === tab));
      });
      return;
    }

    var dens = e.target.closest('[data-density-set]');
    if (dens) {
      var on = root.getAttribute('data-density') === 'kiosk';
      if (on) { root.removeAttribute('data-density'); show('today'); }
      else { root.setAttribute('data-density', 'kiosk'); }
      dens.setAttribute('aria-pressed', String(!on));
      document.querySelectorAll('.screen').forEach(function (s) {
        if (s.classList.contains('kioskonly')) s.style.display = on ? 'none' : 'flex';
      });
      return;
    }
  });

  // The keypad edits the number, so the sheet is worth actually poking at.
  var buf = '1184', fresh = true;   // first digit replaces the seed
  document.querySelectorAll('.keypad button').forEach(function (k) {
    k.addEventListener('click', function () {
      var v = k.dataset.key;
      if (v === '\u232B') { buf = buf.slice(0, -1); fresh = false; }
      else if (v === '.') { if (fresh) { buf = '0'; fresh = false; }
                            if (buf.indexOf('.') < 0) buf += '.'; }
      else { if (fresh) { buf = ''; fresh = false; }
             if (buf.replace('.', '').length < 6) buf += v; }
      var n = buf === '' ? '0' : buf;
      var parts = n.split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      document.getElementById('weightval').innerHTML =
        parts.join('.') + '<span class="muted" style="font-size:calc(var(--text) * .95);' +
        'font-weight:400"> lb</span>';
    });
  });

  if (location.search.indexOf('kiosk') > -1) {
    root.setAttribute('data-density', 'kiosk');
    document.querySelectorAll('.kioskonly').forEach(function (s) { s.style.display = 'flex'; });
    document.querySelector('[data-density-set]').setAttribute('aria-pressed', 'true');
  }
})();
"""


def build(p):
    CURRENT = ' aria-current="page"'
    railitems = "".join(
        f'<button class="rail-item" data-nav="{key}"'
        f'{CURRENT if key == "today" else ""}>'
        f'<span class="g">{g}</span>{name}</button>' for g, name, key in NAV)
    tabitems = "".join(
        f'<button data-nav="{key}"{CURRENT if key == "today" else ""}>'
        f'<span class="g">{g}</span><span>{name}</span></button>' for g, name, key in NAV)

    css = CSS.replace("__FACES__", FACES)
    for token, key in (("__GROUND__", "ground"), ("__SURFACE__", "surface"),
                       ("__INK__", "ink"), ("__MUTED__", "muted"), ("__RULE__", "rule"),
                       ("__PRIMARY__", "primary"), ("__ONPRIMARY__", "on_primary"),
                       ("__ALERT__", "alert"), ("__OK__", "ok")):
        css = css.replace(token, p[key])

    doc = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="{p["ground"]}">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>Galaxy Farm &mdash; {p["name"]}</title>
<style>{css}</style>
</head>
<body>
<div class="app">
  <header class="topbar">
    <span class="brand">{mark(24)}<span class="brand-name">Galaxy Farm</span></span>
    <span style="width:8px;height:8px;border-radius:50%;background:{p["ok"]};display:block"></span>
  </header>

  <nav class="rail" aria-label="Sections">
    <div class="row" style="padding:0 12px 18px">{mark(30)}
      <span class="brand-name" style="font-size:18px">Galaxy Farm</span></div>
    {railitems}
    <div style="margin-top:auto;padding:12px" class="row">
      <span style="width:7px;height:7px;border-radius:50%;background:{p["ok"]};display:block"></span>
      <span class="small muted">Up to date</span>
    </div>
  </nav>

  <main>
    {screen_today()}
    {screen_herd()}
    {screen_animal()}
    {screen_form()}
    {screen_kiosk()}
  </main>

  <nav class="tabbar" aria-label="Sections">{tabitems}</nav>
</div>

{sheet()}

<div class="controls">
  <span class="what">{p["name"]}</span>
  <button data-density-set aria-pressed="false">Kiosk</button>
</div>

<script>{JS}</script>
</body>
</html>'''
    return "".join(c if ord(c) < 128 else f"&#{ord(c)};" for c in doc)


if __name__ == "__main__":
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for key in SHORTLIST:
        p = PALETTES[key]
        out = OUT_DIR / f"{key}.html"
        out.write_text(build(p), encoding="ascii")
        print(f'{p["name"]:<14} -> {out.relative_to(ROOT)}  {out.stat().st_size / 1024:.0f} KB')
