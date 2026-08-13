import { redirect } from "next/navigation";

import { FleetScreen } from "@/app/(admin)/admin/equipment/_components/fleet-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Equipment" };

export default async function AdminEquipmentPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/equipment");

  return <FleetScreen propertyId={actor.propertyId} actorId={actor.id} />;
}
