# Property layout

**1220 County Road 4651, Rhome TX 76078** (Wise County)

Transcribed from the hand-drawn sketch of 2 June 2026 and corrected against
answers given 11 August 2026. These zone records are what the Pen Board, the
housesitter guide, and the freeze alerts all hang off.

## Zones

Nine, not the six the sketch first suggested. The tub holds cattle during
drop-offs and staging, the hay area turned out to be a field, and the neighbour's
pasture is in regular use.

| Zone | Type | Water | Notes |
|---|---|---|---|
| Pasture | `pasture` | Auto-refill tank, **shared with Hay Field** | Dashed line on the sketch — cross-fence, existing or planned, unconfirmed |
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
freeze, separately from the ice-breaking chore on the morning itself. Which of
the four tanks have covers is not recorded here yet; the seed assumes all four
do and that they are off out of season.

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
