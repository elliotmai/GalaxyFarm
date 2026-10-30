import { redirect } from "next/navigation";

import { PetsScreen } from "@/app/(admin)/admin/pets/_components/pets-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Dog care" };

/**
 * `/admin/pets/dogs/care` — the dogs' vet visits, medicine and rations
 * (spec §5.8, decision 46): the dogs' own care, in the Dogs strip.
 */
export default async function AdminDogCarePage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/pets/dogs/care");

  return <PetsScreen propertyId={actor.propertyId} actorId={actor.id} species="dog" />;
}
