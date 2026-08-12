import { redirect } from "next/navigation";

import { AncestorsScreen } from "@/app/(admin)/admin/cattle/ancestors/_components/ancestors-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Ancestors" };

export default async function AdminCattleAncestorsPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/cattle/ancestors");

  return <AncestorsScreen propertyId={actor.propertyId} actorId={actor.id} />;
}
