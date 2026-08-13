import { redirect } from "next/navigation";

import { EquipmentScreen } from "@/app/(admin)/admin/equipment/[id]/_components/equipment-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Equipment Detail" };

/**
 * One machine (spec §7).
 *
 * The segment is the record's own id rather than a slug: a machine's name is
 * what somebody calls it in the barn — "the gooseneck" — and those get renamed
 * far more casually than a cow does. Resolution happens on the client, because
 * the fleet is already on the device (§4.2).
 */
export default async function AdminEquipmentIdPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await currentActor();
  const { id } = await params;
  if (actor === undefined) redirect(`/login?next=/admin/equipment/${id}`);

  return <EquipmentScreen equipmentId={id} propertyId={actor.propertyId} actorId={actor.id} />;
}
