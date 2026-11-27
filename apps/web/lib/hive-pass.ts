import { createPublicKey, verify } from "node:crypto";

/**
 * Hive passes (spec §4.3 "Connected apps"): how Hive, the home-screen app in
 * the Fridge-Board repo, vouches for the person signed in to it.
 *
 * A pass is a JWT signed with Ed25519 by Hive's server. It is made for one app
 * (`aud`), lasts two minutes, and carries an email Hive has confirmed. The
 * board API accepts one as `Authorization: Hive <pass>` in place of a
 * connected-app token, so the fridge reads GalaxyFarm as whoever is signed in
 * to Hive and no token has to be stored anywhere.
 *
 * Port of Fridge-Board `netlify/lib/hiveAssertion.mjs` (verify half). The
 * public key is not secret: it can check passes, never make them.
 */

export const HIVE_APP_ID = "galaxyfarm";
export const HIVE_PUBLIC_KEY = "MCowBQYDK2VwAyEAD+9fPYhGN9ftY8MGu8oQZdgfSMZL7coC6pZ812weWVE=";

const ISSUER = "hive";
const PASS_SECONDS = 120;
const LEEWAY = 30;

export interface HivePassClaims {
  readonly sub: string;
  readonly email: string | null;
  readonly email_verified: boolean;
  readonly name: string | null;
  /**
   * Set on a *household pass*: Hive's household screen (the fridge tablet
   * signed in as the household, not a person). It has no email; `members`
   * are the household's people's confirmed emails, owners first.
   */
  readonly household?: { readonly id: string; readonly members: readonly string[] } | undefined;
}

function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

/** The pass's claims, or undefined for anything wrong with it. */
export function verifyHivePass(
  pass: string,
  now: Date,
  app: string = process.env["HIVE_APP_ID"] ?? HIVE_APP_ID,
  publicKey: string = process.env["HIVE_PUBLIC_KEY"] ?? HIVE_PUBLIC_KEY,
): HivePassClaims | undefined {
  const parts = pass.split(".");
  if (parts.length !== 3) return undefined;
  const [head, body, sig] = parts as [string, string, string];
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = decode(head);
    claims = decode(body);
  } catch {
    return undefined;
  }
  if (header["alg"] !== "EdDSA") return undefined;
  let ok = false;
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKey, "base64"),
      format: "der",
      type: "spki",
    });
    ok = verify(null, Buffer.from(`${head}.${body}`), key, Buffer.from(sig, "base64url"));
  } catch {
    return undefined;
  }
  if (!ok) return undefined;
  const secs = Math.floor(now.getTime() / 1000);
  const exp = Number(claims["exp"]);
  const iat = Number(claims["iat"]);
  if (claims["iss"] !== ISSUER || claims["aud"] !== app) return undefined;
  if (!(exp + LEEWAY > secs) || !(iat - LEEWAY <= secs) || exp - iat > PASS_SECONDS)
    return undefined;
  const sub = claims["sub"];
  if (typeof sub !== "string" || sub === "" || sub.length > 128) return undefined;
  const household =
    claims["kind"] === "household" && typeof claims["household"] === "string"
      ? {
          id: claims["household"],
          members: (Array.isArray(claims["members"]) ? (claims["members"] as unknown[]) : [])
            .filter((m): m is string => typeof m === "string" && m.includes("@"))
            .slice(0, 20),
        }
      : undefined;
  return {
    sub,
    // A household pass never names a person, whatever else it carries.
    email: household === undefined && typeof claims["email"] === "string" ? claims["email"] : null,
    email_verified: household === undefined && claims["email_verified"] === true,
    name: typeof claims["name"] === "string" ? claims["name"] : null,
    ...(household === undefined ? {} : { household }),
  };
}
