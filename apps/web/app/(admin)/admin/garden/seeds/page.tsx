import { redirect } from "next/navigation";

import { SeedsScreen } from "@/app/(admin)/admin/garden/seeds/_components/seeds-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Seed Inventory" };

/**
 * The seed box, and the catalogue underneath it (§5.5, §7 `/admin/garden/seeds`).
 *
 * Three entities on one screen because they are one idea in three layers: a
 * crop is what it is, a variety is which one, and a seed entry is how much of
 * it is in the box. Splitting them across three routes would mean adding a
 * packet of a variety you have not recorded yet takes two page loads.
 */
export default async function AdminGardenSeedsPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/garden/seeds");

  return <SeedsScreen propertyId={actor.propertyId} actorId={actor.id} />;
}
