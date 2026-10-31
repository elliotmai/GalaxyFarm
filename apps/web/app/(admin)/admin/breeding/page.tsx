import { redirect } from "next/navigation";

import { BreedingWorkspace } from "@/app/(admin)/admin/breeding/_components/breeding-workspace";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Breeding workspace" };

export default async function AdminBreedingPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/breeding");

  return <BreedingWorkspace propertyId={actor.propertyId} actorId={actor.id} />;
}
