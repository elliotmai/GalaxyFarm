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

## Decided: one direction per surface

**Herd Book on desktop, Operations on mobile, Stockman on the kiosk.**

Operations was the best mobile of the nine, so the split is well supported by
the read-across above. The thing it puts at risk is coherence: three directions
across three surfaces is either one brand or three, and what decides which is
the palette. Locking a single set of colour tokens across all three is what
makes them one product in three densities. Nothing but colour is shared — the
typography and the container shapes stay per-direction.

That makes the palette the next decision, and the only one still open.

## Palette candidates

Six, each with a different primary, each applied to all three surfaces at once:
<https://claude.ai/code/artifact/d2dc6870-cc71-4714-8c23-6afe08f911f8>. Audited
by [`tools/palette-audit.py`](../tools/palette-audit.py), which ports the
formulas from `packages/ui/src/tokens/contrast.ts` so its output can go straight
into `packages/ui/tests/contrast.test.ts` as assertions once one wins.

Greens and blues only — no red primaries. **Alert stays red**, because §8 locks
the safety ramp as a saturated green-to-red scale, so red cannot leave the
product without breaking the one rule the colour system is built on, and a
warning that was not red standing beside a red level-4 chip would be worse than
the inconsistency it fixed.

| Palette        | Family     | Primary   | The argument                                                              |
| -------------- | ---------- | --------- | ------------------------------------------------------------------------- |
| Registry Green | Green      | `#223F2E` | The colour herd books and registration papers are printed in.             |
| Field Olive    | Green      | `#4F5A1E` | Cured hay and winter rye. Least like software of any kind.                |
| Slate Teal     | Blue-green | `#1F5158` | The bridge. Nobody else in agricultural software is using it.             |
| Bluebonnet     | Blue       | `#35569E` | The value §8 already specifies. Costs no continuity with anything built.  |
| Ink Navy       | Blue       | `#1B3A5C` | Ledgers and filed documents. The most conservative.                       |
| Harbor         | Blue       | `#15597F` | Cleaner than a navy, no violet lean. The most legible on a small screen.  |

All six clear WCAG AA on every text pair; the weakest anywhere is 5.66 against a
4.5 minimum. Neutrals are not shared between them — each ground and muted
carries a faint bias toward its own primary, because a pure grey beside a
coloured accent is what makes a palette read as defaulted rather than chosen.

Leaning **Registry Green**: it is the only one that comes from the same argument
as the redesign itself, and it has the cleanest semantics, since primary and
confirm are one green and the palette carries three signals rather than four.
**Bluebonnet** is the free one — its primary is the value §8 already specifies,
so it costs no continuity at all. **Field Olive** is the interesting one, and the
only green far enough from the safety ramp to afford a separate confirm colour.

**Ink Navy** and **Harbor** are the ones not to push. Navy will never be wrong,
which is the whole problem with it; Harbor reads as a utility blue rather than a
brand one, which helps on the kiosk and does nothing on the customer portal —
the surface that actually has to sell something.

## Shortlist: Field Olive, Ink Navy, Harbor

Narrowed from the six. Each has a comprehensive mockup page — eleven screens
across all three surfaces, generated by
[`tools/render-palette-mockups.py`](../tools/render-palette-mockups.py) into
[`docs/mockups/`](./mockups/):

| Palette         | Primary   | Preview                                      | Hosted                                                          |
| --------------- | --------- | -------------------------------------------- | --------------------------------------------------------------- |
| **Field Olive** | `#4F5A1E` | [`mockups/olive.html`](./mockups/olive.html)   | <https://claude.ai/code/artifact/a2b819e7-5e10-4a61-80f8-8d302ab3d0ef> |
| **Ink Navy**    | `#1B3A5C` | [`mockups/navy.html`](./mockups/navy.html)     | <https://claude.ai/code/artifact/786c2162-51dd-49f7-ba7b-3959bdad46c6> |
| **Harbor**      | `#15597F` | [`mockups/harbor.html`](./mockups/harbor.html) | <https://claude.ai/code/artifact/d0ce85b3-9dbc-47cc-aef7-c2bcaec4fcac> |

The eleven screens are chosen to break a palette rather than to flatter it:

