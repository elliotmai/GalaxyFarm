"use client";

import { useState } from "react";

import { Callout, PageBody, PageHeader, Tabs, Tile } from "@galaxy-farm/ui";
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
import type { CareGuide, GuideSection } from "@galaxy-farm/module-housesitting";
import type { HealthRecord } from "@galaxy-farm/module-cattle";
import type { FeedType } from "@galaxy-farm/module-feed";

import { GuideBuilder } from "@/app/(admin)/admin/housesitter/_components/guide-builder";
import { GuidePreview } from "@/app/(admin)/admin/housesitter/_components/guide-preview";
import {
  SitterAccess,
  type SitterRow,
} from "@/app/(admin)/admin/housesitter/_components/sitter-access";
import { useFarmName } from "@/lib/branding";
import { guideFeedingPlans, guideZonesFrom } from "@/lib/guide-composition";
import { useRecords } from "@/lib/local/use-records";

/**
 * The housesitter guide (spec §5.10, §7).
 *
 * Three tabs, and the middle one is the product: what is stored is a title, an
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
  unavailable,
  farmName,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly sitters: readonly SitterRow[];
  readonly mayManagePeople: boolean;
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
      <PageHeader
        title="Housesitter guide"
        subtitle="Written once, composed live. The pens, the routine and the numbers come from the farm's own records every time it is opened."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Guides"
          value={guides.length}
          tone="identity"
          hint={
            guides.length === live.length ? undefined : `${guides.length - live.length} retired`
          }
        />
        <Tile
          label="Pens on it"
          value={pens.length}
          tone="neutral"
          hint="Live, with somebody in them"
        />
        <Tile
          label="Emergency numbers"
          value={emergency.length}
          tone={emergency.length === 0 ? "danger" : "calm"}
          emphasis={emergency.length === 0}
          hint={emergency.length === 0 ? "Nobody tagged" : "From Contacts"}
        />
        <Tile
          label="Sitters with access"
          value={open.length}
          tone={open.length > 0 ? "action" : "neutral"}
          hint={mayManagePeople ? "Windows still open" : "Owner-only"}
        />
      </div>

      {emergency.length > 0 ? null : (
        <Callout tone="danger" title="No emergency numbers on the guide">
          The guide takes them from Contacts, from anybody tagged <em>Emergency</em>. Until somebody
          is, that section prints empty — and it is the one section a helper will be looking for
          when they most need it.
        </Callout>
      )}

      <Tabs
        label="Housesitter"
        tabs={[
          { id: "guide", label: "The guide" },
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
