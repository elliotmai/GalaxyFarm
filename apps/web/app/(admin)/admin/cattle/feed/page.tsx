import { redirect } from "next/navigation";

import { CattleFeedScreen } from "@/app/(admin)/admin/cattle/feed/_components/cattle-feed-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Feed plans" };

export default async function AdminCattleFeedPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/cattle/feed");

  return <CattleFeedScreen propertyId={actor.propertyId} actorId={actor.id} />;
}
