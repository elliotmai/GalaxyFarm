import { redirect } from "next/navigation";

import { can, choreDaySheet, FALLBACK_FARM_NAME, startOfDay } from "@galaxy-farm/core";

import { SitterScreen } from "@/app/(sitter)/sitter/_components/sitter-screen";
import { currentActor } from "@/lib/auth";
import { withDeadline } from "@/lib/deadline";
import { peopleNames } from "@/lib/people-names";
import { EMPTY_SITTER_VIEW, sitterView, sitterWeather } from "@/lib/sitter-store";

export const metadata = { title: "Care Guide" };

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
        mayTick={false}
        closed={actor.accessWindow}
      />
    );
  }

  // Started before the guide is read rather than after, so the two lookups
  // run side by side: on a database that is not answering, each waits out
  // its own deadline, and one after the other is twice the wait.
  const names = peopleNames(actor.propertyId);
  // The weather's chores and its say over weather templates — covers before a
  // freeze, not every night. Never rejects; with no forecast it keeps them.
  const weather = withDeadline(
    sitterWeather(actor.propertyId, startOfDay(now), now),
    "the forecast",
  ).catch(() => ({ derived: [], weather: undefined }));

  let view = EMPTY_SITTER_VIEW;
  let unavailable: string | undefined;

  try {
    view = await withDeadline(sitterView(actor.propertyId), "the care guide");
  } catch (error) {
    // Logged, because a page that renders an apology and records nothing can
    // only be diagnosed by reproducing it — and the person looking at it is a
    // guest who cannot report much.
    console.error("[sitter:view]", error);
    unavailable =
      "The guide could not be loaded just now. Try again in a moment — and if it is urgent, ring the numbers you were given.";
  }

  const { derived, weather: forecastWeather } = await weather;
  const chores = choreDaySheet(
    { tasks: view.tasks, templates: view.templates, derived, weather: forecastWeather },
    startOfDay(now),
    now,
  );

  return (
    <SitterScreen
      farmName={farmName}
      view={view}
      chores={chores}
      day={now}
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
