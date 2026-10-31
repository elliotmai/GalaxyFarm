import { redirect } from "next/navigation";

import { LandScreen } from "@/app/(admin)/admin/pastures/_components/land-screen";
import type { Ulid } from "@galaxy-farm/core";

import { currentActor } from "@/lib/auth";

export const metadata = { title: "Pastures and water" };

/**
 * Land — zones, the tanks that water them, and pasture care (§5.1, §7).
 *
 * Filed under `/admin/pastures` because that is where §7 puts it. Everything
 * on the farm hangs off a zone, so this is the screen that has to exist before
 * the rest can.
 */
export default async function LandPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/pastures");

  // `?zone=` opens that zone's editor — the property map's way in to the one
  // editor a zone has.
  const { zone } = await searchParams;

  return (
    <LandScreen
      propertyId={actor.propertyId}
      actorId={actor.id}
      initialZoneId={typeof zone === "string" && zone !== "" ? (zone as Ulid) : undefined}
    />
  );
}
