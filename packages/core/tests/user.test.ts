import { describe, expect, it } from "vitest";

import {
  accountState,
  accessWindowOf,
  actorFromUser,
  canSignIn,
  invitationExpiry,
  refuseUserChange,
  userSchema,
  INVITATION_DAYS,
  type User,
} from "../src/entities/user.js";
import { encodeUlid, type Ulid } from "../src/types/ids.js";

/**
 * Accounts, invitations, and the changes the farm refuses to make (§4.3).
 *
 * Two of these rules exist because of failures that cannot be undone from
 * inside the app: `users.manage` belongs to `owner` alone, so removing the last
 * one leaves nobody who can add one back, and a housesitter with no access
 * window has access that never lapses — the single thing the role exists to
 * prevent.
 */

let counter = 0;
const nextId = (): Ulid => encodeUlid(3_000 + counter++, () => 0.5);

const NOW = new Date("2026-06-15T12:00:00Z");

const user = (overrides: Partial<User> = {}): User => ({
  id: nextId(),
  propertyId: nextId(),
  createdAt: NOW,
  updatedAt: NOW,
  email: "sam@example.com",
  name: "Sam",
  role: "member",
  active: true,
  ...overrides,
});

describe("User", () => {
  it("validates, and lowercases the address on the way in", () => {
    const parsed = userSchema.safeParse({ ...user(), email: "Sam@Example.COM" });

    expect(parsed.success).toBe(true);
    if (parsed.success) expect((parsed.data as User).email).toBe("sam@example.com");
  });

  it("carries an invitation expiry but never a token", () => {
    const parsed = userSchema.parse({ ...user(), inviteExpiresAt: NOW });

    expect((parsed as User).inviteExpiresAt).toEqual(NOW);
    expect(Object.keys(parsed as object)).not.toContain("inviteTokenHash");
    expect(Object.keys(parsed as object)).not.toContain("passwordHash");
  });
});

describe("where an account stands", () => {
  it("is invited until they set a password", () => {
    const standing = { active: true, hasPassword: false, inviteExpiresAt: invitationExpiry(NOW) };

    expect(accountState(standing, NOW)).toBe("invited");
    expect(canSignIn(standing, NOW)).toBe(false);
  });

  it("lapses when the week is up", () => {
    const expiry = invitationExpiry(NOW);
    const standing = { active: true, hasPassword: false, inviteExpiresAt: expiry };

    expect(accountState(standing, new Date(expiry.getTime() - 1))).toBe("invited");
    expect(accountState(standing, new Date(expiry.getTime() + 1))).toBe("invitation-expired");
  });

  it("counts a week from now", () => {
    expect(invitationExpiry(NOW).getTime() - NOW.getTime()).toBe(INVITATION_DAYS * 86_400_000);
  });

  it("is active once a password exists", () => {
    const standing = { active: true, hasPassword: true };

    expect(accountState(standing, NOW)).toBe("active");
    expect(canSignIn(standing, NOW)).toBe(true);
  });

  it("says switched off rather than waiting on them", () => {
    // Deactivated mid-invitation is waiting on us, not on them, and the list
    // has to say which.
    expect(
      accountState(
        { active: false, hasPassword: false, inviteExpiresAt: invitationExpiry(NOW) },
        NOW,
      ),
    ).toBe("deactivated");
    expect(accountState({ active: false, hasPassword: true }, NOW)).toBe("deactivated");
  });

  it("treats a never-invited account as lapsed rather than as waiting", () => {
    // No password and no invitation: restored from Trash, or an invitation
    // that was spent and then cleared. Either way there is no way in.
    expect(accountState({ active: true, hasPassword: false }, NOW)).toBe("invitation-expired");
  });
});

