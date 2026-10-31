import { redirect } from "next/navigation";

import { CatalogScreen } from "@/app/(admin)/admin/cattle/catalog/_components/catalog-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Association catalog" };

export default async function AdminCattleCatalogPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/cattle/catalog");

  // `?text=` is how the global search hands over the words somebody already
  // typed, so the catalog opens on their results rather than an empty box.
  const { text } = await searchParams;
  const initialText = typeof text === "string" ? text : undefined;

  return (
    <CatalogScreen propertyId={actor.propertyId} actorId={actor.id} initialText={initialText} />
  );
}
