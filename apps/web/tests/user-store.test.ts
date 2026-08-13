import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { fixedClock, type Ulid } from "@galaxy-farm/core";
import { hashPassword, signIn } from "@galaxy-farm/infra-auth";
import { users, type Database } from "@galaxy-farm/infra-db";

import { credentialStore } from "../lib/credential-store.js";
import {
  acceptInvitation,
  findPendingInvitation,
  findUser,
  findUserByEmail,
  inviteUser,
  listDeletedUsers,
  listUsers,
  liveOwnerIds,
  reinviteUser,
  restoreUser,
  tombstoneUser,
  updateUser,
} from "../lib/user-store.js";

/**
 * Inviting somebody, and what happens after (spec §4.3).
 *
 * Against a real Postgres, because every interesting property here is a
 * property of the *statement* rather than of the TypeScript around it: the
 * invitation is single-use because the token hash is in the WHERE clause, the
 * expiry is enforced there too, and a tombstoned account is unreachable
 * because the same clause excludes it. None of that is visible from a unit
 * test with a fake store.
 */

const MIGRATIONS_DIR = join(process.cwd(), "packages/infrastructure/db/migrations");

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const OTHER_PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP2" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;
const NOW = new Date("2026-06-15T12:00:00Z");

let client: PGlite;
let db: Database;

beforeAll(async () => {
  client = new PGlite();
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    for (const statement of readFileSync(join(MIGRATIONS_DIR, file), "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s !== "")) {
      await client.exec(statement);
    }
  }
  db = drizzle(client) as unknown as Database;
}, 60_000);

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await client.exec("truncate table users");
});

const invite = (overrides: Partial<Parameters<typeof inviteUser>[0]> = {}) =>
  inviteUser(
    { propertyId: PROPERTY, email: "sam@example.com", name: "Sam", role: "member", ...overrides },
    NOW,
    db,
  );

describe("inviting", () => {
  it("creates an account with no password and one live link", async () => {
    const { user, token } = await invite();

    expect(token).not.toBe("");
    expect(user.name).toBe("Sam");
    expect(user.inviteExpiresAt).toBeDefined();

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row?.passwordHash).toBeNull();
    // The token is not in the row. This is the assertion that matters most:
    // a stored token turns a leaked backup into a way in.
    expect(row?.inviteTokenHash).not.toBe(token);
    expect(row?.inviteTokenHash).not.toBeNull();
  });

  it("shows as invited, not as active, and cannot sign in", async () => {
    const { user } = await invite();

    const found = await findUser(user.id, NOW, db);
    expect(found?.state).toBe("invited");

    const attempt = await signIn(
      credentialStore(db),
      { email: "sam@example.com", password: "anything-at-all" },
      fixedClock(NOW),
    );
    expect(attempt.ok).toBe(false);
  });

  it("lowercases and trims the address, so one person is one account", async () => {
    await invite({ email: "  Sam@Example.COM  " });

    expect(await findUserByEmail("sam@example.com", db)).toBeDefined();
  });

  it("never hands back a hash of any kind", async () => {
    const { user } = await invite();
    const [listed] = await listUsers(PROPERTY, NOW, db);

    for (const record of [user, listed?.user]) {
      expect(Object.keys(record ?? {})).not.toContain("passwordHash");
      expect(Object.keys(record ?? {})).not.toContain("inviteTokenHash");
    }
  });
});

describe("accepting", () => {
  it("sets the password and lets them sign in", async () => {
    const { user, token } = await invite();

    const pending = await findPendingInvitation(token, NOW, db);
    expect(pending?.name).toBe("Sam");

    const accepted = await acceptInvitation(
      token,
      await hashPassword("a-long-enough-phrase"),
      NOW,
      db,
    );
    expect(accepted).toBe(true);

    expect((await findUser(user.id, NOW, db))?.state).toBe("active");

    const attempt = await signIn(
      credentialStore(db),
      { email: "sam@example.com", password: "a-long-enough-phrase" },
      fixedClock(NOW),
    );
    expect(attempt.ok).toBe(true);
  });

  it("works exactly once", async () => {
    // The token hash is in the WHERE clause, so the second update matches
    // nothing rather than racing the first.
    const { token } = await invite();
    const hash = await hashPassword("a-long-enough-phrase");

    expect(await acceptInvitation(token, hash, NOW, db)).toBe(true);
    expect(await acceptInvitation(token, hash, NOW, db)).toBe(false);
    expect(await findPendingInvitation(token, NOW, db)).toBeUndefined();
  });

  it("refuses a link whose week is up", async () => {
    const { token } = await invite();
    const late = new Date("2026-07-15T12:00:00Z");

    expect(await findPendingInvitation(token, late, db)).toBeUndefined();
    // Checked in the statement too, so the page's own check cannot go stale
    // between rendering and submitting.
    expect(
      await acceptInvitation(token, await hashPassword("a-long-enough-phrase"), late, db),
    ).toBe(false);
  });

  it("refuses a link belonging to a deleted account", async () => {
    const { user, token } = await invite();
    await tombstoneUser(user.id, ACTOR, NOW, "left", db);

    expect(await findPendingInvitation(token, NOW, db)).toBeUndefined();
    expect(await acceptInvitation(token, await hashPassword("a-long-enough-phrase"), NOW, db)).toBe(
      false,
    );
  });

  it("refuses a link belonging to a switched-off account", async () => {
    const { user, token } = await invite();
    await updateUser(user.id, { active: false }, NOW, db);

    expect(await findPendingInvitation(token, NOW, db)).toBeUndefined();
    expect(await acceptInvitation(token, await hashPassword("a-long-enough-phrase"), NOW, db)).toBe(
      false,
    );
  });

  it("refuses a token nobody minted", async () => {
    await invite();

    expect(await findPendingInvitation("not-a-real-token", NOW, db)).toBeUndefined();
  });
});

