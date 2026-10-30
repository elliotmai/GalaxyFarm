import { Suspense } from "react";
import { redirect } from "next/navigation";

import { HorsesPage } from "@/app/(admin)/admin/animals/_components/species-pages";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Horses" };

/** `/admin/horses` — every horse on the place, on the herd page's shape (decision 44). */
export default async function AdminHorsesPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/horses");

  // The filters live in the address (`useSearchParams`), and Next asks for a
  // boundary around anything that reads it.
  return (
    <Suspense>
      <HorsesPage propertyId={actor.propertyId} actorId={actor.id} />
    </Suspense>
  );
}
