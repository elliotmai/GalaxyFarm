import { redirect } from "next/navigation";

import { HorseCandidatesScreen } from "@/app/(admin)/admin/horses/candidates/_components/horse-candidates-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Horses Under Consideration" };

export default async function AdminHorsesCandidatesPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/horses/candidates");

  return <HorseCandidatesScreen propertyId={actor.propertyId} actorId={actor.id} />;
}
