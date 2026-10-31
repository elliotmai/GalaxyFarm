import { Suspense } from "react";
import { redirect } from "next/navigation";

import { CatsPage } from "@/app/(admin)/admin/animals/_components/species-pages";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Cats" };

/** `/admin/pets/cats` — every cat on the place, on the herd page's shape (decision 44). */
export default async function AdminCatsPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/pets/cats");

  // The filters live in the address (`useSearchParams`), and Next asks for a
  // boundary around anything that reads it.
  return (
    <Suspense>
      <CatsPage propertyId={actor.propertyId} actorId={actor.id} />
    </Suspense>
  );
}
