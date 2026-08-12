import { redirect } from "next/navigation";

import { SalesScreen } from "@/app/(admin)/admin/cattle/sales/_components/sales-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Sales and finance" };

export default async function AdminCattleSalesPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/cattle/sales");

  return <SalesScreen propertyId={actor.propertyId} actorId={actor.id} />;
}
