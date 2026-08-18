import { r2Storage, type R2Options } from "./r2.js";
import type { FileStorage } from "@galaxy-farm/core";

/**
 * Reading R2's credentials out of the environment (spec §3, §9).
 *
 * A pure function of an env object rather than a read of `process.env` at
 * import time — the same shape `resolveEmailConfig` has, for the same two
 * reasons: a screen can ask "is storage set up?" without constructing a client
 * it has no intention of using, and every branch is testable without setting
 * global state.
 *
 * Missing configuration is a returned reason rather than a throw. Photos are
 * not load-bearing for a farm records app: with no bucket configured, every
 * screen still works, photographs still queue on the device, and the presign
 * route answers with a sentence naming what is unset instead of a 500 that
 * looks like a bug in the upload path.
 */

export type StorageConfig =
  | { readonly ok: true; readonly options: R2Options }
  | { readonly ok: false; readonly reason: string };

/** Every variable that has to be set, and what it is called in `.env.example`. */
const REQUIRED = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
] as const;

export function resolveStorageConfig(
  env: Readonly<Record<string, string | undefined>>,
): StorageConfig {
  const missing = REQUIRED.filter((name) => (env[name]?.trim() ?? "") === "");

  if (missing.length > 0) {
    return {
      ok: false,
      reason:
        `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set, so there is nowhere to put a photo. ` +
        "Add the R2 credentials to .env.local for a laptop, or to the Netlify environment variables for the deployed site. " +
        "Photos taken meanwhile stay queued on the device and upload once it is configured.",
    };
  }

  const endpoint = env["R2_ENDPOINT"]?.trim() ?? "";

  return {
    ok: true,
    options: {
      accountId: env["R2_ACCOUNT_ID"] as string,
      bucket: env["R2_BUCKET"] as string,
      accessKeyId: env["R2_ACCESS_KEY_ID"] as string,
      secretAccessKey: env["R2_SECRET_ACCESS_KEY"] as string,
      // Only when set. An empty string here would be a URL nothing can parse,
      // which fails at construction rather than at the first upload — and R2's
      // own endpoint is derivable from the account id, so unset is the
      // ordinary case rather than an oversight.
      ...(endpoint === "" ? {} : { endpoint }),
    },
  };
}

/** The adapter, or nothing when storage is not configured. */
export function storageFrom(
  env: Readonly<Record<string, string | undefined>>,
): FileStorage | undefined {
  const config = resolveStorageConfig(env);
  return config.ok ? r2Storage(config.options) : undefined;
}
