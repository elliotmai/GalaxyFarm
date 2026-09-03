"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

import { Button, Card, Modal, PageBody, PageHeader, SafetyBadge, useToast } from "@galaxy-farm/ui";
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

  return (
    <PageBody>
      <PageHeader
        eyebrow={<Link href="/kiosk">← Kiosk</Link>}
        title="Pen Board"
        subtitle="Tap an animal, then tap where it is going."
      />

      {zonesLoading || store === undefined ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 gap-density md:grid-cols-2 lg:grid-cols-3">
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
              <Card key={zone.id} className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <h2>{zone.name}</h2>
                  <SafetyBadge
                    level={level}
                    {...(raisedBy?.name === undefined ? {} : { raisedBy: raisedBy.name })}
                  />
                </div>
                {occupants.length === 0 ? (
                  <p className="text-muted">Empty</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {occupants.map((animal) => (
                      <li key={animal.id}>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => setMoving(animal)}
                          className="min-h-target w-full rounded-density border border-edge px-3 text-left text-density text-ink hover:border-action"
                        >
                          {animal.name ?? animal.tagNumber ?? "Unnamed"}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {moving === undefined ? null : (
        <Modal
          title={`Move ${moving.name ?? moving.tagNumber ?? "this animal"}`}
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
