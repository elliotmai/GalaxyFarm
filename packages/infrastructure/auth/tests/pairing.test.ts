import { describe, expect, it } from "vitest";

import {
  hashDeviceToken,
  mintDeviceToken,
  mintPairingCode,
  normalisePairingCode,
  PAIRING_TTL_MINUTES,
  pairingExpiry,
} from "../src/pairing.js";

/**
 * Kiosk pairing (spec §4.4).
 *
 * Two secrets, two different properties worth checking. The pairing code has
 * to be short enough to type across a barn and unambiguous enough to read
 * off a phone screen; the device token has to behave exactly like an
 * invitation token, because it is minted and checked the same way.
 */

describe("pairing codes", () => {
  it("is six characters from an alphabet with no ambiguous glyphs", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = mintPairingCode();
      expect(code).toHaveLength(6);
      expect(code).toMatch(/^[A-Z0-9]+$/);
      // No 0/O, 1/I/L — the whole point of the alphabet.
      expect(code).not.toMatch(/[01ILO]/);
    }
  });

  it("essentially never repeats across 500 draws", () => {
    const codes = new Set(Array.from({ length: 500 }, () => mintPairingCode()));
    expect(codes.size).toBe(500);
  });

  it("normalises case and stray whitespace, since a code is read aloud as often as typed", () => {
    expect(normalisePairingCode("a1b2c3")).toBe("A1B2C3");
    expect(normalisePairingCode(" a1 b2c3 ")).toBe("A1B2C3");
  });

  it("expires PAIRING_TTL_MINUTES after it is minted", () => {
    const now = new Date("2026-06-15T12:00:00Z");
    const expiry = pairingExpiry(now);

    expect(expiry.getTime() - now.getTime()).toBe(PAIRING_TTL_MINUTES * 60_000);
  });
});

describe("device tokens", () => {
  it("never repeats itself", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => mintDeviceToken().token));
    expect(tokens.size).toBe(200);
  });

  it("produces something that survives a URL and is long enough to matter", () => {
    const { token } = mintDeviceToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodeURIComponent(token)).toBe(token);
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it("keeps a hash rather than the token", () => {
    const { token, tokenHash } = mintDeviceToken();

    expect(tokenHash).not.toBe(token);
    expect(tokenHash).not.toContain(token);
  });

  it("hashes deterministically, which is what lets a lookup find it by hash", () => {
    const { token, tokenHash } = mintDeviceToken();

    expect(hashDeviceToken(token)).toBe(tokenHash);
  });

  it("hashes two different tokens to two different values", () => {
    const first = mintDeviceToken();
    const second = mintDeviceToken();

    expect(hashDeviceToken(first.token)).not.toBe(hashDeviceToken(second.token));
  });
});
