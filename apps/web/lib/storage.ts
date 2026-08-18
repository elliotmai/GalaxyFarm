import type { FileStorage } from "@galaxy-farm/core";
import { resolveStorageConfig, storageFrom, type StorageConfig } from "@galaxy-farm/infra-storage";

/**
 * Where photos and documents go (spec §4.1, §3).
 *
 * §4.1 puts the composition root in the app, and this is storage's corner of
 * it: the only file in the repository that reads `R2_*`, and the only one that
 * names the adapter. Everything above asks for a `FileStorage` — which is what
 * makes §10's move to a NAS or MinIO at the farm a change to this file and
 * nothing else.
 *
 * Server-side only, like `credential-store.ts` and `notifier.ts` beside it.
 * None of these variables carries a `NEXT_PUBLIC_` prefix, so they are not in
 * a client bundle to leak — and they must not be: an access key that reaches a
 * browser is a bucket anybody can write to. The device never holds a
 * credential; it asks `/api/storage/presign` for one address at a time.
 */

export function storageConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): StorageConfig {
  return resolveStorageConfig(env);
}

/** The bucket, or nothing when R2 is not configured. */
export function fileStorage(
  env: Readonly<Record<string, string | undefined>> = process.env,
): FileStorage | undefined {
  return storageFrom(env);
}
