import { redirect } from "next/navigation";

import { HorseShell } from "@/app/(admin)/admin/horses/_components/horse-shell";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Horse feeding" };

export default async function AdminHorsesFeedingPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/horses/feeding");

  return (
    <HorseShell
      title={"Feeding"}
      route={"/admin/horses/feeding"}
      holds={"Rations in the units they are fed in, and what a horse costs to keep."}
    />
  );
}
