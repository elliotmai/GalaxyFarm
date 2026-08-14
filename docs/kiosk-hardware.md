# Kiosk hardware

What to actually screw to a barn wall. Companion to spec §4.4 and the
[`Kiosk mode` architecture note](../README.md#architecture-notes) — this file
is about the physical screen, not the software running on it.

## The short answer

For most of this farm's boards (Pen Board, Today's Chores, Housesitter Mode),
a **10–13" Android tablet, wall-mounted, permanently powered, running [Fully
Kiosk Browser](https://www.fully-kiosk.com/)** is the right default. It is
cheap, it is a real Chromium browser (so the PWA and its service worker work
exactly as they do on a phone), and Fully Kiosk's whole reason to exist is
pinning a browser to one URL and keeping the screen awake — which is the
"screen-wake hints" line in spec §4.4 handled for free rather than fought.

For **Egg Quick-Entry**, mounted right at the coop, go smaller and cheaper —
an old phone works, and the mockups literally draw it as one. For a future
**Program Day Sheet** landscape TV in the show barn (Phase 5), go the other
direction: a small PC and a real monitor, below.

## Three tiers

| Tier | What | Cost | Best for |
|---|---|---|---|
| **Free** | An old phone or tablet already in a drawer, in a $10 clamp mount, Chrome pinned via "Add to Home Screen" | $0–15 | Trying the app before buying anything; the coop |
| **Recommended** | A new 10–13" Android tablet + Fully Kiosk Browser + a wall/VESA mount with AC power | $130–250 | The barn aisle, the tack room, anywhere a board runs all day |
| **Robust** | A fanless mini PC + a commercial touchscreen monitor, Chrome in `--kiosk` mode, VESA-mounted | $250–450 | A fixed landscape display — Program Day Sheet, a lobby-style overview |

Buy one, live with it a season, then decide whether a second location earns
the upgrade. Every board is reachable from a phone too (§4.4 doesn't require
a dedicated screen) — a kiosk is a convenience for the spot you'd otherwise be
unlocking a phone ten times a day.

## Recommended: a wall tablet

**Tablet.** Any current Android tablet with a real Chrome build (Google
Play, not a locked-down storefront) in the 10–13" range. Lenovo's Tab
series and Samsung's Galaxy Tab A series are the usual budget-to-midrange
picks; a "digital signage" tablet sold for exactly this purpose (fixed
mount, AC-powered, no battery to degrade) is worth the small premium if one
is going in permanently — it skips the battery-swelling problem a consumer
tablet left plugged in 24/7 eventually has.

Skip Amazon Fire tablets for this. Fire OS's Silk browser has a history of
incomplete service-worker support, and this app is built around one working
(spec §4.2) — the local store, the offline queue, and the auto-refresh on
sync all depend on it. A Fire tablet with Chrome sideloaded through the Play
Store workaround can work, but it is fighting the device rather than using
it, for a savings of maybe $30.

**Kiosk launcher.** [Fully Kiosk Browser](https://www.fully-kiosk.com/) (free
tier is enough; the paid unlock adds remote admin, useful past the first
screen). Point it at `https://<your-domain>/kiosk`, set:

- **Screen always on** — the single most important setting. A board nobody
  can see because the tablet slept is worse than no kiosk at all.
- **Kiosk/lockdown mode** — disables the home/back gestures and the
  notification shade, so a barn visitor's stray tap can't back out to the
  tablet's home screen.
- **Auto-reload on error**, a day or so — cheap insurance against a
  Wi-Fi hiccup leaving the tablet on an error page nobody notices until
  someone walks up.
- **Motion-detection wake** (if the model has a front camera worth using
  for it) is a nice touch for Pen Board or Housesitter Mode, less useful
  for a screen that's tapped constantly anyway (chores, eggs).

Pairing itself (spec §4.4) happens once, from inside this browser, at
`/kiosk/pair` — nothing about the launcher needs to know the code.

**Mount.** A VESA or clamp wall mount rated for the tablet's weight, AC
power run to it rather than relying on the battery — the battery still
matters as a UPS for a two-second power blip, but a tablet doing this job
for years on battery cycling will not have a battery for long. An outdoor
or "rugged" case is worth it in an actual barn: dust, hay chaff, and
condensation are the real environment, not a living room.

## Robust: a small PC and a real monitor

For a fixed landscape display — this is what Program Day Sheet (§4.4,
Phase 5) and any future "farm-wide overview" TV want — a fanless mini PC
(the Beelink/GMKtec/Intel NUC class of device, $100–200) driving a
commercial **touchscreen** monitor (a POS-style 15.6"–21.5" touch monitor,
$150–300) beats a large consumer tablet on cost past about 15 inches, and
gives a real desktop Chrome running `chrome --kiosk https://<domain>/kiosk`
from a startup script — no launcher app, no mobile-OS quirks, and a screen
that's trivial to keep updated with `apt`/`winget` from the house network.

This is the setup that most literally matches the show-barn mockup in
`docs/galaxy-farm-mockups-complete.html` — landscape, calf × activity grid,
readable from across the alley.

## Free: what's already in a drawer

An old phone or tablet, even one with a cracked corner, is a completely
legitimate permanent kiosk if it can still run a modern Chrome. "Add to
Home Screen" installs the PWA; a $10 phone clamp or a bit of Command strip
and a phone case with a kickstand gets it on the wall. This is the right
starting point before spending anything — pair it, run it for a couple of
weeks at the coop or the gate, and let the board that turns out to matter
most decide where the Recommended-tier upgrade goes.

## Network

Every board reads from the device's own local store first (spec §4.2), so a
kiosk with zero bars still shows the last data it pulled and still queues
nothing it isn't allowed to queue — but it needs *some* signal periodically
to stay current, and the whitelisted writes (`eggs.log`, `chores.complete`,
`animals.move`) need it at the moment they happen to reach anyone else's
screen. A barn is exactly the building Wi-Fi struggles to reach from the
house router; a single mesh node or a weatherproof access point in the barn
is worth more to this feature than any hardware upgrade on the list above.

## Power

Plan for the tablet or PC to be plugged in permanently — this is a fixture,
not a device someone carries and charges. A basic surge-protected outlet is
enough; a barn's power is dirtier than a house's, and a screen that reboots
after every storm is a screen someone stops trusting.
