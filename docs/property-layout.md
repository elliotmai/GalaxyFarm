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
| Tub / chute | working facility | None | Holds cattle during drop-offs, pickups, and staging |
| Randy's pasture | `pasture` | Unknown | Neighbour's land, used on and off |

Also on the property, not animal zones: barn, alley way, lean-to creep, well
house, chicken coop, garden, house and carport.

## Water — four tanks, no heaters

| Tank | Serves | Type |
|---|---|---|
| 1 | Pasture + Hay Field | Auto-refill |
| 2 | Pen 1 + 2nd Pen | Auto-refill |
| 3 | Pen A + Pen B | Auto-refill |
| 4 | West Pen | Static, seasonal |

**Not one of them has a heater.** Spec §6 treats heaterless tanks as the
vulnerable ones and calls them out by name in the freeze alert — here that is
every tank on the place. This is worth knowing ahead of the first hard freeze,
and it lands in the same window as calving (see below).

## Livestock

**Andromeda ("Andy")** — bred **14 February 2026** by **AI** to **ZNT Montego
Bay**.

At the spec's flat 283-day gestation (§12, decision 2) that projects to
**24 November 2026**, with the calving window opening **10 November**. Roughly
fifteen weeks out from mid-August, and thirteen to the window.

## Open modelling questions

Three things here do not fit the current model. None should be guessed at.

### 1. Tanks are shared between zones

`Zone` carries `hasWaterTank` and `hasTankHeater` as booleans, which assumes one
tank per zone. Three of the four tanks serve **two zones each**.

The consequence is concrete: §6 injects an ice-breaking chore per zone flagged
`hasWaterTank`. As modelled, a freeze day would generate seven chores for four
tanks, sending someone to the same trough twice and making the list less
trustworthy every time it happens.

The fix is to make a water source its own record that zones reference — one
chore per tank, and a heater becomes a property of the tank rather than of every
zone that drinks from it. That is a small change now and an awkward one later.

### 2. West Pen's tank is seasonal

`hasWaterTank` is a static boolean, but West Pen only has water when a tank is
put out there. Either the flag needs to be editable in a way that changes the
freeze chore, or the water source needs an active/inactive state.

### 3. Randy's pasture is not on this property

Everything hangs off `propertyId` (§5). A neighbour's pasture that cattle
genuinely occupy is either a `Zone` flagged as not-owned, or a second `Property`.
The flag is simpler; a second property is more honest and costs a query filter.

### 4. `ZoneType` has no working facility

The tub and chute hold cattle. Calling them a `pen` would put them on the Pen
Board as though something lived there, which is wrong on the screen that gets
glanced at most. Adding `working_facility` to the enum is the obvious answer.

## Still unknown

- **Exact coordinates.** The address places the farm near 33.05° N, 97.47° W,
  but that is a town-level approximation and the weather, calving watch, and
  frost thresholds deserve the real thing. A pin dropped on the house is enough.
- **Growing zone.** Wise County reads 8a on the 2023 USDA map, against Fort
  Worth's 8a/8b. Worth confirming rather than inheriting the spec's "≈ 8b".
- Baseline safety level per zone, and per-pen capacity.
- Whether the pasture's dashed line is a fence that exists.