describe("changes the farm refuses", () => {
  const owner = user({ role: "owner" });
  const other = user({ role: "owner" });
  const census = (...ids: Ulid[]) => ({ liveOwnerIds: ids });

  it("keeps the last owner", () => {
    // `users.manage` is owner-only, so this is the one mistake with no way
    // back except a shell and `pnpm db:user`.
    for (const change of [{ deleting: true }, { active: false }, { role: "member" as const }]) {
      const refusal = refuseUserChange(
        { actorId: other.id, target: { id: owner.id, role: "owner" }, ...change },
        census(owner.id),
        NOW,
      );

      expect(refusal?.kind).toBe("last-owner");
    }
  });

  it("allows it once somebody else can manage people", () => {
    expect(
      refuseUserChange(
        { actorId: other.id, target: { id: owner.id, role: "owner" }, deleting: true },
        census(owner.id, other.id),
        NOW,
      ),
    ).toBeUndefined();
  });

  it("stops you locking yourself out", () => {
    expect(
      refuseUserChange(
        { actorId: owner.id, target: { id: owner.id, role: "owner" }, role: "member" },
        census(owner.id, other.id),
        NOW,
      )?.kind,
    ).toBe("self-change");

    expect(
      refuseUserChange(
        { actorId: owner.id, target: { id: owner.id, role: "owner" }, active: false },
        census(owner.id, other.id),
        NOW,
      )?.kind,
    ).toBe("self-change");
  });

  it("lets you edit your own name and window", () => {
    // Only role and active are the dangerous ones.
    expect(
      refuseUserChange(
        { actorId: owner.id, target: { id: owner.id, role: "owner" } },
        census(owner.id, other.id),
        NOW,
      ),
    ).toBeUndefined();
  });

  it("refuses a housesitter with no window", () => {
    // The gap that made the role dishonest: an unset window reads as
    // time-boxed and is not.
    const refusal = refuseUserChange(
      { actorId: owner.id, target: { id: nextId(), role: "housesitter" }, role: "housesitter" },
      census(owner.id),
      NOW,
    );

    expect(refusal?.kind).toBe("missing-access-window");
  });

  it("refuses half a window, which is worse than none", () => {
    expect(
      refuseUserChange(
        {
          actorId: owner.id,
          target: { id: nextId(), role: "housesitter" },
          accessFrom: NOW,
        },
        census(owner.id),
        NOW,
      )?.kind,
    ).toBe("missing-access-window");
  });

  it("refuses a window that ends before it starts, or has already closed", () => {
    const target = { id: nextId(), role: "housesitter" as const };

    expect(
      refuseUserChange(
        {
          actorId: owner.id,
          target,
          accessFrom: new Date("2026-06-20T00:00:00Z"),
          accessTo: new Date("2026-06-18T00:00:00Z"),
        },
        census(owner.id),
        NOW,
      )?.message,
    ).toMatch(/before the start/);

    expect(
      refuseUserChange(
        {
          actorId: owner.id,
          target,
          accessFrom: new Date("2026-06-01T00:00:00Z"),
          accessTo: new Date("2026-06-10T00:00:00Z"),
        },
        census(owner.id),
        NOW,
      )?.message,
    ).toMatch(/already closed/);
  });

  it("accepts a housesitter with both ends", () => {
    expect(
      refuseUserChange(
        {
          actorId: owner.id,
          target: { id: nextId(), role: "housesitter" },
          role: "housesitter",
          accessFrom: new Date("2026-06-20T00:00:00Z"),
          accessTo: new Date("2026-06-27T00:00:00Z"),
        },
        census(owner.id),
        NOW,
      ),
    ).toBeUndefined();
  });

  it("does not ask a housesitter being deleted for a window", () => {
    expect(
      refuseUserChange(
        { actorId: owner.id, target: { id: nextId(), role: "housesitter" }, deleting: true },
        census(owner.id, other.id),
        NOW,
      ),
    ).toBeUndefined();
  });
});

describe("the actor a housesitter's window produces", () => {
  it("carries the window only when both ends are set", () => {
    const from = new Date("2026-06-20T00:00:00Z");
    const to = new Date("2026-06-27T00:00:00Z");

    const boxed = user({ role: "housesitter", accessFrom: from, accessTo: to });
    expect(accessWindowOf(boxed)).toEqual({ from, to });
    expect(actorFromUser(boxed).accessWindow).toEqual({ from, to });

    const half = user({ role: "housesitter", accessFrom: from });
    expect(accessWindowOf(half)).toBeUndefined();
    expect(actorFromUser(half).accessWindow).toBeUndefined();
  });
});
