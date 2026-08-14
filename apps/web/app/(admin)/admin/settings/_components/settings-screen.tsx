"use client";

import { PageBody, PageHeader, Tabs } from "@galaxy-farm/ui";
import type { Ulid } from "@galaxy-farm/core";

import { BrandingScreen } from "@/app/(admin)/admin/settings/_components/branding-screen";
import { DevicesScreen } from "@/app/(admin)/admin/settings/_components/devices-screen";
import {
  PeopleScreen,
  type PersonRow,
} from "@/app/(admin)/admin/settings/_components/people-screen";
import { PropertyScreen } from "@/app/(admin)/admin/settings/_components/property-screen";
import { WatchSettingsScreen } from "@/app/(admin)/admin/settings/_components/watch-settings-screen";
import type { KioskDevice } from "@/lib/device-store";

/**
 * Settings (spec §7).
 *
 * §7 gives this one route a long list — branding, users and roles, property
 * and zones, feed types, breeds, notification preferences, kiosk devices,
 * integrations — so it grows tabs rather than routes. Four of them exist so
 * far.
 *
 * The People and Branding tabs are absent rather than disabled for anyone
 * without the capability. That is presentation, not permission: §4.3 puts the
 * actual check in the application layer, and both ask again on the server —
 * People in its server actions, Branding in the sync push handler, which
 * refuses a `brandingConfigs` patch from anybody without `branding.manage`
 * however it was produced.
 */

export function SettingsScreen({
  propertyId,
  actorId,
  people,
  deleted,
  mayManagePeople,
  mayManageBranding,
  mayManageDevices,
  devices,
  pinSet,
  unavailable,
  devicesUnavailable,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly people: readonly PersonRow[];
  readonly deleted: readonly PersonRow[];
  readonly mayManagePeople: boolean;
  /** `branding.manage` — owners only. Renaming the farm renames it to everyone. */
  readonly mayManageBranding: boolean;
  /** `devices.manage` — owners only, the same reasoning as `users.manage`. */
  readonly mayManageDevices: boolean;
  readonly devices: readonly KioskDevice[];
  readonly pinSet: boolean;
  /** Why the people list is missing, when it is. */
  readonly unavailable?: string | undefined;
  /** Why the device list is missing, when it is. */
  readonly devicesUnavailable?: string | undefined;
}) {
  const tabs = [
    ...(mayManageBranding ? [{ id: "branding", label: "Branding" }] : []),
    // Not owner-gated, unlike Branding. Renaming the farm renames it to
    // everyone the farm deals with; the property's own name, address and
    // timezone are the operational facts a member works from — and the watch
    // thresholds beside them have always been open to a member.
    { id: "property", label: "Property" },
    ...(mayManagePeople
      ? [
          {
            id: "people",
            label: "People",
            adornment: unavailable === undefined ? people.length : "!",
          },
        ]
      : []),
    ...(mayManageDevices
      ? [
          {
            id: "devices",
            label: "Kiosk devices",
            adornment: devicesUnavailable === undefined ? devices.length : "!",
          },
        ]
      : []),
    { id: "watch", label: "Calving watch" },
  ];

  return (
    <PageBody>
      <PageHeader
        eyebrow="Settings"
        title="Settings"
        subtitle="How the farm is set up, and who can get at it."
      />

      <Tabs tabs={tabs} label="Settings">
        {(active) => (
          <div className="pt-density">
            {active === "branding" && mayManageBranding ? (
              <BrandingScreen propertyId={propertyId} actorId={actorId} />
            ) : active === "property" ? (
              <PropertyScreen propertyId={propertyId} actorId={actorId} />
            ) : active === "people" && mayManagePeople ? (
              <PeopleScreen
                people={people}
                deleted={deleted}
                actorId={actorId}
                {...(unavailable === undefined ? {} : { unavailable })}
              />
            ) : active === "devices" && mayManageDevices ? (
              <DevicesScreen
                propertyId={propertyId}
                devices={devices}
                pinSet={pinSet}
                {...(devicesUnavailable === undefined ? {} : { unavailable: devicesUnavailable })}
              />
            ) : (
              <WatchSettingsScreen propertyId={propertyId} actorId={actorId} />
            )}
          </div>
        )}
      </Tabs>
    </PageBody>
  );
}
