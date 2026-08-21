import { createDecipheriv, createECDH, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { generateVapidKeys, webPushNotifier } from "@galaxy-farm/infra-push";

import { PUSH_FALLBACK, parsePushPayload } from "../lib/sw-contract.js";

/**
 * The wire between the server and the service worker (spec §6).
 *
 * The two ends are compiled into different programs — `app/sw.ts` against
 * `lib.webworker`, everything else against `lib.dom` — so the worker cannot
 * import the adapter that writes what it reads. `sw-contract.ts` says the two
 * halves are held together by this file, and this is that: the real notifier
 * encrypts a real message, the payload is decrypted the way a browser would,
 * and the worker's own parser is run over the result.
 *
 * Without it, renaming a field in the adapter would produce a notification
 * that says "Galaxy Farm — something needs looking at" for every alert on the
 * farm, and nothing in either package's tests would notice.
 */

const RECEIVER = createECDH("prime256v1");
RECEIVER.setPrivateKey(Buffer.from("a".repeat(64), "hex"));
const AUTH = Buffer.from("0123456789abcdef");

function hmac(key: Buffer, input: Buffer): Buffer {
  return createHmac("sha256", key).update(input).digest();
}

function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  return hmac(hmac(salt, ikm), Buffer.concat([info, Buffer.from([1])])).subarray(0, length);
}

/** RFC 8291 in reverse, as the browser does it. */
function decrypt(body: Buffer): string {
  const salt = body.subarray(0, 16);
  const senderPublic = body.subarray(21, 21 + body.readUInt8(20));
  const ciphertext = body.subarray(21 + body.readUInt8(20));

  const ikm = hkdf(
    AUTH,
    RECEIVER.computeSecret(senderPublic),
    Buffer.concat([Buffer.from("WebPush: info\0"), RECEIVER.getPublicKey(), senderPublic]),
    32,
  );
  const key = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);

  const decipher = createDecipheriv("aes-128-gcm", key, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plaintext = Buffer.concat([
    decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
    decipher.final(),
  ]);

  return plaintext.subarray(0, plaintext.length - 1).toString("utf8");
}

/** Send one real notification and hand back the bytes the worker would see. */
async function pushed(subject: string, body: string): Promise<string> {
  let sentBody = Buffer.alloc(0);

  const notifier = webPushNotifier({
    config: { ...generateVapidKeys(), subject: "mailto:alerts@example.invalid" },
    subscriptions: async () => [
      {
        endpoint: "https://fcm.googleapis.com/fcm/send/phone",
        keys: {
          p256dh: RECEIVER.getPublicKey().toString("base64url"),
          auth: AUTH.toString("base64url"),
        },
      },
    ],
    onGone: async () => {},
    defaultUrl: "/admin",
    fetch: (async (_url: string, init: RequestInit) => {
      sentBody = Buffer.from(init.body as Uint8Array);
      return new Response(null, { status: 201 });
    }) as unknown as typeof globalThis.fetch,
  });

  await notifier.send({ to: "sam@example.invalid", subject, body });
  return decrypt(sentBody);
}

describe("the payload the worker receives", () => {
  it("parses into the notification the adapter meant to send", async () => {
    const raw = await pushed("Tank freeze tonight", "Lows of 24 °F. Break ice on the North Trap.");

    expect(parsePushPayload(raw)).toEqual({
      title: "Tank freeze tonight",
      body: "Lows of 24 °F. Break ice on the North Trap.",
      url: "/admin",
    });
  });

  it("survives the round trip with the characters a farm actually types", async () => {
    // Degrees, apostrophes, and a dash — all of which are multi-byte, and all
    // of which appear in the first alert anybody will receive.
    const raw = await pushed("Andromeda's window — day 279", "Hard freeze at −2 °C.");

    expect(parsePushPayload(raw).title).toBe("Andromeda's window — day 279");
  });
});

describe("parsePushPayload", () => {
  it("falls back rather than showing nothing", () => {
    // A `push` event that shows no notification is a silent push, and browsers
    // answer those by showing their own notice or revoking the permission.
    expect(parsePushPayload(undefined)).toEqual(PUSH_FALLBACK);
    expect(parsePushPayload("")).toEqual(PUSH_FALLBACK);
    expect(parsePushPayload("not json")).toEqual(PUSH_FALLBACK);
    expect(parsePushPayload("null")).toEqual(PUSH_FALLBACK);
    expect(parsePushPayload('"a string"')).toEqual(PUSH_FALLBACK);
  });

  it("fills in only the fields that are missing", () => {
    expect(parsePushPayload(JSON.stringify({ title: "Frost tonight" }))).toEqual({
      title: "Frost tonight",
      body: PUSH_FALLBACK.body,
      url: PUSH_FALLBACK.url,
    });
  });

  it("ignores fields of the wrong type rather than rendering them", () => {
    expect(parsePushPayload(JSON.stringify({ title: 7, body: [], url: {} }))).toEqual(
      PUSH_FALLBACK,
    );
  });

  it("refuses a url that is not a path on this origin", () => {
    // A notification that opens somebody else's site is the app handing its
    // own tap to a stranger.
    expect(parsePushPayload(JSON.stringify({ url: "https://example.invalid/phish" })).url).toBe(
      PUSH_FALLBACK.url,
    );
    expect(parsePushPayload(JSON.stringify({ url: "javascript:alert(1)" })).url).toBe(
      PUSH_FALLBACK.url,
    );
    expect(parsePushPayload(JSON.stringify({ url: "/admin/cattle" })).url).toBe("/admin/cattle");
  });
});
