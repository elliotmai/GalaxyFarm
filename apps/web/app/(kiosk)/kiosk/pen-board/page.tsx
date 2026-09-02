import { redirect } from "next/navigation";

import { PenBoardScreen } from "@/app/(kiosk)/kiosk/pen-board/pen-board-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Pen Board" };

export default async function KioskPenBoardPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/kiosk/pair?next=/kiosk/pen-board");

  return <PenBoardScreen propertyId={actor.propertyId} />;
}
