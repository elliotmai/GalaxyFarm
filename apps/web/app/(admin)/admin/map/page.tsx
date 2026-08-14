import { redirect } from "next/navigation";

import { PropertyMapScreen } from "@/app/(admin)/admin/map/_components/property-map-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Property Map" };

export default async function AdminMapPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/map");

  return <PropertyMapScreen propertyId={actor.propertyId} actorId={actor.id} />;
}
