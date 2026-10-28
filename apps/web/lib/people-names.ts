import type { Ulid } from "@galaxy-farm/core";

import { withDeadline } from "@/lib/deadline";
import { listDevices } from "@/lib/device-store";
import { listUsers } from "@/lib/user-store";

/**
 * Who a completion is attributed to, by id — people and barn screens both,
 * because a kiosk tick is written as the screen rather than as whoever was
 * standing at it.
 */
export type PeopleNames = Readonly<Record<string, string>>;

/**
 * The names behind the ticks, for the boards and the sitter's checklist.
 *
 * The same answer the admin Today screen builds for its "Done by" lines:
 * people by first name, screens by their own name, and nothing else about an
 * account — the users table never reaches a device (§4.3). Handed to the page
 * as a promise so the board streams without it and each line fills in when it
 * lands.
 *
 * Never rejects. A database that cannot be reached costs the names and
 * nothing else; every ticked row still says when.
 */
export async function peopleNames(propertyId: Ulid): Promise<PeopleNames> {
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
    console.error("[names]", error);
    return {};
  }
}
