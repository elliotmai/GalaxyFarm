import { redirect } from "next/navigation";

import { HorseShell } from "@/app/(admin)/admin/horses/_components/horse-shell";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Horse breeding" };

export default async function AdminHorsesBreedingPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/horses/breeding");

  return (
    <HorseShell
      title={"Breeding"}
      route={"/admin/horses/breeding"}
      holds={"Covers, foaling dates, and what a cross was for."}
    />
  );
}
