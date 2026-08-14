import { redirect } from "next/navigation";

import { CatalogScreen } from "@/app/(admin)/admin/cattle/catalog/_components/catalog-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Association catalog" };

export default async function AdminCattleCatalogPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/cattle/catalog");

  return <CatalogScreen propertyId={actor.propertyId} actorId={actor.id} />;
}
