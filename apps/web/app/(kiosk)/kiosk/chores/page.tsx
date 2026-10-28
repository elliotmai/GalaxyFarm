import { redirect } from "next/navigation";

import { ChoresBoardScreen } from "@/app/(kiosk)/kiosk/chores/chores-board-screen";
import { currentActor } from "@/lib/auth";
import { peopleNames } from "@/lib/people-names";

export const metadata = { title: "Today's Chores" };

export default async function KioskChoresPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/kiosk/pair?next=/kiosk/chores");

  // The names behind the ticks are handed over unawaited: the board streams
  // without them and each "Done by" fills in when they land.
  return <ChoresBoardScreen propertyId={actor.propertyId} names={peopleNames(actor.propertyId)} />;
}
