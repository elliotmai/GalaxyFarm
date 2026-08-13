import { redirect } from "next/navigation";

import { HorseShell } from "@/app/(admin)/admin/horses/_components/horse-shell";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Horse pens" };

export default async function AdminHorsesPensPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/horses/pens");

  return (
    <HorseShell
      title={"Pens"}
      route={"/admin/horses/pens"}
      holds={
        "Which horse is in which trap, and what that pen's safety level becomes with him in it."
      }
    />
  );
}
