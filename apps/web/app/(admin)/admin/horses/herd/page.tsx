import { redirect } from "next/navigation";

import { HerdScreen } from "@/app/(admin)/admin/horses/_components/herd-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Horse herd" };

/**
 * `/admin/horses/herd` (spec §5.9, §7): who is here, and the way into each
 * horse's own page.
 */
export default async function AdminHorsesHerdPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/horses/herd");

  return <HerdScreen propertyId={actor.propertyId} actorId={actor.id} />;
}
