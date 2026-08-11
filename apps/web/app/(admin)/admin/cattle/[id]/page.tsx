import { redirect } from "next/navigation";

import { AnimalScreen } from "@/app/(admin)/admin/cattle/[id]/_components/animal-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Animal" };

/**
 * `/admin/cattle/<tag or registration or name>` (spec §7).
 *
 * The segment is a slug rather than an id — see `lib/animal-slug.ts` — so the
 * URL says which cow it is. Resolution happens on the client because the herd
 * lives in the device's store (§4.2) and the server has no business waiting on
 * a database to render a page that is already available locally.
 */
export default async function AnimalPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await currentActor();
  const { id } = await params;
  if (actor === undefined) redirect(`/login?next=/admin/cattle/${id}`);

  return <AnimalScreen slug={id} propertyId={actor.propertyId} actorId={actor.id} />;
}