- **Dashboard, herd list, animal detail** on desktop. The animal detail page is
  the hardest screen in the product — tabs, a weight chart, a three-generation
  pedigree, a health log and a feed plan on one page — and it is where a
  direction usually breaks.
- **The edit form and the component inventory**, because focus rings, error
  states, disabled controls and a destructive action are where a palette
  actually fails. Two fields are deliberately in error.
- **Today, animal detail and a log sheet** on the phone, including the `Sheet`
  primitive from `ui-review.md`.
- **Pen board and weight entry** on the kiosk, at real 64 px targets.
- **The customer portal**, the one surface a stranger judges.

Four places to look when comparing them:

1. **Safety chips beside the primary** — on the herd list and the animal header
   they sit inches apart. A primary that reads as a safety level shows there first.
2. **The error state on the edit form** — alert red has to beat the primary for
   attention without the two fighting.
3. **The kiosk alert band** — the only large saturated fill in the product, and
   the loudest the palette ever gets.
4. **The customer portal** — if a palette reads as a hobby anywhere, it reads
   that way here.

The pedigree is drawn as a three-generation certificate grid rather than as the
spec's constellation. On paper it has been that grid for a century, and the grid
is what a buyer can actually read.

## The middle of green belongs to the safety scale

The second thing the audit found, and the reason both greens above sit at the
edges of green rather than in the middle of it.

§8 already contains this rule, written for a different colour: it forbids the
calm sage from reading as safety-scale green, and measures the difference by
_saturation_ rather than hue, because the two are near-identical in hue by
design. A green **primary** is that same problem one step louder — sage appears
on a few resting pastures, a primary appears on every button, link and active
nav item on the screen.

A mid-tone pasture green, the single most obvious colour for a farm, is the one
green a farm cannot use. At `#1F6B43` it sits **14.4° of hue from safety level 1
with 1.02:1 contrast** — the same colour by every measure that matters, so a
button and "this pen is safe to walk into" become indistinguishable. It is kept
in `tools/palette-audit.py` as `REJECTED` rather than deleted, because the next
person to reach for a pasture green will reach for exactly that one.

That leaves three ways for a green primary to survive, and each green in the set
uses one:

- **By depth.** Registry Green goes to `#223F2E`, clearing the ramp at 1.81:1.
  The constraint helped: that depth is what makes it read as ink on a
  certificate rather than as a lawn.
- **By hue, warm.** Field Olive turns 61° toward yellow.
- **By hue, cool.** Slate Teal turns 53° toward blue.

No blue has this problem — every one clears the ramp by 67° or more without
anyone having to think about it. If the constraint feels like it is doing too
much work, that is itself an argument for a blue.

## The light ground breaks the amber safety chip

Not a tidy-up — a real consequence of the change, found by running the audit.

Safety level 3 at `#C98A1E` lands between **2.71 and 2.74** against every
candidate ground, under the **3.0** that WCAG §1.4.11 requires of a meaningful
non-text mark. It has never been a problem because it has only ever sat on a
near-black canvas. Darkening it to **`#BC811C`** clears every ground at 3.07 and
keeps black ink on it at 5.66.

The ramp stays identical across all six palettes and deliberately outside every
one of them, exactly as §8 requires — this changes one value in it, for
legibility, not for style.

## What the decision leaves to settle

The surface split is decided; what is left is making it hold together.

`theme.css` is already the mechanism. `[data-density="kiosk"]` exists and the
kiosk route group already sets it, so Stockman is a density variant rather than
a second stylesheet. Mobile and desktop split on the same axis — the
no-`data-density` media query at 48rem is exactly the Operations/Herd Book
boundary.

What has to stay true for it to remain one design system:

- **One palette, one set of semantic roles, across all three.** Primary means
  the same thing on every surface. This is the whole load-bearing constraint,
  and it is why the palette is the next decision.
- **One safety ramp**, outside the palette, untouched by any direction.
- **Only type treatment and container shape vary.** Serif names and hairline
  rules on desktop; one grotesque and soft cards on mobile; condensed caps and
  hard rules on the kiosk. Nothing else.

The argument for Herd Book carrying the desktop still stands on its own: it is
the only one of the three that could not belong to another company, and it takes
an identity that already exists and gives it the visual world it came from. Its
failure mode is prettiness, so the desktop should keep Operations' rigour about
density and colour even though it does not share its typography.

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
