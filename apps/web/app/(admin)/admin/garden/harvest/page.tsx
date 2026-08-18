import { redirect } from "next/navigation";

import { HarvestScreen } from "@/app/(admin)/admin/garden/harvest/_components/harvest-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Harvest & Preservation" };

/**
 * What came off, and what was put by (§5.5, §7 `/admin/garden/harvest`).
 *
 * Two halves of one question. The harvest log answers "what did that bed
 * give"; the pantry answers "what is on the shelf" — and the second is the one
 * somebody stands in a doorway asking.
 */
export default async function AdminGardenHarvestPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/garden/harvest");

  return <HarvestScreen propertyId={actor.propertyId} actorId={actor.id} />;
}
