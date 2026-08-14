"use client";

import { resolveBranding, type BrandingConfig, type Ulid } from "@galaxy-farm/core";

import { useRecords } from "@/lib/local/use-records";

/**
 * What this place is called, from the device (spec §5.1).
 *
 * The farm name is a stored value rather than a string in code, and it is read
 * here the way every other value is read: from the local store, so it is right
 * at zero bars and updates the moment a sync pull brings a change from
 * another device.
 *
 * `fallback` is what the server rendered — the environment variable, or the
 * neutral default behind it. It stands until the store answers, which matters
 * more than it sounds: `useRecords` returns nothing on its first render while
 * Dexie opens, and a nav that flashed a placeholder farm name on every page
 * load would look broken in the one place somebody looks constantly.
 */
export function useFarmName(propertyId: Ulid, fallback: string): string {
  const { records } = useRecords<BrandingConfig>("brandingConfigs", { propertyId });
  return resolveBranding(records)?.farmName ?? fallback;
}
