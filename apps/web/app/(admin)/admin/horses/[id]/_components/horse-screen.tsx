"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  Button,
  DetailList,
  EmptyState,
  PageBody,
  SafetyBadge,
  Section,
  optionLabel,
} from "@galaxy-farm/ui";
import {
  displayName,
  effectiveSlot,
  openAssignments,
  type Animal,
  type Ulid,
  type Zone,
  type ZoneAssignment,
} from "@galaxy-farm/core";
import type { HealthRecord } from "@galaxy-farm/module-cattle";

import {
  ActionButton,
  ActionGrid,
  ActionLink,
  AnimalHeader,
  ComingUpSection,
  HistorySection,
  MoreDisclosure,
  PhotoAction,
  noteRows,
  undatedNotes,
} from "@/app/(admin)/_components/animal-page";
import { comingUp, history } from "@/app/(admin)/admin/cattle/[id]/_components/animal-history";
import { facts } from "@/app/(admin)/admin/cattle/[id]/_components/record-rows";
import { ageLabel } from "@/app/(admin)/admin/cattle/_components/herd-row";
import { HORSE_SEX_LABELS, HorseEditor } from "@/app/(admin)/admin/horses/_components/horse-editor";
import { logHref } from "@/app/(admin)/admin/log/_components/log-kinds";
import { PhotoPanel } from "@/app/_components/photo-panel";
import { HORSE_SECTION_SEGMENTS, horseHref, horseSlug, resolveAnimalSlug } from "@/lib/animal-slug";
import { useRecords } from "@/lib/local/use-records";

/**
 * One horse (spec §7, §5.9; V2 Animal).
 *
 * The cow's page, for a module that is still mostly shells. Who she is and
 * where she stands; the buttons that have a real write path behind them today
 * — Move and Note through the ＋ Log, which already takes a horse for both, the
 * camera, and her own details; then Coming up, one History, the photos, and
 * handling and details behind one disclosure.
 *
 * There is no Treatment or Weight button, deliberately. The Log's forms for
 * those are cattle-only (withdrawal, the medicine fridge, the 205-day), and a
 * horse's farrier, dentist and vet visits want a screen of their own rather
 * than a cow's form with a horse in it. When that arrives it gets a tile here.
 *
 * History and Coming up reuse the cow's builders with the horse's records:
 * moves and any health record are the same rows, and the breeding inputs are
 * simply empty until §5.9's breeding shell is filled in.
 */
