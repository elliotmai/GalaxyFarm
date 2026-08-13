import { redirect } from "next/navigation";

import { HorseShell } from "@/app/(admin)/admin/horses/_components/horse-shell";
import { currentActor } from "@/lib/auth";

export const metadata = { title: "Horse herd" };

export default async function AdminHorsesHerdPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin/horses/herd");

  return (
    <HorseShell
      title={"Herd"}
      route={"/admin/horses/herd"}
      holds={"Who is here, whose they are, and what each one is like to handle."}
    />
  );
}
