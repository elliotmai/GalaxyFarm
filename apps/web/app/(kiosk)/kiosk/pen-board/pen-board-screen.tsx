"use client";

import { useMemo, useState, useTransition } from "react";

import { Button, Modal, PageBody, SafetyBadge, useToast } from "@galaxy-farm/ui";
import {
  effectiveSafetyLevel,
  isOnFarm,
  occupantsOf,
  type Animal,
  type Ulid,
  type Zone,
  type ZoneAssignment,
} from "@galaxy-farm/core";

import { penAssignments } from "@galaxy-farm/module-pets";

import { moveKioskAnimal } from "@/app/(kiosk)/kiosk/_actions";
import { KioskHeader, KioskQuiet } from "@/app/(kiosk)/kiosk/_components/kiosk-header";
import { useSyncEngine } from "@/app/_components/sync-provider";
import { useRecords } from "@/lib/local/use-records";

/**
 * The Pen Board (spec §4.4) — the property map's data without the map.
 *
 * Every zone, who is in it, and the effective safety level `max(zone
 * baseline, highest occupant)` derives to — the same `effectiveSafetyLevel`
 * the spatial editor uses, so a bull moved into a green pen turns it red here
 * exactly when it does everywhere else. Tapping an animal is the whitelisted
 * `animals.move` action; nothing here reaches the property map itself, which
 * is a Phase 1 screen with an editor a barn touchscreen has no business
 * running.
 *
 * Each pen is one panel: its name and level on a line, and its occupants as
 * big name buttons under it — the button is the move, so there is nothing to
 * explain on screen. An empty pen says so in a word.
 */
export function PenBoardScreen({ propertyId }: { readonly propertyId: Ulid }) {
  const { store, syncNow } = useSyncEngine();
  const { show } = useToast();
  const [pending, startTransition] = useTransition();
  const [moving, setMoving] = useState<Animal | undefined>();

  const query = useMemo(() => ({ propertyId }), [propertyId]);
  const { records: zones, loading: zonesLoading } = useRecords<Zone>("zones", query);
  const { records: animals } = useRecords<Animal>("animals", query);
  const { records: assignments } = useRecords<ZoneAssignment>("zoneAssignments", query);

  const animalsById = useMemo(() => new Map(animals.map((a) => [a.id, a])), [animals]);
  const now = useMemo(() => new Date(), []);

  const activeZones = useMemo(
    () => [...zones].filter((z) => z.active).sort((a, b) => a.name.localeCompare(b.name)),
    [zones],
  );

  // Pens hold stock, not pets (§5.8). A dog with a placement behind him — from
  // a mis-drag on the map, or an older build — is not somebody the board
  // offers to move, and not somebody whose level a pen inherits.
  const placements = useMemo(() => penAssignments(assignments, animals), [assignments, animals]);

  function occupantsFor(zone: Zone): Animal[] {
    return occupantsOf(placements, zone.id, now)
      .map((id) => animalsById.get(id))
      .filter((a): a is Animal => a !== undefined && isOnFarm(a));
  }

  function move(zoneId: Ulid) {
    if (moving === undefined) return;
    const animalId = moving.id;
    setMoving(undefined);

    startTransition(async () => {
      const result = await moveKioskAnimal({ animalId, zoneId });
      if (!result.ok) {
        show({ message: result.error, tone: "danger" });
        return;
      }
      // A server action writes straight to Postgres (spec §4.3) — it never
      // touches this device's outbox, so the local store has no idea anything
      // changed until the next scheduled pull. Forcing one now is what makes
      // the tap feel like it did something, rather than a card that only
      // catches up to itself a minute later.
      await syncNow();
      show({ message: `${moving.name ?? "Animal"} moved.`, tone: "success" });
    });
  }

  const head = activeZones.reduce((sum, zone) => sum + occupantsFor(zone).length, 0);

  return (
    <PageBody>
      <KioskHeader
        title="Pen Board"
        fact={
          zonesLoading || store === undefined
            ? undefined
            : `${activeZones.length} pens · ${head} head`
        }
      />

      {zonesLoading || store === undefined ? (
        <KioskQuiet>Loading…</KioskQuiet>
      ) : (
        <ul className="grid grid-cols-1 items-start gap-density md:grid-cols-2 lg:grid-cols-3">
          {activeZones.map((zone) => {
            const occupants = occupantsFor(zone);
            const level = effectiveSafetyLevel(
              zone.baselineSafetyLevel,
              occupants.map((a) => a.safetyLevel),
            );
            const raisedBy = occupants.find(
              (a) => a.safetyLevel === level && level !== zone.baselineSafetyLevel,
            );

            return (
              <li
                key={zone.id}
                className="flex flex-col gap-3 rounded-density border border-rule bg-panel p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="min-w-0 text-ink">{zone.name}</h2>
                  <SafetyBadge
                    level={level}
                    {...(raisedBy?.name === undefined ? {} : { raisedBy: raisedBy.name })}
                  />
                </div>
                {occupants.length === 0 ? (
                  <p className="text-base text-muted">Empty</p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {occupants.map((animal) => (
                      <li key={animal.id} className="min-w-0">
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => setMoving(animal)}
                          aria-label={`Move ${animal.name ?? animal.tagNumber ?? "this animal"}`}
                          className="min-h-target max-w-full truncate rounded-density border border-edge bg-panel px-4 text-density font-semibold text-ink hover:bg-raised disabled:opacity-60"
                        >
                          {animal.name ?? animal.tagNumber ?? "Unnamed"}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {moving === undefined ? null : (
        <Modal
          title={`Move ${moving.name ?? moving.tagNumber ?? "this animal"} to`}
          onClose={() => setMoving(undefined)}
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {activeZones.map((zone) => (
              <Button key={zone.id} disabled={pending} onClick={() => move(zone.id)}>
                {zone.name}
              </Button>
            ))}
          </div>
        </Modal>
      )}
    </PageBody>
  );
}
