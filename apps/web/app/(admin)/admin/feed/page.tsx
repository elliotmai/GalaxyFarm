import { redirect } from "next/navigation";

import { FeedScreen } from "@/app/(admin)/admin/feed/_components/feed-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Feed inventory" };

export default async function AdminFeedPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/feed");

  return <FeedScreen propertyId={actor.propertyId} actorId={actor.id} />;
}
