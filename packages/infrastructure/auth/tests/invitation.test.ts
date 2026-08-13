import { describe, expect, it } from "vitest";

import {
  hashInvitationToken,
  invitationTokenMatches,
  invitationUrl,
  isInvitationLive,
  mintInvitation,
} from "../src/invitation.js";

/**
 * Invitation tokens (spec §4.3).
 *
 * The property that matters most is the one that is easiest to break by
 * accident: what the row keeps must not be usable as a link. A token stored in
 * the clear turns a leaked backup into a way to become the owner, and nothing
 * in the app would look any different.
 */

const NOW = new Date("2026-06-15T12:00:00Z");

describe("minting", () => {
  it("never repeats itself", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => mintInvitation().token));

    expect(tokens.size).toBe(200);
  });

  it("produces something that survives a URL", () => {
    const { token } = mintInvitation();

    // base64url: no padding, no `+`, no `/`, so it needs no escaping in a path
    // and no repair after an email client wraps it.
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodeURIComponent(token)).toBe(token);
    // 32 bytes.
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it("keeps a hash rather than the token", () => {
    const { token, tokenHash } = mintInvitation();

    expect(tokenHash).not.toBe(token);
    expect(tokenHash).not.toContain(token);
  });
});

describe("checking", () => {
  it("matches the token it was minted from", () => {
    const { token, tokenHash } = mintInvitation();

    expect(invitationTokenMatches(token, tokenHash)).toBe(true);
  });

  it("rejects anything else", () => {
    const { tokenHash } = mintInvitation();
    const other = mintInvitation();

    expect(invitationTokenMatches(other.token, tokenHash)).toBe(false);
    expect(invitationTokenMatches("", tokenHash)).toBe(false);
    expect(invitationTokenMatches("nonsense", tokenHash)).toBe(false);
  });

  it("hashes deterministically, which is what lets the row be found by it", () => {
    // Unlike a password, the accept path arrives holding only the token and has
    // to locate the account. A per-row salt would make that a full scan.
    const { token, tokenHash } = mintInvitation();

    expect(hashInvitationToken(token)).toBe(tokenHash);
    expect(hashInvitationToken(token)).toBe(hashInvitationToken(token));
  });
});

describe("whether a link is still worth anything", () => {
  const hash = mintInvitation().tokenHash;

  it("needs both a token and a future expiry", () => {
    expect(isInvitationLive({ tokenHash: hash, expiresAt: new Date("2026-06-16") }, NOW)).toBe(
      true,
    );
    expect(isInvitationLive({ tokenHash: hash, expiresAt: new Date("2026-06-14") }, NOW)).toBe(
      false,
    );
    expect(isInvitationLive({ tokenHash: hash }, NOW)).toBe(false);
    expect(isInvitationLive({ expiresAt: new Date("2026-06-16") }, NOW)).toBe(false);
  });

  it("treats a spent invitation as dead", () => {
    // Accepting clears the hash, so this is the shape of an account that has
    // already been claimed.
    expect(isInvitationLive({ tokenHash: "", expiresAt: new Date("2026-06-16") }, NOW)).toBe(false);
  });
});

describe("the link itself", () => {
  it("is built in one place, so the page and the invitation agree", () => {
    expect(invitationUrl("https://farm.example", "abc123")).toBe(
      "https://farm.example/invite/abc123",
    );
  });

  it("does not double the slash on an origin that has one", () => {
    expect(invitationUrl("http://localhost:3000/", "abc123")).toBe(
      "http://localhost:3000/invite/abc123",
    );
  });
});
