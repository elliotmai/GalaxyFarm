import { redirect } from "next/navigation";

import { ZonesScreen } from "@/app/(admin)/admin/pastures/_components/zones-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Zones" };

/**
 * Zones — pens, pastures, and working facilities (§5.1).
 *
 * Filed under `/admin/pastures` because that is where §7 puts it. Everything
 * on the farm hangs off a zone, so this is the screen that has to exist before
 * the rest can.
 */
export default async function ZonesPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/pastures");

  return <ZonesScreen propertyId={actor.propertyId} actorId={actor.id} />;
}
