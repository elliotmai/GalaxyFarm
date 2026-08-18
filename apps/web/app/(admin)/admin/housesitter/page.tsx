import { redirect } from "next/navigation";

import { can, FALLBACK_FARM_NAME } from "@galaxy-farm/core";

import { HousesitterScreen } from "@/app/(admin)/admin/housesitter/_components/housesitter-screen";
import type { SitterRow } from "@/app/(admin)/admin/housesitter/_components/sitter-access";
import { currentActor } from "@/lib/auth";
import { withDeadline } from "@/lib/deadline";
import { listUsers } from "@/lib/user-store";

export const metadata = { title: "Housesitter Guide" };

/**
 * The care guide, and who may read it (spec §5.10, §7 `/admin/housesitter`).
 *
 * Two halves that belong together. The guide is composed from records on this
 * device, so it works with no signal at all. The sitter accounts are the one
 * thing that never reaches a device — §4.3 keeps `users` off them, hashes and
 * invitation tokens being what they are — so that half is read here, on the
 * server, and re-read after every change.
 *
 * A database that cannot be reached is a missing list, not a broken page: the
 * guide is the reason somebody opens this screen, and it comes from
 * IndexedDB. Letting the account read throw would take the guide down with it,
 * which is the wrong failure by a wide margin.
 */
export default async function AdminHousesitterPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/housesitter");

  const now = new Date();
  const mayManagePeople = can(actor, "users.manage", now);

  let sitters: readonly SitterRow[] = [];
  let unavailable: string | undefined;

  if (mayManagePeople) {
    try {
      const people = await withDeadline(listUsers(actor.propertyId, now), "the sitter list");
      sitters = people
        .filter((person) => person.user.role === "housesitter")
        .map((person) => ({ user: person.user, state: person.state }));
    } catch (error) {
      // Logged, because a page that renders an apology and records nothing can
      // only be diagnosed by reproducing it.
      console.error("[housesitter:sitters]", error);
      unavailable =
        "Could not reach the database, so the list of sitters is not here. The guide below is read from this device and is unaffected.";
    }
  }

  return (
    <HousesitterScreen
      propertyId={actor.propertyId}
      actorId={actor.id}
      /*
       * The first paint's farm name, exactly as the admin layout does it: the
       * stored value lives in IndexedDB, which a server component cannot read,
       * and `HousesitterScreen` prefers it the moment the store answers. Every
       * sheet of the printed guide carries this name, so a placeholder that
       * flashed and then corrected itself would be a placeholder somebody
       * eventually prints.
       */
      farmName={process.env["NEXT_PUBLIC_FARM_NAME"] ?? FALLBACK_FARM_NAME}
      sitters={sitters}
      mayManagePeople={mayManagePeople}
      {...(unavailable === undefined ? {} : { unavailable })}
    />
  );
}