export function HorseScreen({
  slug,
  propertyId,
  actorId,
}: {
  readonly slug: string;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const query = { propertyId };
  const { records: animals, loading } = useRecords<Animal>("animals", query);
  const { records: zones } = useRecords<Zone>("zones", query);
  const { records: placements } = useRecords<ZoneAssignment>("zoneAssignments", query);
  const { records: health } = useRecords<HealthRecord>("healthRecords", query);

  const [editing, setEditing] = useState(false);

  // One clock for the render, so the age and "coming up" agree.
  const asOf = useMemo(() => new Date(), []);

  const horses = useMemo(() => animals.filter((animal) => animal.species === "horse"), [animals]);
  const found = useMemo(
    () => resolveAnimalSlug(slug, horses, () => undefined, HORSE_SECTION_SEGMENTS),
    [slug, horses],
  );

  // An old address moves to the current one, in an effect — navigating while
  // rendering updates the router mid-render, which React refuses.
  const canonical = found === undefined ? undefined : horseSlug(found.animal);
  const moveTo = found?.stale === true && canonical !== slug ? found.animal : undefined;
  useEffect(() => {
    if (moveTo !== undefined) router.replace(horseHref(moveTo));
  }, [moveTo, router]);

  if (loading) return <p className="text-muted">Looking…</p>;

  if (found === undefined) {
    return (
      <PageBody>
        <EmptyState
          title="No horse by that name"
          detail="Nothing on this device answers to that name or tag."
          action={
            <Link href="/admin/horses" className="text-action underline">
              Back to the herd
            </Link>
          }
        />
      </PageBody>
    );
  }

  const horse = found.animal;
  const name = displayName(horse);

  // Both slots, as on the cow's page: a horse in the barn is in a pen too.
  const indoorZoneIds = new Set(zones.filter((zone) => zone.indoor).map((zone) => zone.id));
  const standing = openAssignments(placements, horse.id).map((entry) => ({
    zone: zones.find((candidate) => candidate.id === entry.zoneId),
    slot: effectiveSlot(entry, indoorZoneIds),
  }));
  const outside = standing.find((entry) => entry.slot === "outside");
  const inside = standing.find((entry) => entry.slot === "inside");
  const where = [outside?.zone?.name, inside?.zone?.name].filter(Boolean).join(" and ");
  const zone = (outside ?? inside)?.zone;

  const line = facts(
    "Horse",
    HORSE_SEX_LABELS[horse.sex],
    ageLabel(horse, asOf),
    where === "" ? (horse.status === "active" ? "No pen" : optionLabel(horse.status)) : where,
    horse.ownership === "client" ? "Client horse" : undefined,
  );

  const timeline = {
    animal: horse,
    animals,
    outsiders: [],
    zones,
    placements,
    health,
    weights: [],
    breedings: [],
    calvings: [],
    heats: [],
    now: asOf,
  };
  const ahead = comingUp(timeline);
  const past = [...history(timeline), ...noteRows(horse)].sort(
    (left, right) => right.date.getTime() - left.date.getTime(),
  );

  const handling = [
    { label: "Why", value: horse.safetyNotes },
    { label: "Care instructions", value: horse.customInstructions },
    { label: "Pen instructions", value: zone?.customInstructions },
  ].filter((item) => item.value !== undefined && item.value !== "");

  return (
    <PageBody>
      <AnimalHeader
        // Few horses wear a tag, so the badge says what she is instead.
        badge={horse.tagNumber ?? "Horse"}
        title={name}
        chip={
          horse.safetyLevel >= 4 ? (
            <SafetyBadge level={horse.safetyLevel} size="compact" />
          ) : undefined
        }
        facts={line}
      >
        {/* Why she is a handful, said before anybody goes into her pen. */}
        {horse.safetyLevel >= 4 && horse.safetyNotes !== undefined && horse.safetyNotes !== "" ? (
          <p className="text-sm text-danger">{horse.safetyNotes}</p>
        ) : null}
      </AnimalHeader>

      <ActionGrid label="Record for this horse">
        <ActionLink
          icon="move"
          href={logHref({ kind: "move", animals: [horse.id], from: pathname })}
        >
          Move
        </ActionLink>
        <ActionLink
          icon="note"
          href={logHref({ kind: "note", animals: [horse.id], from: pathname })}
        >
          Note
        </ActionLink>
        <PhotoAction animalId={horse.id} propertyId={propertyId} actorId={actorId} />
        <ActionButton icon="edit" onClick={() => setEditing(true)}>
          Edit
        </ActionButton>
      </ActionGrid>

      <ComingUpSection rows={ahead} />

      <HistorySection rows={past} name={name} />

      <PhotoPanel
        propertyId={propertyId}
        actorId={actorId}
        ownerEntity="Animal"
        ownerId={horse.id}
        recordName={name}
      />

      <MoreDisclosure label="Handling, care notes, details">
        <Section title="Handling">
          <div className="flex flex-col gap-3">
            <SafetyBadge level={horse.safetyLevel} showLabel />
            {handling.length === 0 ? null : <DetailList columns={1} items={handling} />}
          </div>
        </Section>
        <Section
          title="Details"
          actions={
            <Button variant="ghost" aria-haspopup="dialog" onClick={() => setEditing(true)}>
              Edit
            </Button>
          }
        >
          <DetailList
            items={[
              {
                label: "Date of birth",
                value:
                  horse.dob === undefined
                    ? undefined
                    : `${horse.dob.toLocaleDateString()}${horse.dobIsEstimate ? " (estimated)" : ""}`,
              },
              { label: "Status", value: optionLabel(horse.status) },
              { label: "Ownership", value: horse.ownership === "own" ? "Ours" : "Client" },
              { label: "Tag or brand", value: horse.tagNumber },
              // Undated text only: the dated lines are already in History.
              { label: "Notes", value: undatedNotes(horse), wide: true },
            ].filter((item) => item.value !== undefined && item.value !== "")}
          />
        </Section>
      </MoreDisclosure>

      {editing ? (
        <HorseEditor
          key={horse.id}
          horse={horse}
          propertyId={propertyId}
          actorId={actorId}
          onClose={() => setEditing(false)}
          onDeleted={() => router.push("/admin/horses")}
        />
      ) : null}
    </PageBody>
  );
}
