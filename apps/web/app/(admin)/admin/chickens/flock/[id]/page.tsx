import { redirect } from "next/navigation";

import { FlockRecordScreen } from "@/app/(admin)/admin/chickens/flock/[id]/_components/flock-record";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Flock" };

/**
 * `/admin/chickens/flock/<name>` (spec §7) — one flock's own page.
 *
 * The segment is the flock's name as a slug, falling back to its id — see
 * `lib/flock-slug.ts`. Resolved on the client, as a cow's page is, because the
 * flocks live in the device's store (§4.2) and the page works with no signal.
 */
export default async function FlockPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await currentActor();
  const { id } = await params;
  if (actor === undefined) redirect(`/login?next=/admin/chickens/flock/${id}`);

  return <FlockRecordScreen slug={id} propertyId={actor.propertyId} actorId={actor.id} />;
}
