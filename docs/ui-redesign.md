# Redesign proposal — the brand iron

Supersedes the closing paragraph of [`ui-review.md`](./ui-review.md), which
argued against changing the design language. The owner's call is that Midnight
Nebula does not read as mature or professional enough, so this proposes
replacing it.

If adopted, this is **v0.9 of spec §8** plus an entry in the decision log — §8
is marked "locked v0.8" and the spec is the source of truth, so the change is
made there rather than quietly underneath it.

A rendered version, with three directions mocked up in full, is at
<https://claude.ai/code/artifact/86786b39-314a-4915-b4ee-375859699920>.

---

## The thesis

Everything that reads as young follows from one misreading of the farm's name.
"Galaxy Farm" was taken as outer space, so the admin surface got a starfield,
two nebula washes, a ninety-second drift animation, and a violet-navy
environment in which canvas, panel, raised and border are all the same hue.

But the mark in `packages/ui/src/brand/logomark.tsx` is a **Rocking Double
Star** — a large star and a small one over a rocker. Cow and calf. That is not
astronomy; it is the naming convention for a registered livestock brand, the
kind burned into hide and printed at the top of registration papers.

Read the identity as what it actually is, and the whole thing turns serious
without changing the farm's name, the mark, or a single star in it. The mark
stays exactly as drawn — the file says the geometry is not to be adjusted, and
it shouldn't be. What changes is everything around it.

## Six moves, true of any direction

| From                | To                     | Why                                                                                                       |
| ------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------- |
| Ambient theatre     | A quiet ground         | A drifting starfield behind a page where somebody reads a weight off a scale. Serious tools do not move.    |
| Dark by decree      | Light by default       | Dark reads as enthusiast software, and it is wrong for printing pedigrees, showing a buyer, or a sunlit barn. |
| Themed environment  | Neutral ground         | When every surface is tinted, tint stops carrying information. Spend colour only on state.                  |
| Boxes               | Rules and tables       | 94 cards and 29 card grids, each with a 3 px accent edge. A hairline separates groups and stays one surface deep. |
| Four type sizes     | A real scale           | Maturity is mostly the confidence to make the important thing much larger and everything else much quieter. |
| Loose               | Deliberate density     | Professional data tools are denser than this, and density is what makes forty animals comparable at once.   |

Night mode survives all of this — as a mode, on the mobile and kiosk densities,
rather than as the mandated look of the admin surface.

## Three directions

### 01 · Herd Book

Borrowed from the paperwork: registration certificates, sale catalogues, herd
ledgers — documents whose authority comes from being records rather than
screens.

- **Palette** — warm paper `#FAF9F5`, rule `#E2DFD4`, registry green `#24422F`,
  oxide `#8A2E1F` held strictly for warnings, ink `#16150F`.
- **Type** — Source Serif 4 for names, headings and figures; IBM Plex Sans for
  labels and controls; Plex Mono for tags and serials.
- **Signature** — the pedigree stops being a constellation and becomes a proper
  three-generation certificate grid; the brand mark appears as a stamp; tag
  numbers set like catalogue lot numbers.
- **Risk** — a serif tips into costume if the density is wrong. It has to read
  as a well-set record, not a wedding invitation, so the discipline lives in the
  spacing rather than the face.

### 02 · Operations

Borrowed from modern software: the console language of Linear, Stripe and
Sentry — tight grid, one accent, weight doing the work that size and colour were
doing.

- **Palette** — cool neutrals `#FBFBFC` / `#E4E7EB`, one blue `#2563C4` for
  every interactive job, a `#C1332B` / `#16794C` semantic pair.
- **Type** — one grotesque in three weights on a tight scale. Hierarchy from
  weight and colour rather than size, which is what lets the screens get dense
  without getting loud.
- **Signature** — very little, and that is the trade. Professional by being
  unmistakably competent rather than by being anybody in particular.
- **Risk** — it looks like everything else. Fastest to build, safest to defend,
  and it throws away a genuinely distinctive brand.

### 03 · Stockman

Borrowed from the working world: scale readouts, auction boards, equipment
panels, USDA forms. Authority through sheer fitness for purpose.

- **Palette** — near-black rules on `#F4F4F2`, signal blue `#17508C`, alert
  `#C62828`, confirm `#2E7D32`. High contrast throughout.
- **Type** — a condensed grotesque for labels and headings (signage, not prose)
  over Plex Sans for anything read in sentences. Oversized numerals.
- **Signature** — solid black bands, hard rules, numbers readable from the
  alley. The only one of the three that works on a kiosk without a separate
  density mode.
- **Risk** — too blunt for the client side. It says competent operation; it does
  not say premium training programme.

## The tiebreak: the customer portal

The admin surface has one demanding user who already knows the farm is real. The
`(account)` surface is where somebody decides whether to hand over a
fifteen-thousand-dollar show heifer for a season, and that is the screen the
redesign should be judged on. A boarding client checking weights, invoices and a
signed liability form should get something that looks like it came from a
business with a filing cabinet.

That argues for Herd Book, against Stockman, and makes Operations adequate
rather than good.

