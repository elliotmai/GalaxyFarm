import { redirect } from "next/navigation";

import { can } from "@galaxy-farm/core";

import { SettingsScreen } from "@/app/(admin)/admin/settings/_components/settings-screen";
import type { PersonRow } from "@/app/(admin)/admin/settings/_components/people-screen";
import { currentActor } from "@/lib/auth";
import { withDeadline } from "@/lib/deadline";
import { listDeletedUsers, listUsers } from "@/lib/user-store";

export const metadata = { title: "Settings" };

/**
 * Settings, including who can sign in (§7).
 *
 * The people list is read here, on the server, rather than from the device.
 * `users` is the one entity §4.3 keeps off devices entirely — it carries
 * password hashes and invitation tokens — so this page is dynamic where the
 * rest of the app is local-first.
 *
 * The read is skipped outright for anybody without `users.manage`, so a member
 * opening settings does not cause a query for a list they may not see. The
 * actions behind the tab check the capability again regardless: §4.3 is
 * explicit that a hidden tab is not a permission check.
 *
 * **A database that cannot be reached is a missing list, not a broken page.**
 * Everything else on this screen comes from the device and is unaffected by
 * Neon being asleep, a migration mid-flight, or the barn being off the
 * internet — so a failure here says so in a box and leaves the rest working.
 * Letting it throw would take the whole of settings down with it.
 *
 * The deadline matters as much as the catch. A database that is *not
 * answering* fails far more slowly than one that refuses, and the driver's own
 * timeout is thirty seconds by design — see `lib/deadline.ts`.
 */
export default async function AdminSettingsPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/settings");

  const now = new Date();
  const mayManagePeople = can(actor, "users.manage", now);

  let people: readonly PersonRow[] = [];
  let deleted: readonly PersonRow[] = [];
  let unavailable: string | undefined;

  if (mayManagePeople) {
    try {
      [people, deleted] = await withDeadline(
        Promise.all([listUsers(actor.propertyId, now), listDeletedUsers(actor.propertyId, now)]),
        "the people list",
      );
    } catch (error) {
      // Logged, because a page that renders an apology and records nothing can
      // only be diagnosed by reproducing it.
      console.error("[settings:people]", error);
      unavailable =
        "Could not reach the database, so the list of people is not here. Everything else on this page is read from this device and is unaffected.";
    }
  }

  return (
    <SettingsScreen
      propertyId={actor.propertyId}
      actorId={actor.id}
      people={people}
      deleted={deleted}
      mayManagePeople={mayManagePeople}
      {...(unavailable === undefined ? {} : { unavailable })}
    />
  );
}
