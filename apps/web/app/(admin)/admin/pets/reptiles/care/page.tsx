import { redirect } from "next/navigation";

import { PetsScreen } from "@/app/(admin)/admin/pets/_components/pets-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Reptile care" };

/**
 * `/admin/pets/reptiles/care` — the reptiles' vet visits, medicine and feeding
 * (spec §5.8, decision 46): their own care, in the Reptiles strip.
 */
export default async function AdminReptileCarePage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/pets/reptiles/care");

  return <PetsScreen propertyId={actor.propertyId} actorId={actor.id} species="reptile" />;
}
