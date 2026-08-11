import { describe, expect, it, vi } from "vitest";

import { fixedClock, type Ulid, type User } from "@galaxy-farm/core";

import { hashPassword } from "../src/password.js";
import { signIn, type CredentialStore, type StoredCredential } from "../src/sign-in.js";

/**
 * Signing in.
 *
 * The property under test throughout is that **failures are
 * indistinguishable**. A form that answers faster or differently for an
 * address it has never seen is a way to ask whether someone has an account
 * here, and for a boarding business that is a customer list.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const USER = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;
const NOW = new Date("2026-11-15T12:00:00Z");
const clock = fixedClock(NOW);

const user = (overrides: Partial<User> = {}): User => ({
  id: USER,
  propertyId: PROPERTY,
  createdAt: NOW,
  updatedAt: NOW,
  email: "eli@example.com",
  name: "Eli",
  role: "owner",
  active: true,
  ...overrides,
});

async function store(credential?: StoredCredential): Promise<CredentialStore> {
  return {
    findByEmail: async (email) =>
      credential !== undefined && credential.user.email === email ? credential : undefined,
  };
}

async function credential(overrides: Partial<User> = {}, password = "hunter2") {
  return { user: user(overrides), passwordHash: await hashPassword(password) };
}

describe("signIn", () => {
  it("lets the right password through", async () => {
    const result = await signIn(
      await store(await credential()),
      {
        email: "eli@example.com",
        password: "hunter2",
      },
      clock,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.actor.role).toBe("owner");
      expect(result.actor.propertyId).toBe(PROPERTY);
    }
  }, 20_000);

  it("is case- and whitespace-forgiving about the address", async () => {
    // Somebody's phone will capitalise the first letter. That is not a
    // different account.
    const result = await signIn(
      await store(await credential()),
      {
        email: "  Eli@Example.com  ",
        password: "hunter2",
      },
      clock,
    );

    expect(result.ok).toBe(true);
  }, 20_000);

  it("gives the same answer for a wrong password and an unknown address", async () => {
    // The whole point. Two different messages here is an account enumerator.
    const known = await signIn(
      await store(await credential()),
      {
        email: "eli@example.com",
        password: "wrong",
      },
      clock,
    );
    const unknown = await signIn(
      await store(await credential()),
      {
        email: "nobody@example.com",
        password: "hunter2",
      },
      clock,
    );

    expect(known).toEqual({ ok: false, failure: { kind: "invalid-credentials" } });
    expect(unknown).toEqual({ ok: false, failure: { kind: "invalid-credentials" } });
  }, 30_000);

  it("does the hashing work even when there is no such user", async () => {
    // Returning early would skip ~100ms of scrypt, and that difference is
    // measurable over the network.
    const empty = await store();
    const started = process.hrtime.bigint();
    await signIn(empty, { email: "nobody@example.com", password: "hunter2" }, clock);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;

    expect(elapsedMs).toBeGreaterThan(10);
  }, 20_000);

  it("refuses a deactivated account as though the password were wrong", async () => {
    // Saying "that account is deactivated" to someone who has not proved they
    // own it confirms the account exists.
    const result = await signIn(
      await store(await credential({ active: false })),
      { email: "eli@example.com", password: "hunter2" },
      clock,
    );

    expect(result).toEqual({ ok: false, failure: { kind: "invalid-credentials" } });
  }, 20_000);

  it("refuses a soft-deleted account the same way", async () => {
    const result = await signIn(
      await store(await credential({ deletedAt: NOW, deletedBy: USER })),
      { email: "eli@example.com", password: "hunter2" },
      clock,
    );

    expect(result).toEqual({ ok: false, failure: { kind: "invalid-credentials" } });
  }, 20_000);

  it("tells a housesitter when their week is over", async () => {
    // The one failure worth naming. The password was right, so nothing is
    // leaked, and it is the only message they can act on.
    const result = await signIn(
      await store(
        await credential({
          role: "housesitter",
          accessFrom: new Date("2026-11-01T00:00:00Z"),
          accessTo: new Date("2026-11-08T00:00:00Z"),
        }),
      ),
      { email: "eli@example.com", password: "hunter2" },
      clock,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("outside-access-window");
    }
  }, 20_000);

  it("lets a housesitter in during their week", async () => {
    const result = await signIn(
      await store(
        await credential({
          role: "housesitter",
          accessFrom: new Date("2026-11-10T00:00:00Z"),
          accessTo: new Date("2026-11-20T00:00:00Z"),
        }),
      ),
      { email: "eli@example.com", password: "hunter2" },
      clock,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.actor.accessWindow?.to).toEqual(new Date("2026-11-20T00:00:00Z"));
    }
  }, 20_000);

  it("upgrades a hash made with weaker parameters, at the one moment it can", async () => {
    // Sign-in is the only time the plaintext exists. Raising the cost later
    // should not cost anyone a password reset.
    const weak = await hashPassword("hunter2", { N: 1_024, r: 8, p: 1, keyLength: 64 });
    const updatePasswordHash = vi.fn();

    await signIn(
      {
        findByEmail: async () => ({ user: user(), passwordHash: weak }),
        updatePasswordHash,
      },
      { email: "eli@example.com", password: "hunter2" },
      clock,
    );

    expect(updatePasswordHash).toHaveBeenCalledOnce();
    expect(updatePasswordHash.mock.calls[0]?.[0]).toBe(USER);
  }, 20_000);

  it("does not rewrite a hash that is already current", async () => {
    const updatePasswordHash = vi.fn();
    const current = await credential();

    await signIn(
      { findByEmail: async () => current, updatePasswordHash },
      { email: "eli@example.com", password: "hunter2" },
      clock,
    );

    expect(updatePasswordHash).not.toHaveBeenCalled();
  }, 30_000);

  it("records when someone last signed in", async () => {
    const recordSignIn = vi.fn();
    const found = await credential();

    await signIn(
      { findByEmail: async () => found, recordSignIn },
      { email: "eli@example.com", password: "hunter2" },
      clock,
    );

    expect(recordSignIn).toHaveBeenCalledWith(USER, NOW);
  }, 20_000);

  it("does not record a sign-in that failed", async () => {
    const recordSignIn = vi.fn();
    const found = await credential();

    await signIn(
      { findByEmail: async () => found, recordSignIn },
      { email: "eli@example.com", password: "wrong" },
      clock,
    );

    expect(recordSignIn).not.toHaveBeenCalled();
  }, 20_000);

  it("hands back an actor with no password on it", async () => {
    // A User reaches screens, sync payloads, and API responses. A hash that
    // travels with it gets logged eventually.
    const result = await signIn(
      await store(await credential()),
      { email: "eli@example.com", password: "hunter2" },
      clock,
    );

    expect(JSON.stringify(result)).not.toContain("scrypt$");
  }, 20_000);
});
