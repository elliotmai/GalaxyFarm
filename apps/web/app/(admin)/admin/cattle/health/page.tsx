import { redirect } from "next/navigation";

import { HealthScreen } from "@/app/(admin)/admin/cattle/health/_components/health-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Health" };

export default async function AdminCattleHealthPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/cattle/health");

  return <HealthScreen propertyId={actor.propertyId} actorId={actor.id} />;
}
