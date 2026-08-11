import { redirect } from "next/navigation";

import { can } from "@galaxy-farm/core";

import { TrashScreen } from "@/app/(admin)/admin/settings/_components/trash-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Trash" };

/**
 * Trash (§4.5 clause 4).
 *
 * `records.purge` is checked here, in the application layer, rather than by
 * hiding a button — §4.3 is explicit that a hidden control is not a permission
 * check. The screen is told what the actor may do and renders accordingly.
 */
export default async function TrashPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/settings/trash");

  return (
    <TrashScreen propertyId={actor.propertyId} canPurge={can(actor, "records.purge", new Date())} />
  );
}
