# UI review — the admin surface

Written against `claude/ui-redesign-brainstorm-p0nl0p`, in response to three
complaints about the admin surface: it takes a while to load, it feels flat and
basic, and it feels cluttered.

Each one has a specific cause in the repository. None of them is a problem with
the design language — §8 is a good, well-argued system, and the largest single
cause of "flat" is that a piece of it was never wired up.

A rendered version of this review, with before-and-after mockups in Midnight
Nebula, is at <https://claude.ai/code/artifact/f3d7d443-64fd-4746-9746-812f8a9369fa>.

---

## 1. The typefaces are never loaded

`globals.css` declares them:

```css
--font-heading: "Zilla Slab", Georgia, serif;
--font-body: Inter, system-ui, sans-serif;
```

Nothing fetches either one. There is no `next/font` import, no `@font-face`, no
`<link>` in the tree, and no font file anywhere in the repository. Every heading
in the app is rendering in **Georgia** and every label in the OS default.

§8 locks Zilla Slab and Inter as the brand's typography, and a slab serif over
Inter is most of what would make these screens read as authored rather than as
generated. None of it has ever reached a browser. This is the single
highest-leverage fix in the whole review and it is about eight lines:

```ts
// apps/web/app/layout.tsx
import { Inter, Zilla_Slab } from "next/font/google";

const body = Inter({
  subsets: ["latin"],
  variable: "--font-body-loaded",
  display: "swap",
});

const heading = Zilla_Slab({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-heading-loaded",
  display: "swap",
});

// <html className={`${body.variable} ${heading.variable}`}>
// then point --font-heading / --font-body at the loaded variables.
```

`next/font` self-hosts at build time, so this costs no third-party request and
nothing to the offline story — which matters here, since a barn at zero bars
would otherwise get the fallback regardless.

## 2. Why it reads as flat

Panel `#191C3C` on canvas `#0E1026` is a contrast ratio of **1.13:1**. The
border `#7C80A6` against that same panel is **4.36:1**. The outline of a card is
roughly four times more visible than the card, so what the eye reads on every
screen is a grid of outlines rather than a stack of surfaces. Across a dashboard
of six boxes that is exactly the word: flat, and boxy.

Three things compound it.

**One radius and one shadow, everywhere.** `rounded-density` is a single token
and `Card` carries a single `box-shadow` string, so nothing on any screen is
ever nearer or further than anything else. No elevation, no depth.

**The brand colours barely appear.** Brass `#C9A24B` is declared and, in §8's
own words, "currently unused". Nebula purple survives as one `Tile` tone. The
star logomark renders once, in the nav; the constellation pedigree — the most
distinctive thing in the design language — renders on one chart.

**The starfield is buried.** It is drawn on a fixed `::before` behind the
surface, and then every card paints opaque `#191C3C` over the top of it. The one
piece of atmosphere in the design sits underneath the content.

The fix is entirely inside `theme.css` and `Card`, and needs no screen changes:
lift the panel a step, drop the border to a low-opacity hairline, add a
three-value shadow scale and a second radius, and — if the contrast tests agree —
let the panels sit at about 92% opacity so the sky reads through them.

## 3. Why it reads as cluttered

### The sidebar

Fifty-five routes in nine groups, thirteen of them under Cattle alone. The nav
already works hard to cope — groups collapse, the open set persists in
sessionStorage, the group holding the current route opens itself. That is good
engineering applied to the wrong shape.

Breeding, Calving, Health, Weights, Feed plans, Sales, Roadmap, Candidates,
Ancestors, Catalogue and Worth a look are not siblings of the herd. They are
views *of* the herd. Moved into the Cattle screen as a tab strip they collapse
to about nine tabs, the sidebar drops from 55 items to roughly 18, each domain
gains an in-page navigation that shows where you are inside it, and the same
move works unchanged for the seven horse routes when those arrive. The URL
structure underneath need not change at all.

A proposed top level:

| Group    | Holds                                       |
| -------- | ------------------------------------------- |
| Today    | Dashboard, Chores, Calendar, Property map   |
| Animals  | Cattle, Flock, Horses, Pets                 |
| Land     | Pastures, Garden                            |
| Kit      | Equipment, Feed, Supplies                   |
| Business | Bookings, Clients, Invoices, Forms          |

Contacts, Reports, Housesitter and Settings drop to a utility rail beneath. A
`⌘K` palette reaches all fifty-five by name, which is what makes the added depth
free rather than expensive.

### The screens

