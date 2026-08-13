import { redirect } from "next/navigation";

import { EquipmentRoadmapScreen } from "@/app/(admin)/admin/equipment/roadmap/_components/equipment-roadmap-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Equipment Roadmap" };

export default async function AdminEquipmentRoadmapPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/equipment/roadmap");

  return <EquipmentRoadmapScreen propertyId={actor.propertyId} actorId={actor.id} />;
}
