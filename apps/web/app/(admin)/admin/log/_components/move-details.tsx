"use client";

import { useMemo, useState } from "react";

import { Select } from "@galaxy-farm/ui";
import {
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
 * Moving animals to a pen or pasture (spec §5.1).
 *
 * Through `moveToZone`, the one place every move on the farm is decided —
 * the herd screen's `placeIn`, the Pen Board and the property map all go
 * through it. It closes the assignment for the slot the zone implies and
 * opens a new one, so where a cow was in March survives; and it is a no-op
 * for an animal already standing there, which is reported rather than
 * written as a second identical row.
 */

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

  const [zoneId, setZoneId] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const zone = live.find((candidate) => candidate.id === zoneId);

  async function submit() {
    setError(undefined);
    if (zone === undefined) {
      setError("Choose where they are going");
      return;
    }

    setBusy(true);
    try {
      let moved = 0;
      let already = 0;
      for (const animal of animals) {
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
        if (alreadyThere) already += 1;
        else moved += 1;
      }

      onSaved({
        headline: `Saved for ${forCount(animals.length)}`,
        detail:
          already === 0
            ? `Moved to ${zone.name}.`
            : `${moved === 0 ? "Nobody moved" : `${forCount(moved)} moved`} — ${forCount(already)} already in ${zone.name}.`,
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
        label="To"
        value={zoneId}
        onChange={(event) => setZoneId(event.target.value)}
        placeholder="Choose a pen or pasture"
        options={live.map((entry) => ({
          value: entry.id,
          label: `${entry.name}${entry.indoor ? " · inside" : ""}${entry.resting ? " · resting" : ""}`,
        }))}
        required
      />
      {/* Resting pastures challenge a move (§5.1) — said, not refused. */}
      {zone?.resting === true ? (
        <p className="-mt-2 text-sm text-danger">{zone.name} is resting.</p>
      ) : null}
      {zone === undefined ? null : (
        <p className="-mt-2 text-sm text-muted">
          {zone.indoor
            ? "Inside for now — their pasture stays as it is."
            : "Closes whatever pasture they were on."}
        </p>
      )}
    </DetailsForm>
  );
}
