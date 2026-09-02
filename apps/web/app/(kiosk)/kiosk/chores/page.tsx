import { redirect } from "next/navigation";

import { ChoresBoardScreen } from "@/app/(kiosk)/kiosk/chores/chores-board-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Today's Chores" };

export default async function KioskChoresPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/kiosk/pair?next=/kiosk/chores");

  return <ChoresBoardScreen propertyId={actor.propertyId} />;
}
