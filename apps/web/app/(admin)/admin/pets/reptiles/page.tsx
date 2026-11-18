import { Suspense } from "react";
import { redirect } from "next/navigation";

import { ReptilesPage } from "@/app/(admin)/admin/animals/_components/species-pages";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Reptiles" };

/** `/admin/pets/reptiles` — every reptile in the house, on the herd page's shape (decision 44). */
export default async function AdminReptilesPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/pets/reptiles");

  // The filters live in the address (`useSearchParams`), and Next asks for a
  // boundary around anything that reads it.
  return (
    <Suspense>
      <ReptilesPage propertyId={actor.propertyId} actorId={actor.id} />
    </Suspense>
  );
}
