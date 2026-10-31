"use client";

import Link from "next/link";
import { useState } from "react";

import { PageBody, PageHeader, Tabs } from "@galaxy-farm/ui";
import {
  emergencyContacts,
  type Animal,
  type ChoreTemplate,
  type Contact,
  type FeedingPlan,
  type Ulid,
  type Zone,
  type ZoneAssignment,
} from "@galaxy-farm/core";
import type { CareGuide, GuideSection, Trip } from "@galaxy-farm/module-housesitting";
import type { HealthRecord } from "@galaxy-farm/module-cattle";
import type { FeedType } from "@galaxy-farm/module-feed";

import { GuideBuilder } from "@/app/(admin)/admin/housesitter/_components/guide-builder";
import { GuidePreview } from "@/app/(admin)/admin/housesitter/_components/guide-preview";
import {
  SitterAccess,
  type SitterRow,
} from "@/app/(admin)/admin/housesitter/_components/sitter-access";
import { TripsPanel } from "@/app/(admin)/admin/housesitter/_components/trips-panel";
import { WanderPanel } from "@/app/(admin)/admin/housesitter/_components/wander-panel";
import { useFarmName } from "@/lib/branding";
import { guideFeedingPlans, guideZonesFrom } from "@/lib/guide-composition";
import { useRecords } from "@/lib/local/use-records";
import type { WanderConnection } from "@/lib/wander-store";

/**
 * The housesitter guide (spec §5.10, §7).
 *
 * Four tabs, and the first one is the product: what is stored is a title, an
 * intro, a list of which auto-sections to include, and the sections somebody
 * wrote by hand. Everything else — the pens with their effective safety levels,
 * the merged instructions, the routine, the numbers to ring — is composed from
 * live records at the moment it is read. §5.10 is explicit about why: "Update
 * a feeding plan anywhere and every format is already current."
 *
 * The reads happen once here and go down as props. Nine live queries opened
 * separately by the builder and the preview would redraw them out of step, and
 * the two showing different guides is the one thing this screen cannot do.
 */
export function HousesitterScreen({
  propertyId,
  actorId,
  sitters,
  mayManagePeople,
  mayConnect,
  wander,
  unavailable,
  farmName,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly sitters: readonly SitterRow[];
  readonly mayManagePeople: boolean;
  /** `integrations.manage` — owner-only, so the panel is absent for a member. */
  readonly mayConnect: boolean;
  /** Read on the server: this row never reaches a local store. */
  readonly wander?: WanderConnection | undefined;
  readonly unavailable?: string | undefined;
  /** What the server rendered the farm as; the stored name supersedes it. */
  readonly farmName: string;
}) {
  const query = { propertyId };
  const { records: guides, loading } = useRecords<CareGuide>("careGuides", query);
  const { records: sections } = useRecords<GuideSection>("guideSections", query);
  const { records: zones } = useRecords<Zone>("zones", query);
  const { records: assignments } = useRecords<ZoneAssignment>("zoneAssignments", query);
  const { records: animals } = useRecords<Animal>("animals", query);
  const { records: contacts } = useRecords<Contact>("contacts", query);
  const { records: templates } = useRecords<ChoreTemplate>("choreTemplates", query);
  const { records: plans } = useRecords<FeedingPlan>("feedingPlans", query);
  const { records: feeds } = useRecords<FeedType>("feedTypes", query);
  const { records: health } = useRecords<HealthRecord>("healthRecords", query);
  const { records: trips } = useRecords<Trip>("trips", query);

  const [chosenId, setChosenId] = useState<Ulid | undefined>();

  // Read here with everything else, so the printed guide's running head and
  // the nav above it cannot disagree about what the place is called.
  const name = useFarmName(propertyId, farmName);

  const live = guides.filter((guide) => guide.active);
  /**
   * Which guide the screen is on.
   *
   * Falls back rather than going blank: a guide deleted in another tab, or one
   * not yet chosen, both land on the first live guide. A preview showing
   * nothing while a guide plainly exists reads as the feature being broken.
   */
  const guide = guides.find((held) => held.id === chosenId) ?? live[0] ?? guides[0];
  const mine =
    guide === undefined
      ? []
      : sections
          .filter((section) => section.careGuideId === guide.id)
          .sort((left, right) => left.order - right.order);

  const now = new Date();
  const pens = guideZonesFrom(zones, assignments, animals, now);
  const feeding = guideFeedingPlans(plans, feeds, animals, zones, assignments, now);
  const emergency = emergencyContacts(contacts);
  const open = sitters.filter((row) => {
    const to = row.user.accessTo;
    return row.user.active && to !== undefined && to >= now;
  });

  return (
    <PageBody>
      {/* The counts that used to be four tiles, as the header's one line of
          facts: none of them is a number anybody acts on by itself. */}
      <PageHeader
        title="Housesitter guide"
        subtitle={[
          `${live.length} ${live.length === 1 ? "guide" : "guides"}`,
          `${pens.length} ${pens.length === 1 ? "pen" : "pens"} on it`,
          ...(mayManagePeople ? [`${open.length} with access`] : []),
        ].join(" · ")}
      />

      {/*
        The one gap worth saying, as one line. The guide takes its emergency
        numbers from anybody tagged Emergency in Contacts, and until somebody
        is, that section prints empty — the one a helper looks for when they
        most need it.
      */}
      {emergency.length > 0 ? null : (
        <p className="text-sm text-danger">
          No emergency numbers on the guide.{" "}
          <Link
            href="/admin/contacts"
            className="inline-flex min-h-target items-center font-semibold underline underline-offset-2"
          >
            Tag one in Contacts
          </Link>
        </p>
      )}

      <Tabs
        label="Housesitter"
        tabs={[
          { id: "guide", label: "The guide" },
          {
            id: "travel",
            label: "Travel",
            ...(trips.length === 0 ? {} : { adornment: trips.length }),
          },
          { id: "preview", label: "Preview and print" },
          { id: "access", label: "Access" },
        ]}
      >
        {(active) =>
          active === "guide" ? (
            <GuideBuilder
              guides={guides}
              sections={mine}
              chosen={guide}
              onChoose={setChosenId}
              counts={{
                pens: pens.length,
                cattle_feeding: feeding.length,
                chores: templates.filter((template) => template.active).length,
                emergency_contacts: emergency.length,
                vet: contacts.filter((contact) => contact.tags.includes("vet")).length,
                pets: animals.filter(
                  (animal) => animal.species === "dog" || animal.species === "cat",
                ).length,
                equipment_quirks: 0,
                custom: mine.length,
              }}
              loading={loading}
              propertyId={propertyId}
              actorId={actorId}
            />
          ) : active === "travel" ? (
            <div className="flex flex-col gap-density">
              {mayConnect ? <WanderPanel connection={wander} /> : null}
              <TripsPanel trips={trips} propertyId={propertyId} actorId={actorId} />
            </div>
          ) : active === "preview" ? (
            <GuidePreview
              guide={guide}
              sections={mine}
              zones={zones}
              assignments={assignments}
              animals={animals}
              contacts={contacts}
              templates={templates}
              plans={plans}
              feeds={feeds}
              health={health}
              farmName={name}
            />
          ) : (
            <SitterAccess
              sitters={sitters}
              mayManagePeople={mayManagePeople}
              actorId={actorId}
              {...(unavailable === undefined ? {} : { unavailable })}
            />
          )
        }
      </Tabs>
    </PageBody>
  );
}
