import { createPublicKey, verify } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  VAPID_EXPIRY_SECONDS,
  audienceFor,
  generateVapidKeys,
  resolvePushConfig,
  vapidAuthorization,
} from "../src/vapid.js";

/**
 * VAPID (RFC 8292).
 *
 * The assertion is checked here the way a push service checks it — the
 * signature is verified against the public key that travels beside it — because
 * every other kind of assertion about a JWT (that it has three parts, that it
 * decodes) passes just as happily on a token no service would accept.
 */

const KEYS = generateVapidKeys();
const CONFIG = { ...KEYS, subject: "mailto:alerts@flyingdoublemranch.com" } as const;
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123?x=1";
const NOW = new Date("2026-11-05T12:00:00Z");

function parts(header: string) {
  const token = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  if (token === null) throw new Error(`Not a VAPID header: ${header}`);

  const [protectedHeader, payload, signature] = (token[1] ?? "").split(".");
  return {
    key: token[2] ?? "",
    signingInput: `${protectedHeader}.${payload}`,
    header: JSON.parse(Buffer.from(protectedHeader ?? "", "base64url").toString()) as Record<
      string,
      unknown
    >,
    claims: JSON.parse(Buffer.from(payload ?? "", "base64url").toString()) as Record<
      string,
      unknown
    >,
    signature: Buffer.from(signature ?? "", "base64url"),
  };
}

/** The public key as a push service would rebuild it, to check the signature. */
function publicKeyOf(base64url: string) {
  const point = Buffer.from(base64url, "base64url");
  return createPublicKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      x: point.subarray(1, 33).toString("base64url"),
      y: point.subarray(33, 65).toString("base64url"),
    },
  });
}

describe("generateVapidKeys", () => {
  it("mints a pair of the sizes the standard requires", () => {
    expect(Buffer.from(KEYS.publicKey, "base64url")).toHaveLength(65);
    expect(Buffer.from(KEYS.privateKey, "base64url")).toHaveLength(32);
  });

  it("mints a different pair each time", () => {
    expect(generateVapidKeys().privateKey).not.toBe(KEYS.privateKey);
  });
});

describe("vapidAuthorization", () => {
  it("signs an assertion the paired public key verifies", () => {
    const token = parts(vapidAuthorization(CONFIG, ENDPOINT, NOW));

    expect(
      verify(
        "sha256",
        Buffer.from(token.signingInput),
        { key: publicKeyOf(token.key), dsaEncoding: "ieee-p1363" },
        token.signature,
      ),
    ).toBe(true);
  });

  it("is rejected by the wrong public key", () => {
    // The check that gives the one above its meaning.
    const token = parts(vapidAuthorization(CONFIG, ENDPOINT, NOW));

    expect(
      verify(
        "sha256",
        Buffer.from(token.signingInput),
        { key: publicKeyOf(generateVapidKeys().publicKey), dsaEncoding: "ieee-p1363" },
        token.signature,
      ),
    ).toBe(false);
  });

  it("sends the public key beside the token, which is what binds them", () => {
    expect(parts(vapidAuthorization(CONFIG, ENDPOINT, NOW)).key).toBe(KEYS.publicKey);
  });

  it("declares ES256, the only algorithm a push service accepts", () => {
    expect(parts(vapidAuthorization(CONFIG, ENDPOINT, NOW)).header).toEqual({
      typ: "JWT",
      alg: "ES256",
    });
  });

  it("claims the push service's origin, not the subscription's URL", () => {
    // The path is the device. One assertion per service, not per phone.
    expect(parts(vapidAuthorization(CONFIG, ENDPOINT, NOW)).claims).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: Math.floor(NOW.getTime() / 1000) + VAPID_EXPIRY_SECONDS,
      sub: CONFIG.subject,
    });
  });

  it("uses a raw r‖s signature rather than DER", () => {
    // A DER signature reads to a push service as malformed, and the answer is
    // a 401 with nothing in it to say why.
    expect(parts(vapidAuthorization(CONFIG, ENDPOINT, NOW)).signature).toHaveLength(64);
  });
});

describe("audienceFor", () => {
  it("keeps only the origin", () => {
    expect(audienceFor("https://updates.push.services.mozilla.com/wpush/v2/gA")).toBe(
      "https://updates.push.services.mozilla.com",
    );
  });
});

describe("resolvePushConfig", () => {
  const env = {
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: KEYS.publicKey,
    VAPID_PRIVATE_KEY: KEYS.privateKey,
    VAPID_SUBJECT: "mailto:alerts@flyingdoublemranch.com",
  };

  it("accepts a complete configuration", () => {
    expect(resolvePushConfig(env)).toEqual({ ok: true, ...CONFIG });
  });

  it("accepts an https: subject as well as a mailto: one", () => {
    expect(resolvePushConfig({ ...env, VAPID_SUBJECT: "https://flyingdoublemranch.com" }).ok).toBe(
      true,
    );
  });

  it("reports an unset pair rather than throwing — push is not load-bearing", () => {
    const result = resolvePushConfig({});

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.reason).toMatch(/VAPID_PRIVATE_KEY/);
  });

  it("reports half a pair, which is the setup that looks configured and is not", () => {
    expect(resolvePushConfig({ ...env, VAPID_PRIVATE_KEY: "  " }).ok).toBe(false);
    expect(resolvePushConfig({ ...env, NEXT_PUBLIC_VAPID_PUBLIC_KEY: "" }).ok).toBe(false);
  });

  it("reports a key of the wrong size, naming which one", () => {
    const swapped = resolvePushConfig({
      ...env,
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: KEYS.privateKey,
    });
    expect(swapped.ok ? "" : swapped.reason).toMatch(/NEXT_PUBLIC_VAPID_PUBLIC_KEY/);

    const wrongPrivate = resolvePushConfig({ ...env, VAPID_PRIVATE_KEY: KEYS.publicKey });
    expect(wrongPrivate.ok ? "" : wrongPrivate.reason).toMatch(/private half/);
  });

  it("insists on a subject a push service can complain to", () => {
    expect(resolvePushConfig({ ...env, VAPID_SUBJECT: "alerts@example.com" }).ok).toBe(false);
    expect(resolvePushConfig({ ...env, VAPID_SUBJECT: undefined }).ok).toBe(false);
  });
});
