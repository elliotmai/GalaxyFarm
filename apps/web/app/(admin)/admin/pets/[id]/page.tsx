import { redirect } from "next/navigation";

import { PetScreen } from "@/app/(admin)/admin/pets/[id]/_components/pet-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Pet" };

/**
 * `/admin/pets/<name or tag>` (spec §7, §5.8).
 *
 * The segment is a slug, as on a cow's page — see `lib/animal-slug.ts` and
 * `petHref` — and it resolves on the client, because the household lives in
 * the device's store (§4.2) and a sitter opening the dog's page in the kitchen
 * should not wait on a server to say what he eats.
 */
export default async function PetPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await currentActor();
  const { id } = await params;
  if (actor === undefined) redirect(`/login?next=/admin/pets/${id}`);

  return <PetScreen slug={id} propertyId={actor.propertyId} actorId={actor.id} />;
}
