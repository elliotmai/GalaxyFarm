import { redirect } from "next/navigation";

import { ContactsScreen } from "@/app/(admin)/admin/contacts/_components/contacts-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Contacts" };

/**
 * The CRM (spec §5.1, §7 `/admin/contacts`).
 *
 * One list for everyone the farm touches, because the hauler is often also the
 * neighbour who buys a steer — and three tables would lose that the moment
 * somebody was entered twice.
 */
export default async function AdminContactsPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/contacts");

  return <ContactsScreen propertyId={actor.propertyId} actorId={actor.id} />;
}
