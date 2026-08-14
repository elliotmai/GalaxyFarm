import { redirect } from "next/navigation";

import { HousesitterBoardScreen } from "@/app/(kiosk)/kiosk/housesitter/housesitter-board-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Housesitter Mode" };

export default async function KioskHousesitterPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/kiosk/housesitter");

  return <HousesitterBoardScreen propertyId={actor.propertyId} />;
}
