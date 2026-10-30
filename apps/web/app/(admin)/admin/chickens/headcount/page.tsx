import { redirect } from "next/navigation";

import { FlockScreen } from "@/app/(admin)/admin/chickens/flock/_components/flock-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Headcount" };

/**
 * `/admin/chickens/headcount` — the flocks' headcount log, and the losses
 * line above it (spec §5.4).
 *
 * The Chickens page is the list now, laid out like every other species'; this
 * is the flock tool it used to open on — what changed, when and why — kept as
 * one of the tools in the Chickens strip.
 */
export default async function AdminChickensHeadcountPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/chickens/headcount");

  return <FlockScreen propertyId={actor.propertyId} actorId={actor.id} />;
}
