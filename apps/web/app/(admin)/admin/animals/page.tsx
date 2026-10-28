import { redirect } from "next/navigation";

import { AnimalsScreen } from "@/app/(admin)/admin/animals/_components/animals-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Animals" };

/** `/admin/animals` — every animal on the place, every species, one list. */
export default async function AnimalsPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/animals");

  return <AnimalsScreen propertyId={actor.propertyId} />;
}
