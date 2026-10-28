import { redirect } from "next/navigation";

import { FeedScreen, type FeedView } from "@/app/(admin)/admin/feed/_components/feed-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Feed" };

const VIEWS: readonly FeedView[] = ["today", "plan", "shed"];

export default async function AdminFeedPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/feed");

  // `?view=plan` is how Cattle › Feed plans links straight to the plans.
  const { view } = await searchParams;
  const initialView = VIEWS.find((candidate) => candidate === view);

  return <FeedScreen propertyId={actor.propertyId} actorId={actor.id} initialView={initialView} />;
}
