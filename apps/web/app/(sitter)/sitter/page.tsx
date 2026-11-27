import { redirect } from "next/navigation";

import { can, choreDaySheet, FALLBACK_FARM_NAME, startOfDay } from "@galaxy-farm/core";

import { SitterScreen } from "@/app/(sitter)/sitter/_components/sitter-screen";
import { currentActor } from "@/lib/auth";
import { DEFAULT_TIMEZONE } from "@/lib/board-api";
import { database } from "@/lib/credential-store";
import { withDeadline } from "@/lib/deadline";
import { eggChoresFor } from "@/lib/egg-chores";
import { offWallClock, onWallClock, wallClock } from "@/lib/farm-time";
import { peopleNames } from "@/lib/people-names";
import { requestTimeZone } from "@/lib/request-time-zone";
import { EMPTY_SITTER_VIEW, farmTimeZone, sitterView, sitterWeather } from "@/lib/sitter-store";

export const metadata = { title: "Care Guide" };

/** How long the fallback zone lookup may hold the page. */
const ZONE_DEADLINE_MS = 2_000;

/**
 * The housesitter's view (spec §5.10, §7 `/sitter`).
 *
 * The second of §5.10's three outputs, off the same composition as the PDF —
 * "update a feeding plan anywhere and every format is already current". What
 * differs is not the content but the permission: read, plus the one write a
 * housesitter has, which is ticking off the chores they were asked to do.
 *
 * **The window is enforced here, not in the middleware.** The middleware is a
 * surface gate — which app you may load — and §4.3 puts the rest in the
 * application layer. `can` refuses `care.read` outside the access window, so
 * an account whose visit ended last week still reaches this route and finds
 * nothing on it, which is the honest answer and the one that says what
 * happened.
 *
 * Nothing is read from the device. See `lib/sitter-store.ts` for why: a sync
 * pull is scoped to a property rather than to a capability, so a sitter
 * running the engine would end up holding the whole farm on a phone that goes
 * home with them.
 */
export default async function SitterPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/sitter");

  const now = new Date();
  const farmName = process.env["NEXT_PUBLIC_FARM_NAME"] ?? FALLBACK_FARM_NAME;

  // Outside the window there is nothing to fetch, so nothing is fetched.
  if (!can(actor, "care.read", now)) {
    return (
      <SitterScreen
        farmName={farmName}
        view={EMPTY_SITTER_VIEW}
        chores={[]}
        day={now}
        timeZone={(await requestTimeZone()) ?? DEFAULT_TIMEZONE}
        mayTick={false}
        closed={actor.accessWindow}
      />
    );
  }

  // Started first, and before anything is awaited: neither depends on the
  // time zone, and on a database that is not answering each waits out its own
  // deadline — so they have to be waiting side by side, not queued behind the
  // zone lookup below. Queued, a dead database held the page on "Loading…"
  // past thirty seconds (the driver's connect timeout) before any apology.
  const names = peopleNames(actor.propertyId);
  const guide = withDeadline(sitterView(actor.propertyId), "the care guide");
  // Awaited only after the zone; a fast failure before then must not count as
  // an unhandled rejection, which takes the server down with it.
  void guide.catch(() => undefined);

  /*
   * The sitter's own clock, not the server's.
   *
   * This page is drawn on the server, which runs in UTC, so after about 6 p.m.
   * in Texas `startOfDay(now)` was already tomorrow and the sitter was shown
   * tomorrow's chores. The day is worked out on the device's wall clock (from
   * its cookie, falling back to the property's zone) and every time is brought
   * back to a real instant before it goes to the browser.
   *
   * The property's zone is a fallback, so it gets a short deadline: a guess at
   * Texas is a far better answer than a guest staring at a spinner.
   */
  const timeZone =
    (await requestTimeZone()) ??
    (await withDeadline(
      farmTimeZone(database(), actor.propertyId),
      "the farm's time zone",
      ZONE_DEADLINE_MS,
    ).catch(() => undefined)) ??
    DEFAULT_TIMEZONE;
  const wallNow = wallClock(now, timeZone);

  // The weather's chores and its say over weather templates — covers before a
  // freeze, not every night. Never rejects; with no forecast it keeps them.
  const weather = withDeadline(
    sitterWeather(actor.propertyId, startOfDay(wallNow), wallNow),
    "the forecast",
  ).catch(() => ({ derived: [], weather: undefined, arrives: {} }));

  let view = EMPTY_SITTER_VIEW;
  let unavailable: string | undefined;

  try {
    view = await guide;
  } catch (error) {
    // Logged, because a page that renders an apology and records nothing can
    // only be diagnosed by reproducing it — and the person looking at it is a
    // guest who cannot report much.
    console.error("[sitter:view]", error);
    unavailable =
      "The guide could not be loaded just now. Try again in a moment — and if it is urgent, ring the numbers you were given.";
  }

  const { derived, weather: forecastWeather, arrives } = await weather;
  // The guide on the same wall clock as the day, so "current" medicines and
  // pen assignments are judged against the sitter's today.
  const local = onWallClock(view, timeZone);
  const chores = offWallClock(
    choreDaySheet(
      {
        tasks: local.tasks,
        templates: local.templates,
        // The egg round rides the flocks, for as long as there are laying birds.
        derived: [
          ...derived,
          ...eggChoresFor(
            { flocks: local.flocks, adjustments: local.flockAdjustments, zones: local.zones },
            startOfDay(wallNow),
            wallNow,
          ),
        ],
        weather: forecastWeather,
        weatherArrives: onWallClock(arrives, timeZone),
      },
      startOfDay(wallNow),
      wallNow,
    ),
    timeZone,
  );

  return (
    <SitterScreen
      farmName={farmName}
      view={local}
      chores={chores}
      day={now}
      timeZone={timeZone}
      mayTick={can(actor, "chores.complete", now)}
      actorId={actor.id}
      // Unawaited: the guide streams without the names, and each "Done by"
      // fills in when they land. Only handed over when a row will read them —
      // a promise in the stream holds the page open until it settles.
      names={chores.some((entry) => entry.completedBy !== undefined) ? names : undefined}
      {...(unavailable === undefined ? {} : { unavailable })}
    />
  );
}
