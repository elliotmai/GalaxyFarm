import { redirect } from "next/navigation";

import { PetsScreen } from "@/app/(admin)/admin/pets/_components/pets-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Cat care" };

/**
 * `/admin/pets/cats/care` — the cats' vet visits, medicine and rations
 * (spec §5.8, decision 46): the cats' own care, in the Cats strip.
 */
export default async function AdminCatCarePage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/pets/cats/care");

  return <PetsScreen propertyId={actor.propertyId} actorId={actor.id} species="cat" />;
}
