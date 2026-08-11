import { Suspense } from "react";
import { redirect } from "next/navigation";

import { CalvingScreen } from "@/app/(admin)/admin/cattle/calving/_components/calving-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Calving" };

export default async function AdminCattleCalvingPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/cattle/calving");

  // `useSearchParams` reads `?dam=` — the two-tap path from her profile and
  // from the calving-watch card — and Next requires a boundary around it.
  return (
    <Suspense>
      <CalvingScreen propertyId={actor.propertyId} actorId={actor.id} />
    </Suspense>
  );
}
