"use client";

import Link from "next/link";

import { PageBody, PageHeader, Tabs } from "@galaxy-farm/ui";
import type { NotificationSetting, Ulid } from "@galaxy-farm/core";

import { BrandingScreen } from "@/app/(admin)/admin/settings/_components/branding-screen";
import { DevicesScreen } from "@/app/(admin)/admin/settings/_components/devices-screen";
import { NotificationsScreen } from "@/app/(admin)/admin/settings/_components/notifications-screen";
import {
  PeopleScreen,
  type PersonRow,
} from "@/app/(admin)/admin/settings/_components/people-screen";
import { PropertyScreen } from "@/app/(admin)/admin/settings/_components/property-screen";
import { WatchSettingsScreen } from "@/app/(admin)/admin/settings/_components/watch-settings-screen";
import type { KioskDevice } from "@/lib/device-store";
import type { PushDevice } from "@/lib/push-store";

/**
 * Settings (spec §7).
 *
 * §7 gives this one route a long list — branding, users and roles, property
 * and zones, feed types, breeds, notification preferences, kiosk devices,
 * integrations — so it grows tabs rather than routes. Five, and no more: the
 * farm's name and the property's facts are one tab, Farm, because they are
 * one question ("what is this place") and a sixth tab is a strip that scrolls
 * on a phone.
 *
 * The People tab, and the farm-name form inside Farm, are absent rather than
 * disabled for anyone without the capability. That is presentation, not permission: §4.3 puts the
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
  deletedDevices,
  pinSet,
  pushDevices,
  notificationSettings,
  vapidPublicKey,
  pushUnavailable,
  unavailable,
  devicesUnavailable,
  notificationsUnavailable,
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
  /** Tombstoned screens, for the §4.5 clause 4 restore path. */
  readonly deletedDevices: readonly KioskDevice[];
  readonly pinSet: boolean;
  /** This person's own subscribed browsers, and their §6 preferences. */
  readonly pushDevices: readonly PushDevice[];
  readonly notificationSettings: readonly NotificationSetting[];
  /** The VAPID public key, when push is configured for the farm. */
  readonly vapidPublicKey?: string | undefined;
  /** Why it is not, when it is not — the sentence names the variables to set. */
  readonly pushUnavailable?: string | undefined;
  /** Why the people list is missing, when it is. */
  readonly unavailable?: string | undefined;
  /** Why the device list is missing, when it is. */
  readonly devicesUnavailable?: string | undefined;
  /** Why the notification settings are missing, when they are. */
  readonly notificationsUnavailable?: string | undefined;
}) {
  const tabs = [
    // Not owner-gated, unlike the farm name inside it. Renaming the farm
    // renames it to everyone the farm deals with; the property's own name,
    // address and timezone are the operational facts a member works from —
    // and the watch thresholds beside them have always been open to a member.
    { id: "farm", label: "Farm" },
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
    // Not gated: a person's own devices and their own §6 preferences. The
    // adornment is their subscribed browsers, which is the number somebody
    // actually wants to see at a glance — "am I still getting these on the
    // phone I replaced?"
    {
      id: "notifications",
      label: "Notifications",
      adornment: notificationsUnavailable === undefined ? pushDevices.length : "!",
    },
    { id: "watch", label: "Calving watch" },
  ];

  return (
    <PageBody>
      <PageHeader
        title="Settings"
        actions={
          // Deleted records used to be a link at the foot of the Calving
          // watch tab, which is the last place anybody looks for them.
          <Link
            href="/admin/settings/trash"
            className="inline-flex min-h-target items-center text-sm font-semibold text-action underline-offset-2 hover:underline"
          >
            Trash
          </Link>
        }
      />

      <Tabs tabs={tabs} label="Settings">
        {(active) => (
          <div className="pt-density">
            {active === "farm" ? (
              <div className="flex flex-col gap-density">
                {mayManageBranding ? (
                  <BrandingScreen propertyId={propertyId} actorId={actorId} />
                ) : null}
                <PropertyScreen propertyId={propertyId} actorId={actorId} />
              </div>
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
                deleted={deletedDevices}
                pinSet={pinSet}
                {...(devicesUnavailable === undefined ? {} : { unavailable: devicesUnavailable })}
              />
            ) : active === "notifications" ? (
              notificationsUnavailable === undefined ? (
                <NotificationsScreen
                  actorId={actorId}
                  devices={pushDevices}
                  settings={notificationSettings}
                  {...(vapidPublicKey === undefined ? {} : { publicKey: vapidPublicKey })}
                  {...(pushUnavailable === undefined ? {} : { pushUnavailable })}
                />
              ) : (
                <p className="text-sm text-danger">{notificationsUnavailable}</p>
              )
            ) : (
              <WatchSettingsScreen propertyId={propertyId} actorId={actorId} />
            )}
          </div>
        )}
      </Tabs>
    </PageBody>
  );
}
