import { generateKeyPairSync, sign } from "node:crypto";

import { describe, expect, it } from "vitest";

import { apiTokenDeviceId } from "../lib/api-token-store.js";
import {
  authorizeBoardRequest,
  hiveUserMayUseBoard,
  type HiveBoardUser,
} from "../lib/board-store.js";
import { verifyHivePass } from "../lib/hive-pass.js";

/**
 * Hive passes on the board API (spec §4.3): a person signed in to Hive reads
 * the board and ticks chores as themselves, with no stored token.
 */

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const other = generateKeyPairSync("ed25519");
const PUBLIC = publicKey.export({ format: "der", type: "spki" }).toString("base64");
const NOW = new Date("2026-11-19T15:00:00Z");
const secs = Math.floor(NOW.getTime() / 1000);
const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");

function pass(claims: Record<string, unknown> = {}, key = privateKey): string {
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
  return `${head}.${sign(null, Buffer.from(head), key).toString("base64url")}`;
}

const owner: HiveBoardUser = {
  id: "01OWNER",
  propertyId: "01PROP",
  role: "owner",
  active: true,
  hasPassword: true,
};
const findUser = async (email: string) => (email === "owner@farm.test" ? owner : undefined);
const noToken = async () => undefined;
const check = (header: string) => {
  process.env["HIVE_PUBLIC_KEY"] = PUBLIC;
  return authorizeBoardRequest(header, NOW, noToken, findUser);
};

describe("verifyHivePass", () => {
  it("accepts a pass made for GalaxyFarm", () => {
    expect(verifyHivePass(pass(), NOW, "galaxyfarm", PUBLIC)?.email).toBe("owner@farm.test");
  });
  it("refuses another app, another key, an expired pass, and junk", () => {
    expect(verifyHivePass(pass({ aud: "learnleaf" }), NOW, "galaxyfarm", PUBLIC)).toBeUndefined();
    expect(verifyHivePass(pass({}, other.privateKey), NOW, "galaxyfarm", PUBLIC)).toBeUndefined();
    expect(
      verifyHivePass(pass({ iat: secs - 400, exp: secs - 280 }), NOW, "galaxyfarm", PUBLIC),
    ).toBeUndefined();
    expect(verifyHivePass("not.a.pass", NOW, "galaxyfarm", PUBLIC)).toBeUndefined();
  });
});

describe("authorizeBoardRequest with a Hive pass", () => {
  it("acts as the person with that email, on their property", async () => {
    const caller = await check(`Hive ${pass()}`);
    expect(caller).toMatchObject({
      id: "01OWNER",
      propertyId: "01PROP",
      createdBy: "01OWNER",
      via: "hive",
    });
    expect(apiTokenDeviceId(caller!)).toBe("hive:01OWNER");
  });
  it("refuses an unconfirmed email, an unknown email, or a forged pass", async () => {
    expect(await check(`Hive ${pass({ email_verified: false })}`)).toBeUndefined();
    expect(await check(`Hive ${pass({ email: "stranger@farm.test" })}`)).toBeUndefined();
    expect(await check(`Hive ${pass({}, other.privateKey)}`)).toBeUndefined();
  });
  it("leaves connected-app tokens working as before", async () => {
    expect(apiTokenDeviceId({ id: "01TOKEN" as never })).toBe("app:01TOKEN");
  });
});

describe("hiveUserMayUseBoard", () => {
  it("lets owners and members in, housesitters only inside their window", () => {
    expect(hiveUserMayUseBoard(owner, NOW)).toBe(true);
    expect(hiveUserMayUseBoard({ ...owner, role: "member" }, NOW)).toBe(true);
    expect(hiveUserMayUseBoard({ ...owner, role: "customer" }, NOW)).toBe(false);
    expect(hiveUserMayUseBoard({ ...owner, role: "kiosk" }, NOW)).toBe(false);
    expect(hiveUserMayUseBoard({ ...owner, active: false }, NOW)).toBe(false);
    expect(hiveUserMayUseBoard({ ...owner, hasPassword: false }, NOW)).toBe(false);
    const sitter = { ...owner, role: "housesitter" };
    expect(
      hiveUserMayUseBoard(
        { ...sitter, accessFrom: new Date("2026-11-18"), accessTo: new Date("2026-11-25") },
        NOW,
      ),
    ).toBe(true);
    expect(
      hiveUserMayUseBoard(
        { ...sitter, accessFrom: new Date("2026-11-20"), accessTo: new Date("2026-11-25") },
        NOW,
      ),
    ).toBe(false);
  });
});
