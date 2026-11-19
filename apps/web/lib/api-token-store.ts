import { and, asc, eq, isNull } from "drizzle-orm";

import { encodeUlid, type Ulid } from "@galaxy-farm/core";
import { hashApiToken, mintApiToken } from "@galaxy-farm/infra-auth";
import { apiTokens, type Database } from "@galaxy-farm/infra-db";

import { database } from "@/lib/credential-store";

/**
 * Connected-app tokens, in Postgres (spec §4.3 "Connected apps").
 *
 * The same shape as `device-store.ts`: `api_tokens` never reaches a local
 * store, so this is read on the server and written through owner-only server
 * actions. Nothing here ever hands back `tokenHash`, and the token itself is
 * returned exactly once — by `createApiToken`, to be shown to the owner and
 * pasted into the other app.
 */

export interface ApiToken {
  readonly id: Ulid;
  readonly propertyId: Ulid;
  readonly label: string;
  readonly createdAt: Date;
  readonly createdBy: Ulid;
  readonly lastUsedAt?: Date | undefined;
  readonly revokedAt?: Date | undefined;
  /**
   * Set when the caller is a person signed in to Hive rather than a minted
   * token (see \`lib/hive-pass.ts\`): then \`id\` and \`createdBy\` are that
   * person's user id, and there is no \`api_tokens\` row behind it.
   */
  readonly via?: "hive" | undefined;
}

function tokenFromRow(row: typeof apiTokens.$inferSelect): ApiToken {
  return {
    id: row.id as Ulid,
    propertyId: row.propertyId as Ulid,
    label: row.label,
    createdAt: row.createdAt,
    createdBy: row.createdBy as Ulid,
    ...(row.lastUsedAt === null ? {} : { lastUsedAt: row.lastUsedAt }),
    ...(row.revokedAt === null ? {} : { revokedAt: row.revokedAt }),
  };
}

/**
 * Whose write it is, in the sync audit (§4.2).
 *
 * A kiosk's writes carry its device id; a connected app's carry this, so the
 * audit names the app — and the row behind the id names it in words — rather
 * than borrowing the owner who minted the token.
 */
export function apiTokenDeviceId(token: Pick<ApiToken, "id" | "via">): string {
  return token.via === "hive" ? `hive:${token.id}` : `app:${token.id}`;
}

export async function listApiTokens(
  propertyId: Ulid,
  db: Database = database(),
): Promise<ApiToken[]> {
  const rows = await db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.propertyId, propertyId))
    .orderBy(asc(apiTokens.createdAt));
  return rows.map(tokenFromRow);
}

export async function findApiToken(
  id: Ulid,
  db: Database = database(),
): Promise<ApiToken | undefined> {
  const [row] = await db.select().from(apiTokens).where(eq(apiTokens.id, id)).limit(1);
  return row === undefined ? undefined : tokenFromRow(row);
}

/** Mint a token for one property. The plaintext comes back here and nowhere else. */
export async function createApiToken(
  input: { readonly propertyId: Ulid; readonly label: string; readonly createdBy: Ulid },
  now: Date,
  db: Database = database(),
): Promise<{ readonly apiToken: ApiToken; readonly token: string }> {
  const minted = mintApiToken();
  const [row] = await db
    .insert(apiTokens)
    .values({
      id: encodeUlid(now.getTime()),
      propertyId: input.propertyId,
      label: input.label.trim(),
      tokenHash: minted.tokenHash,
      createdAt: now,
      createdBy: input.createdBy,
    })
    .returning();

  return { apiToken: tokenFromRow(row!), token: minted.token };
}

/**
 * The request path: the live row a bearer token names, or undefined.
 *
 * Looked up by hash — the token is 256 bits of CSPRNG, so the lookup is the
 * check, exactly as `authenticateDevice` does it. A revoked row answers
 * undefined from the very next request; there is no session to outlive it.
 */
export async function authenticateApiToken(
  token: string,
  now: Date,
  db: Database = database(),
): Promise<ApiToken | undefined> {
  if (token === "") return undefined;

  const [row] = await db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.tokenHash, hashApiToken(token)), isNull(apiTokens.revokedAt)))
    .limit(1);
  if (row === undefined) return undefined;

  await db.update(apiTokens).set({ lastUsedAt: now }).where(eq(apiTokens.id, row.id));
  return tokenFromRow({ ...row, lastUsedAt: now });
}

/** Irreversible (§4.5 clause 3): the app is refused from its next request on. */
export async function revokeApiToken(
  id: Ulid,
  now: Date,
  db: Database = database(),
): Promise<void> {
  await db
    .update(apiTokens)
    .set({ revokedAt: now })
    .where(and(eq(apiTokens.id, id), isNull(apiTokens.revokedAt)));
}
