import { redirect } from "next/navigation";

import { WatchSettingsScreen } from "@/app/(admin)/admin/settings/_components/watch-settings-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Settings" };

export default async function AdminSettingsPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/settings");

  return <WatchSettingsScreen propertyId={actor.propertyId} actorId={actor.id} />;
}
