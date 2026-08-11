import { redirect } from "next/navigation";

import { BreedingScreen } from "@/app/(admin)/admin/cattle/breeding/_components/breeding-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Breeding" };

export default async function AdminCattleBreedingPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/cattle/breeding");

  return <BreedingScreen propertyId={actor.propertyId} actorId={actor.id} />;
}
