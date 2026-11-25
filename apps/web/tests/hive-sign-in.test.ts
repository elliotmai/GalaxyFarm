import { generateKeyPairSync, sign } from "node:crypto";

import { describe, expect, it } from "vitest";

import { passFromHash } from "../app/(public)/login/hive-sign-in.js";
import type { HiveBoardUser } from "../lib/board-store.js";
import { hiveSignIn } from "../lib/hive-sign-in.js";

/**
 * Signing in to the app with a Hive pass (spec §4.3): the same people the
 * board API lets in, as an ordinary session.
 */

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
process.env["HIVE_PUBLIC_KEY"] = publicKey
  .export({ format: "der", type: "spki" })
  .toString("base64");
const NOW = new Date("2026-11-25T15:00:00Z");
const secs = Math.floor(NOW.getTime() / 1000);
const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");

function pass(claims: Record<string, unknown> = {}): string {
  const head = `${enc({ alg: "EdDSA", typ: "JWT" })}.${enc({
    iss: "hive",
    aud: "galaxyfarm",
    sub: "hive-1",
    email: "owner@farm.test",
    email_verified: true,
    name: "Owner",
    iat: secs - 10,
    exp: secs + 110,
    ...claims,
  })}`;
  return `${head}.${sign(null, Buffer.from(head), privateKey).toString("base64url")}`;
}

const people: Record<string, HiveBoardUser> = {
  "owner@farm.test": {
    id: "01OWNER",
    propertyId: "01PROP",
    role: "owner",
    active: true,
    hasPassword: true,
  },
  "sitter@farm.test": {
    id: "01SITTER",
    propertyId: "01PROP",
    role: "housesitter",
    active: true,
    hasPassword: true,
    accessFrom: new Date("2026-11-20T00:00:00Z"),
    accessTo: new Date("2026-11-30T00:00:00Z"),
  },
  "late@farm.test": {
    id: "01LATE",
    propertyId: "01PROP",
    role: "housesitter",
    active: true,
    hasPassword: true,
    accessFrom: new Date("2026-10-01T00:00:00Z"),
    accessTo: new Date("2026-10-05T00:00:00Z"),
  },
  "customer@farm.test": {
    id: "01CUST",
    propertyId: "01PROP",
    role: "customer",
    active: true,
    hasPassword: true,
  },
  "invited@farm.test": {
    id: "01INV",
    propertyId: "01PROP",
    role: "member",
    active: true,
    hasPassword: false,
  },
};
const findUser = async (email: string) => people[email];

describe("hiveSignIn", () => {
  it("signs an owner in with the session the password provider would give", async () => {
    expect(await hiveSignIn(pass(), NOW, findUser)).toEqual({
      id: "01OWNER",
      role: "owner",
      propertyId: "01PROP",
      accessFrom: null,
      accessTo: null,
    });
  });

  it("carries a housesitter's access window, and refuses one outside it", async () => {
    expect(await hiveSignIn(pass({ email: "sitter@farm.test" }), NOW, findUser)).toMatchObject({
      role: "housesitter",
      accessFrom: "2026-11-20T00:00:00.000Z",
      accessTo: "2026-11-30T00:00:00.000Z",
    });
    expect(await hiveSignIn(pass({ email: "late@farm.test" }), NOW, findUser)).toBeUndefined();
  });

  it("refuses customers, accounts that cannot sign in yet, strangers and bad passes", async () => {
    for (const email of ["customer@farm.test", "invited@farm.test", "nobody@farm.test"]) {
      expect(await hiveSignIn(pass({ email }), NOW, findUser)).toBeUndefined();
    }
    expect(await hiveSignIn(pass({ email_verified: false }), NOW, findUser)).toBeUndefined();
    expect(await hiveSignIn(pass({ aud: "learnleaf" }), NOW, findUser)).toBeUndefined();
    expect(await hiveSignIn("junk", NOW, findUser)).toBeUndefined();
  });
});

describe("passFromHash", () => {
  it("reads the pass Hive's hop came back with", () => {
    expect(passFromHash("#hive-pass=abc.def")).toBe("abc.def");
    expect(passFromHash("#hive-pass=")).toBe("");
    expect(passFromHash("#tab=chores")).toBeUndefined();
    expect(passFromHash("")).toBeUndefined();
  });
});
