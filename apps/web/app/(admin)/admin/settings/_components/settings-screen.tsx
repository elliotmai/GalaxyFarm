"use client";

import { PageBody, PageHeader, Tabs } from "@galaxy-farm/ui";
import type { Ulid } from "@galaxy-farm/core";

import {
  PeopleScreen,
  type PersonRow,
} from "@/app/(admin)/admin/settings/_components/people-screen";
import { WatchSettingsScreen } from "@/app/(admin)/admin/settings/_components/watch-settings-screen";

/**
 * Settings (spec §7).
 *
 * §7 gives this one route a long list — branding, users and roles, property
 * and zones, feed types, breeds, notification preferences, kiosk devices,
 * integrations — so it grows tabs rather than routes. Two of them exist so far.
 *
 * The People tab is absent rather than disabled for anyone without
 * `users.manage`. That is presentation, not permission: §4.3 puts the actual
 * check in the application layer, and every action behind this tab asks again
 * on the server.
 */

export function SettingsScreen({
  propertyId,
  actorId,
  people,
  deleted,
  mayManagePeople,
  unavailable,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly people: readonly PersonRow[];
  readonly deleted: readonly PersonRow[];
  readonly mayManagePeople: boolean;
  /** Why the people list is missing, when it is, and whether to offer a retry. */
  readonly unavailable?: { readonly message: string; readonly retryable: boolean } | undefined;
}) {
  const tabs = [
    ...(mayManagePeople
      ? [
          {
            id: "people",
            label: "People",
            adornment: unavailable === undefined ? people.length : "!",
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
            {active === "people" && mayManagePeople ? (
              <PeopleScreen
                people={people}
                deleted={deleted}
                actorId={actorId}
                {...(unavailable === undefined ? {} : { unavailable })}
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
