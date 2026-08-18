import { encodeUlid } from "@galaxy-farm/core";

/**
 * Which device this is (spec §4.2).
 *
 * A module of its own, importing nothing but the kernel, because everything
 * that writes needs it: the mutations a person makes, the patch the photo
 * uploader writes when an upload lands, and the kiosk pairing flow, which
 * seeds it before there is a local store at all.
 */

/**
 * Exported so the kiosk pairing flow can seed this before the local store is
 * ever built. A paired screen syncs under the `kioskDevices` row Postgres
 * already knows about, not a fresh id generated the first time IndexedDB is
 * touched — otherwise re-pairing, or clearing storage, forks its merge
 * history under a new device every time (spec §4.2).
 */
export const DEVICE_ID_STORAGE_KEY = "galaxy-farm:device-id";

/**
 * The device id.
 *
 * Persisted, because it is what the merge uses to break a tie between two
 * writes with identical timestamps. A device that reintroduced itself under a
 * new name every reload would make that tie-break arbitrary in a way that
 * differs per device, and the whole point is that every device reaches the
 * same answer without talking to the others.
 */
export function deviceId(): string {
  const existing = globalThis.localStorage?.getItem(DEVICE_ID_STORAGE_KEY);
  if (existing !== null && existing !== undefined && existing !== "") return existing;

  const fresh = encodeUlid(Date.now());
  globalThis.localStorage?.setItem(DEVICE_ID_STORAGE_KEY, fresh);
  return fresh;
}
