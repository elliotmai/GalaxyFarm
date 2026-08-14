# Property layout

**1220 County Road 4651, Rhome TX 76078** (Wise County)

Transcribed from the hand-drawn sketch of 2 June 2026 and corrected against
answers given 11 August 2026 and 14 August 2026. These zone records are what the
Pen Board, the housesitter guide, and the freeze alerts all hang off.

The sketch itself is not in this repository. It was re-read on 14 August and
what it settles is written down here, because a fact that only exists in a photo
somebody has to go and find is a fact this app cannot use.

## Zones

Nine, not the six the sketch first suggested. The tub holds cattle during
drop-offs and staging, the hay area turned out to be a field, and the neighbour's
pasture is in regular use.

| Zone | Type | Water | Notes |
|---|---|---|---|
| Pasture | `pasture` | Auto-refill tank, **shared with Hay Field** | Dashed line on the sketch is a **temporary cross-fence** — see below |
| Hay Field | `pasture` | Same auto tank as Pasture | Hay is stored in a section of it; cattle can graze it |
| West Pen | `pen` | Static tank, **only when one is put out** | Not plumbed |
| Pen 1 | `pen` | Auto-refill tank, **shared with 2nd Pen** | |
| 2nd Pen | `pen` | Same auto tank as Pen 1 | |
| Pen A | `pen` | Auto-refill tank, **shared with Pen B** | |
| Pen B | `pen` | Same auto tank as Pen A | |
| Tub / chute | `working_facility` | None | Holds cattle during drop-offs, pickups, and staging |
| Randy's pasture | `pasture` | Same auto tank as Pen 1 / 2nd Pen | Neighbour's land, used on and off |

Also on the property, not animal zones: barn, alley way, lean-to creep, well
house, chicken coop, garden, house and carport.

## Grouping — still to be filled in

Zones group into one another as of v1.5: **stalls go in barns, pens and
pastures go in areas** (North, South, whatever this place calls its ends).
Both are the same field, so a barn is picked by name — a stall is in the Red
Barn, not in "a barn".

Nothing here is grouped yet, which is a legitimate state: **a zone with no
group is its own group**, and that is what all nine currently are. Two things
are needed before that changes, and neither is guessable from the sketch:

- **What the areas are called.** North and South were the example given, not a
  statement about this place.
- **The barn's name.** The barn is listed above as a structure but has never
  been created as a zone, so there is nothing yet for a stall to be in.

Whether a zone is **inside or outside** is already recorded, and it is load
bearing: an animal holds one of each at once — a stall and a pasture — so a
stall marked outside would quietly take the pasture's place.

## Water — four tanks, no heaters

| Tank | Serves | Type |
|---|---|---|
| 1 | Pasture + Hay Field | Auto-refill |
| 2 | Pen 1 + 2nd Pen + Randy's pasture | Auto-refill |
| 3 | Pen A + Pen B | Auto-refill |
| 4 | West Pen | Static, seasonal |

**Not one of them has a heater, and none is wanted.** Spec §6 treats heaterless
tanks as the vulnerable ones and calls them out by name in the freeze alert —
here that is every tank on the place. This is worth knowing ahead of the first
hard freeze, and it lands in the same window as calving (see below).

**What is actually done about it is covers** (confirmed 13 August 2026). Each
tank's cover is tracked as one of three states — `none`, `off`, `on` — and the
freeze alert raises "put the cover on" the evening before the first forecast
freeze, separately from the ice-breaking chore on the morning itself.

**The three auto-refill tanks have covers. The West Pen's static tank does
not**, so it can only be broken open, and it is the one tank the cover list
should never name. All three covers are currently off.

| Tank | Type | Cover |
|---|---|---|
| 1 — Pasture + Hay Field | Auto-refill | Yes, off |
| 2 — Pen 1 + 2nd Pen + Randy's | Auto-refill | Yes, off |
| 3 — Pen A + Pen B | Auto-refill | Yes, off |
| 4 — West Pen | Static, seasonal | None |

## The dashed line — a temporary cross-fence (answered 14 August 2026)

