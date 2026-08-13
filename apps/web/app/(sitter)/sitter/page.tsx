import { redirect } from "next/navigation";

import { can, choreDaySheet, startOfDay } from "@galaxy-farm/core";

import { SitterScreen } from "@/app/(sitter)/sitter/_components/sitter-screen";
import { currentActor } from "@/lib/auth";
import { withDeadline } from "@/lib/deadline";
import { EMPTY_SITTER_VIEW, sitterView } from "@/lib/sitter-store";

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
  const farmName = process.env["NEXT_PUBLIC_FARM_NAME"] ?? "Galaxy Farm";

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

  const chores = choreDaySheet(
    { tasks: view.tasks, templates: view.templates },
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
      {...(unavailable === undefined ? {} : { unavailable })}
    />
  );
}
