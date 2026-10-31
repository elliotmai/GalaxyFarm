import { redirect } from "next/navigation";

import { HorseScreen } from "@/app/(admin)/admin/horses/[id]/_components/horse-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Horse" };

/**
 * `/admin/horses/<tag or name>` (spec §7, §5.9).
 *
 * Shares its depth with the section's own views — herd, pens, feeding and the
 * rest — and Next serves those fixed folders first. `horseHref` steps a horse
 * whose name is one of those words around them, so this page is reached for
 * every horse and never shadows a view.
 */
export default async function HorsePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await currentActor();
  const { id } = await params;
  if (actor === undefined) redirect(`/login?next=/admin/horses/${id}`);

  return <HorseScreen slug={id} propertyId={actor.propertyId} actorId={actor.id} />;
}
