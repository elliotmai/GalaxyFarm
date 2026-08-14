"use client";

import { useCallback, useMemo, useState } from "react";

import { Badge, Button, Card, Checkbox, Select, useConfirmDelete, useToast } from "@galaxy-farm/ui";
import {
  encodeUlid,
  moveToZone,
  zoneAssignmentSchema,
  type Animal,
  type Ulid,
  type Zone,
  type ZoneAssignment,
} from "@galaxy-farm/core";
import {
  cattleProfileSchema,
  describeBatch,
  overdueToWean,
  weaningBatches,
  WEANING_EARLIEST_DAYS,
  WEANING_LATEST_DAYS,
  type CalvingRecord,
  type CattleProfile,
  type WeaningBatch,
} from "@galaxy-farm/module-cattle";

import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

/**
 * Calves coming up for weaning, and the button that weans them (spec §6).
 *
 * The trigger §6's list of twenty-two did not have. Everything needed to compute
 * it was already on file — a calf has a birthday and a dam — and nothing was
 * reading it, so "wean" existed in this app only as a label on a weight.
 *
 * Grouped, never per calf. Contemporaries come off in one morning, so raising
 * the job four times over three weeks would mean three raisings answered by
 * doing nothing, which is how an alert stops being read.
 *
 * ## Weaning is a move, not a flag
 *
 * Calves run with their dams until this happens, so the job is to put them
 * somewhere the dams are not. `weanedOn` and the new assignment are written in
 * one action for that reason: a calf marked weaned but still standing in with
 * its dam is not weaned, and either half on its own is a lie.
 *
 * Nothing renders when nothing is due, which is most of the year. A card
 * permanently reading "0 calves" trains people to look past the place a real
 * one will appear.
 */

