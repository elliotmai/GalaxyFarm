import { hiveBoardUser, hiveUserMayUseBoard, type HiveBoardUser } from "@/lib/board-store";
import { verifyHivePass } from "@/lib/hive-pass";

/**
 * Signing in to the app with a Hive pass (spec §4.3, "From Hive, as a
 * person").
 *
 * The same pass the board API accepts, and the same people: an owner or
 * member, or a housesitter inside their access window, who could sign in with
 * their password. It becomes an ordinary session, carrying exactly what the
 * password provider's would — id, role, property, access window — so nothing
 * past sign-in can tell the two apart, and signing out works the same.
 * Customers, kiosk accounts and unknown emails get `undefined`, like a wrong
 * password.
 */
export interface HiveSessionUser {
  readonly id: string;
  readonly role: string;
  readonly propertyId: string;
  readonly accessFrom: string | null;
  readonly accessTo: string | null;
}

export async function hiveSignIn(
  pass: string,
  now: Date,
  findUser: (email: string) => Promise<HiveBoardUser | undefined> = hiveBoardUser,
): Promise<HiveSessionUser | undefined> {
  const claims = verifyHivePass(pass, now);
  if (claims === undefined || claims.email === null || !claims.email_verified) return undefined;
  const user = await findUser(claims.email);
  if (user === undefined || !hiveUserMayUseBoard(user, now)) return undefined;
  return {
    id: user.id,
    role: user.role,
    propertyId: user.propertyId,
    accessFrom: user.accessFrom?.toISOString() ?? null,
    accessTo: user.accessTo?.toISOString() ?? null,
  };
}
