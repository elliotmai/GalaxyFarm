import { redirect } from "next/navigation";

import { CattleSuppliesScreen } from "@/app/(admin)/admin/cattle/supplies/_components/cattle-supplies-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Tank and fridge" };

export default async function AdminCattleSuppliesPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/cattle/supplies");

  return <CattleSuppliesScreen propertyId={actor.propertyId} actorId={actor.id} />;
}