`supplies-screen.tsx` is 1,535 lines and renders, in one column: a page header
with an explanatory paragraph, four stat tiles, a reorder callout, and four
tabs — each tab containing a catalogue, an inline create-and-edit form, and a
complete history table. The form sits in the page flow, so the layout grows and
collapses underneath you while you work.

Three habits recur on nearly every screen.

**Prose in the interface.** The supplies subtitle reads: _"Shavings through show
sticks. On hand is the opening count plus what was bought, less what was used —
so correcting a purchase moves the total by itself."_ That is good writing, and
it belongs in help rather than above a table somebody reads forty times a week.
A header should carry facts — `38 items · $2,410 this year`.

**Chip soup.** `Badge` is outlined, `Pill` is filled, `SafetyBadge` is
saturated, and all three routinely land in the same row. The distinction is
principled and the comments defending it are correct; at a glance it is still
six small coloured things.

**Doubled primitives.** `Tile` and `Stat` are near-identical, as are `CardGrid`
and `StatRow`. Two ways to say one thing means two looks across two screens.

The structural fix is a `Sheet` primitive — a slide-over from the right on a
laptop, full-height from the bottom on a phone — so create and edit stop
reflowing the page behind them. One component replaces the inline form on all
forty-odd screens, and the phone case is the one that matters most, since inline
forms currently push the list off-screen entirely.

## 4. Why it takes a while to load

The architecture is right: every read comes from IndexedDB, so nothing on screen
waits on Neon. The problem is that the path to first paint is wholly sequential
and no step of it shows anything.

1. Edge middleware verifies the JWT.
2. The server component calls `currentActor()`.
3. The browser downloads the screen's JavaScript — up to 1,535 lines of client
   component.
4. It hydrates; `SyncProvider`'s effect opens Dexie.
5. Each `useRecords` effect subscribes — twelve of them on Reports, eleven on
   the animal tabs, ten on Housesitter.
6. Each `liveQuery` scans by `propertyId`, then filters and sorts in JavaScript.
   First data paint.

On step 4, `syncNow()` also fires immediately, so a full push and pull compete
with the first render for the main thread.

The number that matters most: **68 page routes, and none of them has a
`loading.tsx`.** The App Router will paint a route-level fallback the instant a
link is clicked, for free — but only if the file exists. Without it, clicking a
nav item does nothing visible until the server responds, which reads as a broken
click rather than as a load. Then the screen arrives and prints
`Loading the farm…` as plain grey text while IndexedDB opens.

In order of payoff per hour:

- **Add `loading.tsx` per route group.** Five files, each a skeleton matching the
  shape of the screens beneath it. Perceived latency drops immediately even
  though nothing has actually got faster.
- **Skeletons in place of `Loading the farm…`.** The layout is known before the
  data is, so draw it.
- **Split the big screens and lazy-load inactive tab panels.** Supplies,
  Equipment, Feed and Ancestors are 5,400 lines between them, and the supplies
  screen ships four tabs' worth of forms and tables in order to render one.
  `next/dynamic` on the inactive panels is mechanical and has no design
  consequence.
- **Defer the first sync one tick past hydration**, and give `@galaxy-farm/ui`
  subpath exports. The barrel in `packages/ui/src/index.ts` re-exports charts,
  the confirm dialog, the tag input and the search select into every screen that
  only wanted a `Card`.

## 5. Suggested order

| Step                                                    | Effort        |
| ------------------------------------------------------- | ------------- |
| Load Zilla Slab and Inter                               | An hour       |
| Add `loading.tsx` to each route group                   | An afternoon  |
| Retune the surfaces in `theme.css` and `Card`           | An afternoon  |
| Build `Sheet`; convert Supplies and Herd; merge `Tile`/`Stat` and `Badge`/`Pill` | A few days |
| Restructure the nav; add `⌘K`                           | A few days    |
| Split the four biggest screens; lazy-load tab panels    | A week        |

The first three are disproportionate to their cost, and the first one changes
every screen in the app at once.

## 6. Open questions

Three are genuine forks rather than repairs, and want a decision before the work
starts.

**Where the create form lives.** A `Sheet` primitive, or inline-but-collapsed.
The sheet is more work and one new component; inline is cheaper and still jumps
the layout, and still pushes the list off a phone screen.

**How far the sidebar is cut.** Five destinations plus `⌘K`, or keep the nine
groups and add a filter box. The filter is an afternoon and genuinely helps, but
the wall remains a wall and every new domain makes it taller.

**Whether the panels let the nebula through.** Translucent at ~92% with a real
elevation scale, or opaque with a wider panel-to-canvas gap. The first is the
one that makes the surface feel authored; it needs a pass through the contrast
tests in `packages/ui/tests/contrast.test.ts` before it can ship.
