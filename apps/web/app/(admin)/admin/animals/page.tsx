import { Suspense } from "react";
import { redirect } from "next/navigation";

import { AnimalsScreen } from "@/app/(admin)/admin/animals/_components/animals-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Animals" };

/** `/admin/animals` — every animal on the place, every species, one list. */
export default async function AnimalsPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/animals");

  // The filters live in the address (`useSearchParams`), and Next asks for a
  // boundary around anything that reads it.
  return (
    <Suspense>
      <AnimalsScreen propertyId={actor.propertyId} />
    </Suspense>
  );
}
