import { redirect } from "next/navigation";

import { HorsesScreen } from "@/app/(admin)/admin/horses/_components/horses-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Horses" };

export default async function AdminHorsesPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/horses");

  return <HorsesScreen propertyId={actor.propertyId} />;
}
