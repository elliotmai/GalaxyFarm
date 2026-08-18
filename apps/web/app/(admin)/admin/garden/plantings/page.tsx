import { redirect } from "next/navigation";

import { PlantingsScreen } from "@/app/(admin)/admin/garden/plantings/_components/plantings-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Plantings" };

/**
 * What is in the ground (§5.5, §7 `/admin/garden/plantings`).
 *
 * The beds live here too, rather than waiting on the layout designer (#33).
 * A bed is a record before it is a rectangle: a planting has to name one, and
 * a garden that cannot be used until somebody has drawn it is a garden nobody
 * records. The designer will edit the same records and fill in the geometry
 * these forms leave alone.
 */
export default async function AdminGardenPlantingsPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/garden/plantings");

  return <PlantingsScreen propertyId={actor.propertyId} actorId={actor.id} />;
}
