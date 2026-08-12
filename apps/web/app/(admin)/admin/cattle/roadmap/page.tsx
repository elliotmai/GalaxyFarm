import { redirect } from "next/navigation";

import { CattleRoadmapScreen } from "@/app/(admin)/admin/cattle/roadmap/_components/cattle-roadmap-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Genetic roadmap" };

export default async function AdminCattleRoadmapPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/cattle/roadmap");

  return <CattleRoadmapScreen propertyId={actor.propertyId} actorId={actor.id} />;
}
