import { redirect } from "next/navigation";

import { SuppliesScreen } from "@/app/(admin)/admin/supplies/_components/supplies-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Supplies" };

export default async function AdminSuppliesPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/supplies");

  return <SuppliesScreen propertyId={actor.propertyId} actorId={actor.id} />;
}
