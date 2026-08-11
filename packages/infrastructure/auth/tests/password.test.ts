import { describe, expect, it } from "vitest";

import {
  SCRYPT_PARAMS,
  hashPassword,
  needsRehash,
  parseHash,
  verifyPassword,
} from "../src/password.js";

/**
 * Password hashing.
 *
 * These run at reduced cost where the test is about behaviour rather than
 * about the cost itself — a full-strength hash is ~100ms by design, and a
 * suite that pays that thirty times stops being run.
 */

const FAST = { N: 1_024, r: 8, p: 1, keyLength: 64 } as const;

describe("hashPassword", () => {
  it("round-trips a password", async () => {
    const hash = await hashPassword("correct horse battery staple", FAST);

    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple", FAST);

    expect(await verifyPassword("Correct horse battery staple", hash)).toBe(false);
  });

  it("salts, so two people with the same password have different hashes", async () => {
    // Identical hashes would tell anyone reading the table which accounts
    // share a password, and make one cracked hash worth several accounts.
    const a = await hashPassword("hunter2", FAST);
    const b = await hashPassword("hunter2", FAST);

    expect(a).not.toBe(b);
    expect(await verifyPassword("hunter2", a)).toBe(true);
    expect(await verifyPassword("hunter2", b)).toBe(true);
  });

  it("stores no plaintext anywhere in the hash", async () => {
    const hash = await hashPassword("Andromeda2026!", FAST);

    expect(hash).not.toContain("Andromeda");
  });

  it("normalises unicode, so the same typed password always works", async () => {
    // "é" can be one code point or two. A password typed on a phone and then
    // on a laptop can differ by that alone, and the sign-in failure is
    // impossible for the person to explain.
    const composed = "café";
    const decomposed = "café";
    const hash = await hashPassword(composed, FAST);

    expect(await verifyPassword(decomposed, hash)).toBe(true);
  });

  it("carries its own parameters, so raising the cost later breaks nothing", async () => {
    const hash = await hashPassword("hunter2", FAST);
    const parsed = parseHash(hash);

    expect(parsed?.N).toBe(FAST.N);
    // Verified against the parameters in the record, not against today's.
    expect(await verifyPassword("hunter2", hash)).toBe(true);
  });

  it("uses parameters worth using by default", async () => {
    // 2^16 is roughly a tenth of a second and 64 MB: unremarkable for one
    // sign-in, expensive across a stolen table.
    expect(SCRYPT_PARAMS.N).toBeGreaterThanOrEqual(2 ** 16);
  }, 10_000);
});

describe("verifyPassword", () => {
  it("treats a corrupt record as a failed sign-in, not a crash", async () => {
    // A 500 here tells an attacker they have found something interesting.
    for (const bad of ["", "not-a-hash", "scrypt$1$2", "scrypt$0$0$0$$", "bcrypt$1$8$1$aa$bb"]) {
      expect(await verifyPassword("hunter2", bad), bad).toBe(false);
    }
  });

  it("rejects a hash whose salt or digest is empty", async () => {
    expect(await verifyPassword("hunter2", "scrypt$1024$8$1$$aGk")).toBe(false);
    expect(await verifyPassword("hunter2", "scrypt$1024$8$1$aGk$")).toBe(false);
  });
});

describe("needsRehash", () => {
  it("flags a hash made with weaker parameters", async () => {
    // Sign-in is the only moment the plaintext exists, so it is the only
    // moment an old hash can be upgraded.
    const old = await hashPassword("hunter2", FAST);

    expect(needsRehash(old)).toBe(true);
  });

  it("leaves a current hash alone", async () => {
    const current = await hashPassword("hunter2", FAST);

    expect(needsRehash(current, FAST)).toBe(false);
  });

  it("flags anything it cannot read", () => {
    expect(needsRehash("garbage")).toBe(true);
  });
});
