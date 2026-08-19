import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";

/**
 * VAPID — how a push service knows who we are (RFC 8292, spec §6).
 *
 * A push endpoint is a capability URL: anybody holding one can post to it. What
 * stops that being an open relay is that the push service demands a signed
 * assertion from the application server the subscription was created for, and
 * VAPID is that assertion — an ES256 JWT naming the push service as its
 * audience, sent alongside the public half of the same keypair the browser was
 * given at subscribe time.
 *
 * Which is the operational fact worth knowing before touching any of this:
 * **the keypair is not rotatable in place.** Every existing subscription is
 * bound to the public key it was made with, so changing the pair silently
 * invalidates all of them, and the first sign of it is nobody receiving
 * anything. Generate one, keep it, and treat replacing it as re-subscribing
 * every device.
 *
 * Written against `node:crypto` rather than the `web-push` package, for the
 * reason `resend.ts` gives for not taking the `resend` package: the surface
 * this app needs is one signature and one encryption, and a dependency that
 * ships a CLI and an HTTP client to provide them is a poor trade. The parts
 * that matter are held to RFC 8291's own test vector in the tests.
 */

/** P-256 uncompressed public point: `0x04` then two 32-byte coordinates. */
const PUBLIC_KEY_BYTES = 65;
const PRIVATE_KEY_BYTES = 32;

/**
 * How long a signed assertion is good for.
 *
 * Twelve hours rather than RFC 8292's twenty-four-hour maximum: some push
 * services reject a token whose expiry is further out than their own ceiling,
 * and half the maximum is far enough from every one of them to never be the
 * reason a send fails. Nothing caches these — one is signed per request, which
 * costs a signature.
 */
export const VAPID_EXPIRY_SECONDS = 12 * 60 * 60;

export type PushConfig =
  | {
      readonly ok: true;
      /** base64url, 65 bytes. Handed to the browser as the `applicationServerKey`. */
      readonly publicKey: string;
      /** base64url, 32 bytes. A server secret, like `RESEND_API_KEY`. */
      readonly privateKey: string;
      /** `mailto:` or `https:` — who a push service complains to. */
      readonly subject: string;
    }
  | { readonly ok: false; readonly reason: string };

function base64url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

/**
 * A fresh keypair, for somebody setting this up for the first time.
 *
 * Exported rather than left to a one-off script because the alternative is a
 * command line pasted into a README that drifts, and because generating a
 * keypair is the one part of this a person has to do by hand exactly once.
 */
export function generateVapidKeys(): { readonly publicKey: string; readonly privateKey: string } {
  // Both halves come out of the private key's own JWK, so the point and the
  // scalar cannot disagree — a pair that does not match is a 401 from every
  // push service with nothing in it to say which half is wrong.
  const jwk = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({
    format: "jwk",
  });

  return {
    publicKey: base64url(
      Buffer.concat([
        Buffer.from([0x04]),
        Buffer.from(jwk.x ?? "", "base64url"),
        Buffer.from(jwk.y ?? "", "base64url"),
      ]),
    ),
    privateKey: jwk.d ?? "",
  };
}

/**
 * Read the VAPID configuration out of the environment.
 *
 * A pure function of an env object, the same shape as `resolveEmailConfig`, and
 * for the same two reasons: a settings screen wants to say "push is not set up,
 * here is what to set" without constructing anything, and every branch below is
 * reachable in a test without a key.
 *
 * Missing configuration is a returned reason rather than a throw. Push is not
 * load-bearing — the calendar still fills in and the email still goes — so an
 * unset variable degrades to a sentence somebody can act on.
 */
export function resolvePushConfig(env: Readonly<Record<string, string | undefined>>): PushConfig {
  const publicKey = env["NEXT_PUBLIC_VAPID_PUBLIC_KEY"]?.trim() ?? "";
  const privateKey = env["VAPID_PRIVATE_KEY"]?.trim() ?? "";

  if (publicKey === "" || privateKey === "") {
    return {
      ok: false,
      reason:
        "NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are not both set, so nothing can be pushed. Generate a pair with `pnpm vapid:keys` and add them to .env.local for a laptop, or to the Netlify environment variables for the deployed site.",
    };
  }

  if (Buffer.from(publicKey, "base64url").length !== PUBLIC_KEY_BYTES) {
    return {
      ok: false,
      reason: `NEXT_PUBLIC_VAPID_PUBLIC_KEY should decode to ${PUBLIC_KEY_BYTES} bytes and does not. It is the uncompressed P-256 point, base64url, as \`pnpm vapid:keys\` prints it.`,
    };
  }

  if (Buffer.from(privateKey, "base64url").length !== PRIVATE_KEY_BYTES) {
    return {
      ok: false,
      reason: `VAPID_PRIVATE_KEY should decode to ${PRIVATE_KEY_BYTES} bytes and does not. Set the private half of the same pair, not the public one.`,
    };
  }

  const subject = env["VAPID_SUBJECT"]?.trim() ?? "";
  if (!/^(mailto:|https:)/.test(subject)) {
    return {
      ok: false,
      reason:
        "VAPID_SUBJECT must be a mailto: address or an https: URL — it is who a push service contacts when this application server misbehaves, and services reject a token without a usable one.",
    };
  }

  return { ok: true, publicKey, privateKey, subject };
}

/**
 * The push service a subscription lives on, as an origin.
 *
 * The JWT's audience is the origin and not the endpoint: the endpoint's path
 * *is* the subscription, and putting it in a signed token would mint one
 * assertion per device where one per service will do.
 */
export function audienceFor(endpoint: string): string {
  return new URL(endpoint).origin;
}

/** The signing key, rebuilt as a JWK so nothing here has to speak ASN.1. */
function signingKey(config: { publicKey: string; privateKey: string }) {
  const point = Buffer.from(config.publicKey, "base64url");

  return createPrivateKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      d: config.privateKey,
      x: base64url(point.subarray(1, 33)),
      y: base64url(point.subarray(33, 65)),
    },
  });
}

/**
 * The `Authorization` header for one request to one push service.
 *
 * `t=` is the assertion and `k=` is the public key it should be checked
 * against — the service holds neither, it only checks that the key matches the
 * one the browser recorded when it subscribed.
 *
 * `now` is a parameter rather than a read of the clock, because the expiry is
 * the whole content of the assertion and a test that cannot fix it can only
 * check that a string came back.
 */
export function vapidAuthorization(
  config: { readonly publicKey: string; readonly privateKey: string; readonly subject: string },
  endpoint: string,
  now: Date,
): string {
  const header = base64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = base64url(
    Buffer.from(
      JSON.stringify({
        aud: audienceFor(endpoint),
        exp: Math.floor(now.getTime() / 1000) + VAPID_EXPIRY_SECONDS,
        sub: config.subject,
      }),
    ),
  );

  // `ieee-p1363` is the raw r‖s pair JWS wants. Node's default is the DER
  // encoding, which a push service reads as a malformed signature rather than
  // a wrong one — the failure is a 401 with nothing in it to explain itself.
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), {
    key: signingKey(config),
    dsaEncoding: "ieee-p1363",
  });

  return `vapid t=${header}.${payload}.${base64url(signature)}, k=${config.publicKey}`;
}
