import { redirect } from "next/navigation";

import { HousesitterBoardScreen } from "@/app/(kiosk)/kiosk/housesitter/housesitter-board-screen";
import { currentActor } from "@/lib/auth";
import { peopleNames } from "@/lib/people-names";

export const metadata = { title: "Housesitter Mode" };

export default async function KioskHousesitterPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/kiosk/pair?next=/kiosk/housesitter");

  return (
    <HousesitterBoardScreen propertyId={actor.propertyId} names={peopleNames(actor.propertyId)} />
  );
}
