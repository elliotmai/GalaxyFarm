import { Suspense } from "react";
import { redirect } from "next/navigation";

import { DogsPage } from "@/app/(admin)/admin/animals/_components/species-pages";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Dogs" };

/** `/admin/pets/dogs` — every dog on the place, on the herd page's shape (decision 44). */
export default async function AdminDogsPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/pets/dogs");

  // The filters live in the address (`useSearchParams`), and Next asks for a
  // boundary around anything that reads it.
  return (
    <Suspense>
      <DogsPage propertyId={actor.propertyId} actorId={actor.id} />
    </Suspense>
  );
}