describe("re-inviting", () => {
  it("kills the old link and takes the password with it", async () => {
    // The password-reset path: the account goes back to having none rather
    // than keeping one nobody knows.
    const { user, token } = await invite();
    await acceptInvitation(token, await hashPassword("a-long-enough-phrase"), NOW, db);

    const fresh = await reinviteUser(user.id, NOW, db);

    expect(fresh).not.toBe(token);
    expect(await findPendingInvitation(token, NOW, db)).toBeUndefined();
    expect(await findPendingInvitation(fresh, NOW, db)).toBeDefined();
    expect((await findUser(user.id, NOW, db))?.state).toBe("invited");

    const attempt = await signIn(
      credentialStore(db),
      { email: "sam@example.com", password: "a-long-enough-phrase" },
      fixedClock(NOW),
    );
    expect(attempt.ok).toBe(false);
  });
});

describe("deleting and restoring", () => {
  it("writes a tombstone rather than removing the row", async () => {
    const { user } = await invite();
    await tombstoneUser(user.id, ACTOR, NOW, "moved away", db);

    expect(await listUsers(PROPERTY, NOW, db)).toEqual([]);
    expect((await listDeletedUsers(PROPERTY, NOW, db)).map((row) => row.user.id)).toEqual([
      user.id,
    ]);
  });

  it("takes the invitation with it, so a deleted account cannot be claimed", async () => {
    const { user, token } = await invite();
    await tombstoneUser(user.id, ACTOR, NOW, undefined, db);
    await restoreUser(user.id, NOW, db);

    // Restored, but the old link stays dead — somebody who kept it must not be
    // able to walk back in.
    expect(await findPendingInvitation(token, NOW, db)).toBeUndefined();
    expect((await findUser(user.id, NOW, db))?.state).toBe("invitation-expired");
  });

  it("brings a signed-up account back as it was", async () => {
    const { user, token } = await invite();
    await acceptInvitation(token, await hashPassword("a-long-enough-phrase"), NOW, db);
    await tombstoneUser(user.id, ACTOR, NOW, undefined, db);
    await restoreUser(user.id, NOW, db);

    expect((await findUser(user.id, NOW, db))?.state).toBe("active");
  });
});

describe("who is left to manage people", () => {
  const owner = (email: string) => invite({ email, role: "owner" });

  it("counts only owners who can actually sign in", async () => {
    const invited = await owner("invited@example.com");
    const signedUp = await owner("in@example.com");
    await acceptInvitation(signedUp.token, await hashPassword("a-long-enough-phrase"), NOW, db);

    const live = await liveOwnerIds(PROPERTY, NOW, db);

    // The invited one cannot sign in, so it cannot be the reason a demotion
    // is allowed to go through.
    expect(live).toEqual([signedUp.user.id]);
    expect(live).not.toContain(invited.user.id);
  });

  it("drops an owner who is switched off or deleted", async () => {
    const off = await owner("off@example.com");
    const gone = await owner("gone@example.com");
    for (const entry of [off, gone]) {
      await acceptInvitation(entry.token, await hashPassword("a-long-enough-phrase"), NOW, db);
    }
    await updateUser(off.user.id, { active: false }, NOW, db);
    await tombstoneUser(gone.user.id, ACTOR, NOW, undefined, db);

    expect(await liveOwnerIds(PROPERTY, NOW, db)).toEqual([]);
  });

  it("does not count another property's owners", async () => {
    const mine = await owner("mine@example.com");
    const theirs = await invite({
      propertyId: OTHER_PROPERTY,
      email: "theirs@example.com",
      role: "owner",
    });
    for (const entry of [mine, theirs]) {
      await acceptInvitation(entry.token, await hashPassword("a-long-enough-phrase"), NOW, db);
    }

    expect(await liveOwnerIds(PROPERTY, NOW, db)).toEqual([mine.user.id]);
    expect((await listUsers(PROPERTY, NOW, db)).map((row) => row.user.email)).toEqual([
      "mine@example.com",
    ]);
  });
});

describe("editing", () => {
  it("clears a window when somebody stops being a housesitter", async () => {
    const { user } = await invite({
      role: "housesitter",
      accessFrom: new Date("2026-06-20T00:00:00Z"),
      accessTo: new Date("2026-06-27T00:00:00Z"),
    });

    await updateUser(user.id, { role: "member", accessFrom: null, accessTo: null }, NOW, db);

    const found = await findUser(user.id, NOW, db);
    expect(found?.user.role).toBe("member");
    expect(found?.user.accessFrom).toBeUndefined();
    expect(found?.user.accessTo).toBeUndefined();
  });

  it("leaves a field alone when the edit does not mention it", async () => {
    const { user } = await invite();
    await updateUser(user.id, { name: "Samantha" }, NOW, db);

    const found = await findUser(user.id, NOW, db);
    expect(found?.user.name).toBe("Samantha");
    expect(found?.user.role).toBe("member");
  });
});
