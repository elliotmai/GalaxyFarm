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
  // Opened by ticking off the egg round: hand back to that screen once logged.
  const from = (await searchParams).from;
  const returnTo = eggReturnBoard(typeof from === "string" ? from : undefined);

  const actor = await currentActor();
  if (actor === undefined) {
    // Inside Hive it is a person, signed in with Hive; anywhere else, a screen.
    redirect(
      returnTo === "hive"
        ? `/login?as=person&next=${encodeURIComponent("/kiosk/eggs?from=hive")}`
        : "/kiosk/pair?next=/kiosk/eggs",
    );
  }

  return <EggsBoardScreen propertyId={actor.propertyId} returnTo={returnTo} />;
}