Note also that the customer surface is *already* specified as the light theme.
Going light-first on admin does not create a second design — it collapses two
into one, and the mirrored-neutrals idea in §8 stops being necessary.

## What it costs

Measured before proposing any of it. Across 68 screens and the design system
there are **zero** hardcoded Tailwind colour classes and two stray hex values,
against **786** uses of semantic token classes. Radius is `rounded-density` in
41 places against 13 raw values.

| Layer                              | Where it lives                                        | Screen changes |
| ---------------------------------- | ----------------------------------------------------- | -------------- |
| Palette, density, radius           | `theme.css` + `globals.css`                           | None           |
| Typography                         | `layout.tsx` + two tokens                             | None           |
| Card / Tile / Pill / Section shape | `packages/ui/src/primitives`                          | None           |
| Rules over boxes on data screens   | Primitives, plus the 29 `CardGrid` sites              | ~29 files      |
| Navigation and in-page tabs        | `nav-groups.ts`, `admin-nav.tsx`, domain screens      | ~15 files      |
| Forms into a `Sheet`               | New primitive, then per screen                        | ~40 files      |

The top three rows are the entire visual identity and they are close to free.
The bottom three are the structural work from `ui-review.md` — worth doing,
separable, and able to follow the new look rather than block it.

Two things this genuinely does cost:

- **Amending the spec.** §8 goes to v0.9, with a decision-log entry.
- **A real answer for the night case.** Light-first is right for the office, the
  portal and print, but somebody checking a calving pen at 2am should not get a
  white screen. Build the night mode alongside, rather than promising it.

## Every direction at every density

All three directions are drawn at all three densities by
[`tools/render-mockups.py`](../tools/render-mockups.py), which builds each frame
at true device pixel size from the tokens in `theme.css` — a 64 px kiosk target
in the output is a real 64 px target. Run it to regenerate
[`ui-mockups.html`](./ui-mockups.html); a presented version is at
<https://claude.ai/code/artifact/b39673ae-f081-4b65-af91-76eefb493b31>.

The three surfaces are not one layout at three scales. Each drops something the
others keep:

- **Desktop** keeps the side rail and the table. 236 px of navigation is
  affordable, and a five-column table is the right shape when the job is
  comparing pens against each other.
- **Mobile** trades the table for entries and the rail for a bottom bar, and
  gains a persistent log button — §8 asks for every frequent action within two
  taps of its context.
- **Kiosk** drops navigation entirely. A barn screen is not browsed: it shows
  the pen board all day and offers four things you might do standing in front of
  it. Everything else is a phone's job.

One thing is identical in all nine: the safety ramp, saturated green through red
and always numbered. §8 puts it outside the palette so nothing competes with it,
and restyling it per direction would break the rule the whole colour system is
built on.

Reading across:

| Direction  | Desktop                                                                    | Mobile                                                                        | Kiosk                                                                          |
| ---------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Herd Book  | Strongest of the three — the ledger table is what the direction is for.     | Holds well; the serif gives a small screen hierarchy that grey text can't.     | Weakest of its three. A text serif at four feet is doing work it wasn't cut for. |
| Operations | Very good, and the densest. Nothing wasted, nothing memorable.              | Best mobile of the nine. This is the language phones were designed in.         | Reads as a big web page. Rounded cards at 64 px look inflated.                  |
| Stockman   | A dispatch board — fast, but shouty for a screen a client may see.          | Condensed labels buy real estate a phone badly needs.                          | Clearly the best kiosk; the only one that looks like equipment.                  |

## Recommendation

**Direction 01, held to Direction 02's density — and Direction 03 on the kiosk.**

The density read-across sharpens the earlier recommendation rather than changing
it. Herd Book wins desktop and mobile; Stockman wins the kiosk outright, and it
is not close. That pairing is not a compromise between two directions —
`theme.css` already has the mechanism, `[data-density="kiosk"]`, and the kiosk
route group already sets it.

What has to be true for it to stay one design system: the two share one palette
and one set of semantic roles, and only the type treatment and the container
shape change at the kiosk breakpoint. Herd Book's registry green and oxide carry
over unchanged; the condensed face and the hard rules come in. That is a
variant, not a second system.

The original argument for Herd Book stands on its own:

Herd Book is the only one of the three that could not belong to another company.
It takes an identity that already exists and gives it the visual world it came
from, which is how a design reads as mature rather than as decorated. The
failure mode is prettiness, so borrow Operations' rigour for the data-dense
screens — the same tight grid, the same restraint about colour, the same refusal
to draw a box where a rule will do.

## Caveat

The nine mockups are static compositions of one screen on one morning. They say
nothing yet about a fourteen-field form, a three-generation pedigree, or an
eleven-tab animal profile — and those are where a direction usually breaks.
Before committing, the next thing worth drawing is the animal detail page in
whichever direction wins, because it is the hardest screen in the product.

This is a proposal about surface, and surface is the part that can be argued
from the code. Whether Herd Book is *right* depends on things not in the
repository — how the boarding business should be perceived, what competing
software looks like, whether the farm's existing printed material has a voice
this should match. If any of that points elsewhere, the token work is the same
size whichever direction wins.
