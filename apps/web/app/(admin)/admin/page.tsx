import { redirect } from "next/navigation";

import type { Ulid } from "@galaxy-farm/core";

import { Dashboard } from "@/app/(admin)/admin/_components/dashboard";
import type { PeopleNames } from "@/app/(admin)/admin/_components/chores-card";
import { currentActor } from "@/lib/auth";
import { withDeadline } from "@/lib/deadline";
import { listDevices } from "@/lib/device-store";
import { listUsers } from "@/lib/user-store";

export const metadata = { title: "Today" };

/**
 * Who a chore's `completedBy` names, by id.
 *
 * People by first name — the two who run the place, and a sitter — and barn
 * screens by their own name, because a kiosk tick is attributed to the
 * device rather than to whoever was standing at it. Names only: nothing else
 * about an account leaves the server, and the users table never reaches a
 * device (§4.3).
 *
 * Never rejects. A database that cannot be reached costs the names and
 * nothing else; every ticked row still says when.
 */
async function peopleNames(propertyId: Ulid): Promise<PeopleNames> {
  try {
    const [people, screens] = await withDeadline(
      Promise.all([listUsers(propertyId, new Date()), listDevices(propertyId)]),
      "the names behind the ticks",
    );
    return Object.fromEntries([
      ...screens.map((screen) => [screen.id, screen.name] as const),
      ...people.map(
        (person) => [person.user.id, person.user.name.split(" ")[0] ?? person.user.name] as const,
      ),
    ]);
  } catch (error) {
    console.error("[today:names]", error);
    return {};
  }
}

/**
 * The admin home.
 *
 * The server component's job is to establish who is asking; everything shown
 * is read from the device's own store by the client component below. That is
 * what makes this page render at the same speed with no signal as with five
 * bars (§4.2).
 *
 * The one exception is the names behind the ticks, which live only on the
 * server. They are handed over as a promise, not awaited: the page streams
 * without them and each "Done by" fills in when they land.
 */
export default async function AdminHomePage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin");

  return (
    <Dashboard
      propertyId={actor.propertyId}
      actorId={actor.id}
      names={peopleNames(actor.propertyId)}
    />
  );
}
