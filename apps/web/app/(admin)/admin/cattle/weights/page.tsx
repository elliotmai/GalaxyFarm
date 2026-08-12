import { redirect } from "next/navigation";

import { WeightsScreen } from "@/app/(admin)/admin/cattle/weights/_components/weights-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Weights" };

export default async function AdminCattleWeightsPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/cattle/weights");

  return <WeightsScreen propertyId={actor.propertyId} actorId={actor.id} />;
}