Not a planned fence and not a mistake in the drawing. It is **temporary fencing
that gets put up to section the Pasture, so the cattle can be locked out of the
large portion.** It goes up and comes down, which makes it a state rather than a
fact about the place — the same reason `WaterSource.cover` and `active` are
states.

It matters to three things:

- **The Pen Board.** "Pasture" while the fence is up means a strip of it. A
  housesitter reading the board would otherwise walk the whole field looking for
  cattle standing in one corner of it.
- **Grazing.** The area actually being eaten is a fraction of the zone, so
  anything reasoning about how long the pasture lasts is wrong by the same
  fraction while the fence stands.
- **Water, which is the one that could hurt something.** The Pasture's tank is
  shared with the Hay Field and sits at that end. A cross-fence put up between
  the cattle and the tank leaves them shut in with no water, and nothing about
  the arrangement looks unusual from the gate. In the configuration drawn, the
  cattle keep the end the tank is on — but that is a fact about where this fence
  goes, not a guarantee about the next one, so it is checked rather than assumed.

Modelled as `Zone.dividers` — see the decision below.

## What the sketch confirms

- **Three tanks are drawn, in the places the records already had them**: at the
  Pasture/Hay corner, on the fence between Pen 1 and 2nd Pen, and between Pen A
  and Pen B. The fourth — West Pen's — is not on the sketch at all, which is
  what a tank that is only put out seasonally should look like.
- **The buildings and the drive** are as recorded: barn, alley way, tub/chute,
  chicken coop, lean-to creep and well house at the top corner, garden, and the
  house and carport off the drive.
- **Randy's pasture is not on it**, because it is the neighbour's. That settles
  the open question below in favour of not giving it a boundary here.

Two things to check when the boundaries are actually drawn:

- **Hay Field's size.** On the sketch "Hay" is a small shape beside the garden,
  not a field. The 11 August correction says it is a field cattle can graze, and
  that wins — but the two readings disagree about how much ground it is, and the
  boundary is where that gets settled.
- **The acreage note.** There is a circled figure near the south boundary that
  reads as an area. Worth confirming what it covers.

## Livestock

**Andromeda ("Andy")** — bred **14 February 2026** by **AI** to **ZNT Montego
Bay**.

At the spec's flat 283-day gestation (§12, decision 2) that projects to
**24 November 2026**, with the calving window opening **10 November**. Roughly
fifteen weeks out from mid-August, and thirteen to the window.

## Modelling decisions taken

### Water is its own record — resolved

`WaterSource` is now an entity, and `Zone.waterSourceIds` points at it. Four
tanks serve eight zones here; the previous `hasWaterTank` boolean on `Zone`
would have produced **eight ice-breaking chores for four tanks** on a freeze
day, sending someone to the Pen 1/2 trough three times. `freezeCheckTargets`
derives one chore per tank and names every zone it serves.

The heater is a property of the tank, not of every zone drinking from it, which
also means the §6 "vulnerable" list is right by construction — here it is all
four tanks.

### Seasonal water — resolved

`WaterSource.active` is false when a tank is not currently out. West Pen's
static tank raises no chore while it is stowed.

### `working_facility` zone type — resolved

Added to `ZoneType`. The tub and chute hold cattle under handling but nothing
lives there, and calling them pens would put them on the Pen Board as though
something did.

### Randy's pasture — still open

Modelled as a `Zone` for now. It is the neighbour's land, so the honest options
are a not-owned flag or a second `Property`. Nothing depends on the answer until
the map is drawn, since it has no boundary polygon on this property anyway.

## Still unknown

- **Exact coordinates.** The address places the farm near 33.05° N, 97.47° W,
  but that is a town-level approximation and the weather, calving watch, and
  frost thresholds deserve the real thing. A pin dropped on the house is enough.
- **Growing zone.** Wise County reads 8a on the 2023 USDA map, against Fort
  Worth's 8a/8b. Worth confirming rather than inheriting the spec's "≈ 8b".
- Baseline safety level per zone, and per-pen capacity.
- Whether the pasture's dashed line is a fence that exists.
