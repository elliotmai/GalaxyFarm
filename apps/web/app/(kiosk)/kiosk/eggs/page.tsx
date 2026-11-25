import { redirect } from "next/navigation";

import { EggsBoardScreen } from "@/app/(kiosk)/kiosk/eggs/eggs-board-screen";
import { currentActor } from "@/lib/auth";
import { eggReturnBoard } from "@/lib/chores";

export const metadata = { title: "Egg Quick-Entry" };

export default async function KioskEggsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await currentActor();
  if (actor === undefined) redirect("/kiosk/pair?next=/kiosk/eggs");

  // Opened by ticking off the egg round: hand back to that board once logged.
  const from = (await searchParams).from;
  const returnTo = eggReturnBoard(typeof from === "string" ? from : undefined);

  return <EggsBoardScreen propertyId={actor.propertyId} returnTo={returnTo} />;
}
