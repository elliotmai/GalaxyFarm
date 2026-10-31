import { Suspense } from "react";
import { redirect } from "next/navigation";

import { LogFlow } from "@/app/(admin)/admin/log/_components/log-flow";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Log" };

export default async function AdminLogPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/log");

  // `useSearchParams` reads `?kind=` and `?animals=` — the links in from an
  // animal's page and the Animals list — and Next requires a boundary for it.
  return (
    <Suspense>
      <LogFlow propertyId={actor.propertyId} actorId={actor.id} />
    </Suspense>
  );
}
