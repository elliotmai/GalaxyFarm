import { Suspense } from "react";
import { redirect } from "next/navigation";

import { EquipmentCandidatesScreen } from "@/app/(admin)/admin/equipment/candidates/_components/equipment-candidates-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Equipment Candidates" };

export default async function AdminEquipmentCandidatesPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/equipment/candidates");

  // `useSearchParams` reads `?item=` — the one-tap path from a roadmap card to
  // the machines being weighed against it — and Next requires a boundary
  // around it.
  return (
    <Suspense>
      <EquipmentCandidatesScreen propertyId={actor.propertyId} actorId={actor.id} />
    </Suspense>
  );
}
