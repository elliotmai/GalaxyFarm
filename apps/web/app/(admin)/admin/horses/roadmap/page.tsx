import { redirect } from "next/navigation";

import { HorseRoadmapScreen } from "@/app/(admin)/admin/horses/roadmap/_components/horse-roadmap-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Horse roadmap" };

export default async function AdminHorsesRoadmapPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/horses/roadmap");

  return <HorseRoadmapScreen propertyId={actor.propertyId} actorId={actor.id} />;
}
