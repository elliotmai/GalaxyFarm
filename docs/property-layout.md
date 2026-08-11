# Property layout

Transcribed from the hand-drawn sketch (2 June 2026). **This is my reading of
that drawing, not verified ground truth** — correct anything wrong before it
gets seeded, because these zone records are what the Pen Board, the housesitter
guide, and the freeze alerts all hang off.

The sketch itself should live alongside this file as `property-sketch.jpg` once
someone adds it to the repo.

## Zones

Six named pens and pastures, which matches the count spec §5.1 expects to seed.

| Zone | Type | Notes from the sketch |
|---|---|---|
| Pasture | `pasture` | The large block. A dashed line runs through it — an interior cross-fence, or a planned one |
| West Pen | `pen` | Along the western boundary |
| Pen 1 | `pen` | Adjacent to the alley |
| 2nd Pen | `pen` | Water point marked inside |
| Pen A | `pen` | Off the alley, near the barn |
| Pen B | `pen` | Water point marked inside; nearest the house |

## Working facility

| Place | Notes |
|---|---|
| Barn | South-west of the house |
| Alley way | Runs between the pens and the working facility |
| Tub / chute | Attached to the alley |
| Lean-to creep | Small structure at the north end, by the well house |

## Other structures

| Place | Notes |
|---|---|
| House, carport | Red outline — the residence, not a farm zone |
| Well house | North end, adjacent to the lean-to creep |
| Chickens | Coop, between Pen B and the barn |
| Garden | North-east, below the hay area |
| Hay | Curved storage area near the garden |
| "1000" | Circled, near the house. Reading this as a 1,000-gallon tank |

Scattered squiggles are read as trees. The double line curving from the road to
the house is read as the driveway.

## Water points

Three circled marks, read as tanks or troughs:

1. At the gate between the pasture and the lane
2. Inside 2nd Pen
3. Inside Pen B

**This is the part most worth getting right.** Spec §6 auto-injects a
"break ice / verify tank heaters" chore for every zone flagged `hasWaterTank`
on a hard-freeze day, and calls out by name the ones without a heater. A missing
flag means a tank nobody was told to check.

## Open questions

Nothing below can be inferred from the sketch.

1. **Which tanks have heaters?** Drives the freeze alert (§6).
2. **Do the pens have water at all**, beyond the three marked points — Pen 1,
   Pen A, and West Pen show none.
3. **Baseline safety level per zone** (§5.1). The working facility in particular
   — is the tub/chute a place a helper should be in unaccompanied?
4. **Capacity per pen**, if you want the over-capacity warning to mean anything.
5. **Is the dashed line in the pasture an existing cross-fence or a plan?**
6. **Which pens are covered vs. open** (`indoor` flag).
7. **Property coordinates.** Needed for weather, calving watch, frost warnings,
   and the growing-zone suggestion.

## A gap this exposed in the spec

`ZoneType` in §5.1 is `pen | pasture | coop | barn | stall | garden_area`. The
sketch has three places that do not fit any of them:

- **the alley way and tub/chute** — animals occupy them, briefly and under
  handling, but they are not pens and treating them as pens would put them on
  the Pen Board as though something lived there
- **hay storage** — matters to the feed module, is not an animal zone
- **the well house** — infrastructure

Options: add a `working_facility` type (and possibly `storage`), or model the
working facility as a single zone and leave hay and the well house out of the
zone model entirely. Worth a decision-log entry either way; see the note on the
issue rather than guessing.
