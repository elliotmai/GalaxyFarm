import { and, eq, isNull } from "drizzle-orm";

import type { Role, User } from "@galaxy-farm/core";
import { createDatabase, users, type Database } from "@galaxy-farm/infra-db";
import type { CredentialStore, StoredCredential } from "@galaxy-farm/infra-auth";

/**
 * The composition root's half of sign-in (spec §4.1).
 *
 * `@galaxy-farm/infra-auth` owns the credential logic and knows nothing about
 * Postgres; `@galaxy-farm/infra-db` owns Postgres and knows nothing about
 * passwords. §4.1 forbids one adapter importing another, so the two are joined
 * here, in the app — which is also the only place that reads the environment.
 */

let cached: Database | undefined;

/**
 * One connection per process, reused across invocations.
 *
 * A serverless function that opens a pool per request exhausts Neon's
 * connection allowance long before the farm runs out of animals.
 */
export function database(): Database {
  const url = process.env["DATABASE_URL"];
  if (url === undefined || url === "") {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  }
  if (cached === undefined) cached = createDatabase(url).db;
  return cached;
}

/**
 * Row to entity.
 *
 * Both secrets are dropped here rather than further up: `userFromRow` is what
 * every screen and every action reads, and the one place that keeps a hash is
 * this file's own `StoredCredential`, which never leaves the sign-in path.
 */
export function userFromRow(row: typeof users.$inferSelect): User {
  return {
    id: row.id as User["id"],
    propertyId: row.propertyId as User["propertyId"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    email: row.email,
    name: row.name,
    role: row.role as Role,
    active: row.active,
    ...(row.deletedAt === null ? {} : { deletedAt: row.deletedAt }),
    ...(row.accessFrom === null ? {} : { accessFrom: row.accessFrom }),
    ...(row.accessTo === null ? {} : { accessTo: row.accessTo }),
    ...(row.contactId === null ? {} : { contactId: row.contactId as User["contactId"] }),
    ...(row.lastSignedInAt === null ? {} : { lastSignedInAt: row.lastSignedInAt }),
    ...(row.inviteExpiresAt === null ? {} : { inviteExpiresAt: row.inviteExpiresAt }),
  };
}

/** The password hash is handed back separately, never on the User. */
function toCredential(row: typeof users.$inferSelect): StoredCredential {
  return {
    user: userFromRow(row),
    ...(row.passwordHash === null ? {} : { passwordHash: row.passwordHash }),
  };
}

export function credentialStore(db: Database = database()): CredentialStore {
  return {
    async findByEmail(email) {
      const rows = await db
        .select()
        .from(users)
        // Tombstoned users are excluded here as well as in `signIn`, so a
        // deleted account cannot be reached even if that check is ever moved.
        .where(and(eq(users.email, email), isNull(users.deletedAt)))
        .limit(1);

      const row = rows[0];
      return row === undefined ? undefined : toCredential(row);
    },

    async updatePasswordHash(userId, hash, at) {
      // This one *is* an edit: the stored hash genuinely changed.
      await db.update(users).set({ passwordHash: hash, updatedAt: at }).where(eq(users.id, userId));
    },

    async recordSignIn(userId, at) {
      // Deliberately not touching `updatedAt`: signing in is not an edit to
      // the record, and bumping it would push a no-op down every device's
      // pull cursor.
      await db.update(users).set({ lastSignedInAt: at }).where(eq(users.id, userId));
    },
  };
}