export function WeaningCard({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const { records: animals } = useRecords<Animal>("animals", { propertyId });
  const { records: profiles } = useRecords<CattleProfile>("cattleProfiles", { propertyId });
  const { records: calvings } = useRecords<CalvingRecord>("calvingRecords", { propertyId });
  const { records: zones } = useRecords<Zone>("zones", { propertyId });
  const { records: assignments } = useRecords<ZoneAssignment>("zoneAssignments", { propertyId });

  const profileApi = useMutations<CattleProfile>(
    "cattleProfiles",
    "cattleProfiles",
    cattleProfileSchema,
    propertyId,
    actorId,
  );
  const placements = useMutations<ZoneAssignment>(
    "zoneAssignments",
    "zoneAssignments",
    zoneAssignmentSchema,
    propertyId,
    actorId,
  );
  const { show } = useToast();
  const confirm = useConfirmDelete();

  // One clock for the render, so a calf cannot be 134 days old in the heading
  // and 135 in its own line.
  const asOf = useMemo(() => new Date(), []);

  const batches = useMemo(
    () => weaningBatches({ animals, profiles, calvings, asOf }),
    [animals, profiles, calvings, asOf],
  );

  /** Calves ticked for this round, keyed by id. Everything starts ticked. */
  const [excluded, setExcluded] = useState<ReadonlySet<Ulid>>(new Set());
  const [destination, setDestination] = useState("");
  const [working, setWorking] = useState(false);

  const byId = useMemo(() => new Map(animals.map((animal) => [animal.id, animal])), [animals]);

  // Which zones are indoor, so `moveToZone` can tell an inside assignment from
  // an outside one and close only the one this move replaces.
  const indoorZoneIds = useMemo(
    () => new Set(zones.filter((zone) => zone.indoor).map((zone) => zone.id)),
    [zones],
  );

  const zoneOptions = useMemo(
    () =>
      zones
        .filter((zone) => zone.active && zone.type !== "working_facility")
        .map((zone) => ({
          value: zone.id,
          label: zone.type === "off_site" ? `${zone.name} (off site)` : zone.name,
        })),
    [zones],
  );

  const toggle = useCallback((calfId: Ulid) => {
    setExcluded((current) => {
      const next = new Set(current);
      // crud-guard: allow-unconfirmed — unticking a calf in a selection that has written nothing yet
      if (next.has(calfId)) next.delete(calfId);
      else next.add(calfId);
      return next;
    });
  }, []);

  const wean = useCallback(
    async (batch: WeaningBatch) => {
      const taking = batch.calves.filter((calf) => !excluded.has(calf.calfId));
      const zone = zones.find((candidate) => candidate.id === destination);
      if (taking.length === 0 || zone === undefined) return;

      // §4.5: a bulk write that moves animals and closes assignments is not
      // something to do on a stray click, and it is tedious rather than hard
      // to undo — every calf would have to be moved back by hand.
      const agreed = await confirm({
        // Elevated rather than Standard: §4.5 puts every bulk action above
        // Standard, and this one closes an assignment per calf as well.
        tier: "elevated",
        recordName:
          taking.length === 1 ? (taking[0]?.calfName ?? "a calf") : `${taking.length} calves`,
        entity: "weaning",
        // Not deletions, but what else the action touches — which is what the
        // dialog exists to show.
        dependents: taking.map((calf) => ({
          entity: "Pen assignment",
          label: `${calf.calfName} — to ${zone.name}`,
          // Detached, never deleted. Where a calf stood in March survives the
          // move: closing an assignment is what makes that history free.
          effect: "detached" as const,
        })),
        bulkCount: taking.length,
        consequence: `They are marked weaned today and moved to ${zone.name}, off the cows they are on. Putting them back is a move each.`,
        action: "Wean them",
      });
      if (!agreed) return;

      setWorking(true);
      const at = new Date();
      let moved = 0;
      let failed = 0;

      try {
        for (const calf of taking) {
          const profile = profiles.find((entry) => entry.animalId === calf.calfId);

          // The date and the move together. A calf marked weaned but still in
          // with its dam is not weaned, and neither half stands on its own.
          if (profile === undefined) {
            const created = await profileApi.create({
              animalId: calf.calfId,
              registrations: [],
              breedComposition: [],
              geneticTests: [],
              weanedOn: at,
            } as never);
            if (!created.ok) {
              failed += 1;
              continue;
            }
          } else {
            const updated = await profileApi.update(profile.id, { weanedOn: at });
            if (!updated.ok) {
              failed += 1;
              continue;
            }
          }

          const { closed, opened } = moveToZone(
            assignments,
            {
              id: encodeUlid(at.getTime() + moved) as Ulid,
              propertyId,
              createdAt: at,
              updatedAt: at,
              animalId: calf.calfId,
              zoneId: zone.id,
              indoor: zone.indoor,
              at,
            },
            indoorZoneIds,
          );

          for (const entry of closed) {
            await placements.update(entry.id, { periodTo: entry.periodTo });
          }
          const placed = await placements.create(opened);
          if (!placed.ok) failed += 1;
          else moved += 1;
        }

        show({
          tone: failed === 0 ? "success" : "warning",
          message:
            failed === 0
              ? `${moved} weaned and moved to ${zone.name}.`
              : `${moved} weaned and moved; ${failed} could not be saved.`,
        });
        setExcluded(new Set());
        setDestination("");
      } finally {
        setWorking(false);
      }
    },
    [
      assignments,
      confirm,
      destination,
      excluded,
      placements,
      profileApi,
      profiles,
      indoorZoneIds,
      propertyId,
      show,
      zones,
    ],
  );

  if (batches.length === 0) return null;

  const late = overdueToWean(batches);

  return (
    <Card
      title="Coming up for weaning"
      actions={
        late.length === 0 ? (
          <Badge tone="calm">{batches.length} due soon</Badge>
        ) : (
          <Badge tone="danger">{late.length} past the day</Badge>
        )
      }
    >
      <div className="flex flex-col gap-density">
        {batches.map((batch) => {
          const taking = batch.calves.filter((calf) => !excluded.has(calf.calfId));

          return (
            <section key={batch.calves[0]?.calfId} className="flex flex-col gap-2">
              <p
                className={batch.overdue || batch.splitNeeded ? "font-medium text-ink" : "text-ink"}
              >
                {describeBatch(batch)}
              </p>

              <ul className="flex flex-col gap-1">
                {batch.calves.map((calf) => {
                  const dam = calf.damId === undefined ? undefined : byId.get(calf.damId);
                  const genetic =
                    calf.geneticDamId === undefined ? undefined : byId.get(calf.geneticDamId);

                  return (
                    <li key={calf.calfId} className="flex flex-wrap items-baseline gap-2">
                      <Checkbox
                        label={calf.calfName}
                        checked={!excluded.has(calf.calfId)}
                        onChange={() => toggle(calf.calfId)}
                      />
                      <span className="text-sm text-muted">{calf.ageDays} days</span>
                      {dam === undefined ? null : (
                        <span className="text-sm text-muted">
                          on {dam.name ?? dam.tagNumber ?? "a cow"}
                        </span>
                      )}
                      {/* The pen and the papers are different facts on an ET or
                          grafted calf, and following the papers would send
                          somebody to split a pair that is not there. */}
                      {genetic === undefined ? null : (
                        <span className="text-sm text-muted">
                          ({calf.raisedByOther === "grafted" ? "grafted on" : "recipient"}; out of{" "}
                          {genetic.name ?? genetic.tagNumber ?? "another cow"})
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>

              <div className="flex flex-wrap items-end gap-2">
                <Select
                  label="Move them to"
                  placeholder="Pick a pen"
                  value={destination}
                  options={zoneOptions}
                  onChange={(event) => setDestination(event.target.value)}
                />
                <Button
                  onClick={() => void wean(batch)}
                  disabled={working || destination === "" || taking.length === 0}
                >
                  {working
                    ? "Weaning…"
                    : `Wean ${taking.length} ${taking.length === 1 ? "calf" : "calves"}`}
                </Button>
              </div>
            </section>
          );
        })}
      </div>

      <p className="mt-density text-sm text-muted">
        Calves may come off from {WEANING_EARLIEST_DAYS} days and must be off by{" "}
        {WEANING_LATEST_DAYS}. A group waits for its youngest to be old enough, and is ordered by
        whichever calf runs out of road first. The 205-day figure elsewhere is what weaning weights
        are adjusted to for comparison, not when to wean.
      </p>
    </Card>
  );
}
