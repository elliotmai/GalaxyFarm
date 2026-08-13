import { redirect } from "next/navigation";

import { CatalogueScreen } from "@/app/(admin)/admin/cattle/catalogue/_components/catalogue-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Association catalogue" };

export default async function AdminCattleCataloguePage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/cattle/catalogue");

  return <CatalogueScreen propertyId={actor.propertyId} actorId={actor.id} />;
}
