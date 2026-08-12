import { redirect } from "next/navigation";

import { CattleCandidatesScreen } from "@/app/(admin)/admin/cattle/candidates/_components/candidates-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Purchase candidates" };

export default async function AdminCattleCandidatesPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/cattle/candidates");

  return <CattleCandidatesScreen propertyId={actor.propertyId} actorId={actor.id} />;
}
