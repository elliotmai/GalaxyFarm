import { redirect } from "next/navigation";

import { ReportsScreen } from "@/app/(admin)/admin/reports/_components/reports-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Reports" };

/**
 * Reports (spec §6, §7 `/admin/reports`).
 *
 * Every figure here is recomputed from the records behind it — §4.5's first
 * exception, a read model rather than a stored total. Correcting a treatment's
 * cost moves the animal's number the next time this page is looked at, with
 * nothing to regenerate.
 */
export default async function AdminReportsPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/reports");

  return <ReportsScreen propertyId={actor.propertyId} />;
}
