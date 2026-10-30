import { Suspense } from "react";
import { redirect } from "next/navigation";

import { ChickensPage } from "@/app/(admin)/admin/animals/_components/species-pages";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Chickens" };

/** `/admin/chickens/flock` — every flock, and every bird kept by name, on the herd page's shape (decision 44). */
export default async function AdminChickensPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/chickens/flock");

  // The filters live in the address (`useSearchParams`), and Next asks for a
  // boundary around anything that reads it.
  return (
    <Suspense>
      <ChickensPage propertyId={actor.propertyId} actorId={actor.id} />
    </Suspense>
  );
}
