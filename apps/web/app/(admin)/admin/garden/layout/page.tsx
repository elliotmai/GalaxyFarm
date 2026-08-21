import { redirect } from "next/navigation";

import { GardenLayoutScreen } from "@/app/(admin)/admin/garden/layout/_components/garden-layout-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Garden Layout" };

/**
 * The layout designer (§5.5, §8, issue #33).
 *
 * The shared `SpatialEditor` in garden mode — §2's "one component, two
 * palettes", now that both palettes have a caller. The beds themselves are
 * records first and are managed under **Plantings → Beds**; this page is the
 * drawing of them, and the only place their geometry is written.
 */
export default async function AdminGardenLayoutPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/garden/layout");

  return <GardenLayoutScreen propertyId={actor.propertyId} actorId={actor.id} />;
}
