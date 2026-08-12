import { redirect } from "next/navigation";

import { RisksScreen } from "@/app/(admin)/admin/cattle/risks/_components/risks-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Worth a look" };

export default async function AdminCattleRisksPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/cattle/risks");

  return <RisksScreen propertyId={actor.propertyId} />;
}
