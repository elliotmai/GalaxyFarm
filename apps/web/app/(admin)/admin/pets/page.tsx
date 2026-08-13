import { redirect } from "next/navigation";

import { PetsScreen } from "@/app/(admin)/admin/pets/_components/pets-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Pets" };

/**
 * Pets (spec §5.8, §7 `/admin/pets`).
 *
 * The dogs and the cats, on the same `Animal` the herd uses. They are here for
 * their own sake and for the housesitter's: what a pet eats, what medicine it
 * is on, and whether it bites are the three things a helper needs and the
 * three things nobody remembers to write down before leaving.
 */
export default async function AdminPetsPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/pets");

  return <PetsScreen propertyId={actor.propertyId} actorId={actor.id} />;
}
