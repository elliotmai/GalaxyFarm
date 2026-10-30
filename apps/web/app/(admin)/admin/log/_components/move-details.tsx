"use client";

import { useMemo, useState } from "react";

import { Select } from "@galaxy-farm/ui";
import {
  assignmentInSlot,
  conflictingAssignments,
  encodeUlid,
  moveToZone,
  zoneAssignmentSchema,
  type Ulid,
  type Zone,
  type ZoneAssignment,
} from "@galaxy-farm/core";

import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

import { DetailsForm, forCount, whoLine, type DetailsProps } from "./log-parts";

/**
 * Moving animals (spec §5.1) — outside and inside, separately.
 *
 * An animal on this farm stands in two places at once: the pen or pasture it
 * lives on, and — some nights — a barn or stall it is shut in. So the form
 * asks for both, each one optional: change the pasture and leave the barn, put
 * her in the barn and leave the pasture, or take her out of the barn with
 * "None". Leaving a choice alone leaves that place as it is.
 *
 * Every move goes through `moveToZone`, the one place every move on the farm
 * is decided — the herd screen, the Pen Board and the property map all use
 * it. It closes the assignment for the slot the zone implies and opens a new
 * one, so where a cow was in March survives; and it is a no-op for an animal
 * already standing there, reported rather than written twice. "None" closes
 * the open inside assignment and opens nothing.
 */

/** "" leaves a place alone; `none` (inside only) takes them out of it. */
const KEEP = "";
const NONE = "none";

export function MoveDetails({ propertyId, actorId, animals, onSaved }: DetailsProps) {
  const query = { propertyId };
  const { records: zones } = useRecords<Zone>("zones", query);
  const { records: assignments } = useRecords<ZoneAssignment>("zoneAssignments", query);
  const placements = useMutations<ZoneAssignment>(
    "zoneAssignments",
    "zoneAssignments",
    zoneAssignmentSchema,
    propertyId,
    actorId,
  );

  const indoorZoneIds = useMemo(
    () => new Set(zones.filter((zone) => zone.indoor).map((zone) => zone.id)),
    [zones],
  );
  const live = zones.filter((zone) => zone.active);
  const outdoors = live.filter((zone) => !zone.indoor);
  const indoors = live.filter((zone) => zone.indoor);

  const [outsideId, setOutsideId] = useState(KEEP);
  const [insideId, setInsideId] = useState(KEEP);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const outside = outdoors.find((candidate) => candidate.id === outsideId);
  const inside = indoors.find((candidate) => candidate.id === insideId);
  const zoneName = (id: Ulid) => zones.find((zone) => zone.id === id)?.name;

  // Where a single animal is now, so "leave as is" says what it is leaving.
  const only = animals.length === 1 ? animals[0] : undefined;
  const nowIn = (slot: "outside" | "inside") =>
    only === undefined
      ? undefined
      : zoneName(
          assignmentInSlot(assignments, only.id, slot, indoorZoneIds)?.zoneId ?? ("" as Ulid),
        );
  const nowOutside = nowIn("outside");
  const nowInside = nowIn("inside");

  async function submit() {
    setError(undefined);
    if (outside === undefined && inside === undefined && insideId !== NONE) {
      setError("Choose a new place, outside or inside");
      return;
    }

    setBusy(true);
    try {
      let moved = 0;
      let already = 0;
      for (const animal of animals) {
        let changed = false;
        let stayed = false;

        for (const zone of [outside, inside]) {
          if (zone === undefined) continue;
          const at = new Date();
          const { closed, opened, alreadyThere } = moveToZone(
            assignments,
            {
              id: encodeUlid(at.getTime()) as Ulid,
              propertyId,
              createdAt: at,
              updatedAt: at,
              animalId: animal.id,
              zoneId: zone.id,
              indoor: zone.indoor,
              at,
            },
            indoorZoneIds,
          );

          // Closed before opened, as everywhere else: a crash between the two
          // leaves her nowhere for a moment rather than in two pens at once.
          for (const entry of closed) {
            await placements.update(entry.id, { periodTo: entry.periodTo });
          }
          if (opened !== undefined) {
            const result = await placements.create(opened);
            if (!result.ok) {
              setError("Could not save that move");
              return;
            }
          }
          if (alreadyThere) stayed = true;
          else changed = true;
        }

        if (insideId === NONE) {
          const at = new Date();
          const open = conflictingAssignments(assignments, animal.id, "inside", indoorZoneIds);
          for (const entry of open) {
            await placements.update(entry.id, { periodTo: at });
          }
          if (open.length > 0) changed = true;
          else stayed = true;
        }

        if (changed) moved += 1;
        else if (stayed) already += 1;
      }

      const where = [
        outside?.name,
        inside === undefined ? undefined : `inside ${inside.name}`,
        insideId === NONE ? "out of the barn" : undefined,
      ]
        .filter((part) => part !== undefined)
        .join(", ");
      onSaved({
        headline: `Saved for ${forCount(animals.length)}`,
        detail:
          already === 0
            ? `Moved: ${where}.`
            : `${moved === 0 ? "Nobody moved" : `${forCount(moved)} moved`} — ${forCount(already)} already there.`,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <DetailsForm
      title="Move"
      who={whoLine(animals)}
      onSubmit={() => void submit()}
      submitLabel={`Move ${forCount(animals.length)}`}
      busy={busy}
      error={error}
    >
      <Select
        label="Outside"
        value={outsideId}
        onChange={(event) => setOutsideId(event.target.value)}
        options={[
          {
            value: KEEP,
            label: nowOutside === undefined ? "Leave as is" : `Leave as is — ${nowOutside}`,
          },
          ...outdoors.map((entry) => ({
            value: entry.id,
            label: `${entry.name}${entry.resting ? " · resting" : ""}`,
          })),
        ]}
      />
      {/* Resting pastures challenge a move (§5.1) — said, not refused. */}
      {outside?.resting === true ? (
        <p className="-mt-2 text-sm text-danger">{outside.name} is resting.</p>
      ) : null}

      {/* Always offered, so the choice is visible before any barn exists —
          with a pointer to where a pen is marked as inside. */}
      <Select
        label="Inside"
        hint={
          indoors.length === 0
            ? "No inside pens yet — mark a barn or stall as Inside in Farm › Pastures."
            : "Optional — a barn or stall for tonight. None takes them out."
        }
        value={insideId}
        onChange={(event) => setInsideId(event.target.value)}
        options={[
          {
            value: KEEP,
            label:
              only === undefined ? "Leave as is" : `Leave as is — ${nowInside ?? "not inside"}`,
          },
          { value: NONE, label: "None — not inside" },
          ...indoors.map((entry) => ({ value: entry.id, label: entry.name })),
        ]}
      />
    </DetailsForm>
  );
}
