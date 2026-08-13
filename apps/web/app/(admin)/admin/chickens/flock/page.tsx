import { redirect } from "next/navigation";

import { FlockScreen } from "@/app/(admin)/admin/chickens/flock/_components/flock-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Flocks" };

/**
 * The flock, and the log that says how many birds are in it (§5.4, §7).
 *
 * Filed under `/admin/chickens` because that is where §7 puts it, and named
 * for the flock rather than the bird because §5.4 is explicit that quail is a
 * value in a dropdown and not a second module.
 */
export default async function AdminChickensFlockPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/chickens/flock");

  return <FlockScreen propertyId={actor.propertyId} actorId={actor.id} />;
}
