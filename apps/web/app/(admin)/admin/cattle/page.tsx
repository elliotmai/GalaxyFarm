import { redirect } from "next/navigation";

import { HerdScreen } from "@/app/(admin)/admin/cattle/_components/herd-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Herd" };

export default async function HerdPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/cattle");

  return <HerdScreen propertyId={actor.propertyId} actorId={actor.id} />;
}
