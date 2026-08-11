import { redirect } from "next/navigation";

import { Dashboard } from "@/app/(admin)/admin/_components/dashboard";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Today" };

/**
 * The admin home.
 *
 * The server component's only job is to establish who is asking; everything
 * shown is read from the device's own store by the client component below.
 * That is what makes this page render at the same speed with no signal as with
 * five bars (§4.2).
 */
export default async function AdminHomePage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin");

  return <Dashboard propertyId={actor.propertyId} />;
}
