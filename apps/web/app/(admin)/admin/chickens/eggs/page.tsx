import { redirect } from "next/navigation";

import { EggsScreen } from "@/app/(admin)/admin/chickens/eggs/_components/eggs-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Eggs" };

/**
 * Egg logs and what they add up to (§5.4, §7 — "logs + trends").
 *
 * The collection form is the fast one §8 asks for: a row of +1 buttons and a
 * date that is already today. Everything else on the screen is derived from
 * what those buttons write.
 */
export default async function AdminChickensEggsPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/chickens/eggs");

  return <EggsScreen propertyId={actor.propertyId} actorId={actor.id} />;
}
