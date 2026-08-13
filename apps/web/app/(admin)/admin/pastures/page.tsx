import { redirect } from "next/navigation";

import { LandScreen } from "@/app/(admin)/admin/pastures/_components/land-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Pastures and water" };

/**
 * Land — zones, the tanks that water them, and pasture care (§5.1, §7).
 *
 * Filed under `/admin/pastures` because that is where §7 puts it. Everything
 * on the farm hangs off a zone, so this is the screen that has to exist before
 * the rest can.
 */
export default async function LandPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/pastures");

  return <LandScreen propertyId={actor.propertyId} actorId={actor.id} />;
}
