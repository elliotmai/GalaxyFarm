import { redirect } from "next/navigation";

import { CalendarBoardScreen } from "@/app/(kiosk)/kiosk/calendar/calendar-board-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Calendar" };

export default async function KioskCalendarPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/kiosk/pair?next=/kiosk/calendar");

  return <CalendarBoardScreen propertyId={actor.propertyId} />;
}
