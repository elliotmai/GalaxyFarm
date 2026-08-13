import { redirect } from "next/navigation";

import { ChoresScreen } from "@/app/(admin)/admin/chores/_components/chores-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Chores" };

/**
 * Chores — templates and today (§7).
 *
 * The server component establishes who is asking and nothing else; the day
 * itself is derived on the device from the templates and tasks already there,
 * so the list is on screen before the barn has found a bar of signal (§4.2).
 */
export default async function AdminChoresPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/chores");

  return <ChoresScreen propertyId={actor.propertyId} actorId={actor.id} />;
}
