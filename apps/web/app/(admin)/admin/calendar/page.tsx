import { redirect } from "next/navigation";

import { CalendarScreen } from "@/app/(admin)/admin/calendar/_components/calendar-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Calendar" };

/**
 * The unified calendar (spec §6, §7).
 *
 * The server component establishes who is asking and nothing else. Every row
 * on the screen — the projected ones and the handful somebody typed — is
 * derived on the device from records already in its store, so the month draws
 * before the barn has found a bar of signal (§4.2).
 */
export default async function AdminCalendarPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/calendar");

  return <CalendarScreen propertyId={actor.propertyId} actorId={actor.id} />;
}
