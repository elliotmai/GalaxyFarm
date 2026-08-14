import { redirect } from "next/navigation";

import { EggsBoardScreen } from "@/app/(kiosk)/kiosk/eggs/eggs-board-screen";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Egg Quick-Entry" };

export default async function KioskEggsPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/kiosk/eggs");

  return <EggsBoardScreen propertyId={actor.propertyId} />;
}
