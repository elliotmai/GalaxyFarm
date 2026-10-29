"use client";

import { useState } from "react";

import { Button, EmptyState, Pill } from "@galaxy-farm/ui";
import { endOfDay, type Ulid, type Zone } from "@galaxy-farm/core";
import {
  headCountOn,
  type EggLog,
  type Flock,
  type FlockAdjustment,
} from "@galaxy-farm/module-poultry";

import {
  FlockEditor,
  SPECIES_LABEL,
} from "@/app/(admin)/admin/chickens/flock/_components/flock-editor";
import { ListRow, RowIconButton, RowList } from "@/app/(admin)/admin/horses/_components/list-row";
import { flockHref } from "@/lib/flock-slug";

/**
 * The flocks themselves (spec §5.4).
 *
 * A flock, not a bird. Eighteen hens are one record with a headcount, because
 * nobody names a laying hen and nobody wants eighteen profiles to keep — and
 * §5.4 makes quail a value in `species` rather than a second module, so this
 * screen is the whole of poultry however the farm's taste in birds changes.
 *
 * The count on each row is derived, never typed. What can be typed is the
 * count on the day the flock was first written down; everything after it comes
 * from the log.
 *
 * Rows, not cards: the count in the badge, the name, one line, and one chip
 * for whatever is wrong. The row opens the flock's own page — where its eggs,
 * its history, and the editor and delete now live, as a cow's do — and the ±
 * beside it still records a change against that flock without leaving here.
 */

export function FlocksPanel({
  flocks,
  adjustments,
  zones,
  eggLogs,
  loading,
  propertyId,
  actorId,
  onRecordChange,
}: {
  readonly flocks: readonly Flock[];
  readonly adjustments: readonly FlockAdjustment[];
  readonly zones: readonly Zone[];
  readonly eggLogs: readonly EggLog[];
  readonly loading: boolean;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  /** Opens the headcount form on this flock. */
  readonly onRecordChange: (flock: Flock) => void;
}) {
  const [adding, setAdding] = useState(false);

  const zoneName = (id: Ulid | undefined) =>
    id === undefined ? undefined : zones.find((zone) => zone.id === id)?.name;

  // End of today, not this instant: a date-only entry is stored at midday, so
  // an "as of now" asked at six in the morning would leave this morning's
  // losses out of the count on the row.
  const now = endOfDay(new Date());

  if (loading) return <p className="text-muted">Loading flocks…</p>;

  return (
    <div className="flex flex-col gap-density">
      {flocks.length === 0 ? (
        <EmptyState
          title="No flocks yet"
          detail="Add the coop as a flock with the birds you have today. Everything after is logged."
          action={
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add the first flock
            </Button>
          }
        />
      ) : (
        <>
          <RowList label="Flocks">
            {[...flocks]
              .sort((left, right) => Number(right.active) - Number(left.active))
              .map((flock) => {
                const count = headCountOn(flock, adjustments, now);
                const entries = adjustments.filter((entry) => entry.flockId === flock.id).length;
                const coop = zoneName(flock.zoneId);

                return (
                  <ListRow
                    key={flock.id}
                    lead={
                      <>
                        {count}
                        <span className="sr-only"> bird{count === 1 ? "" : "s"},</span>
                      </>
                    }
                    title={flock.name}
                    line={[
                      SPECIES_LABEL[flock.species],
                      coop,
                      flock.breedMix,
                      entries === 0
                        ? `opened at ${flock.openingCount}`
                        : `${flock.openingCount} to start, ${entries} change${entries === 1 ? "" : "s"}`,
                    ]}
                    // One chip, for what is wrong: switched off first, then an
                    // empty coop, then no coop — without one the pen board has
                    // nowhere to draw these birds.
                    chip={
                      !flock.active ? (
                        <Pill tone="neutral">Switched off</Pill>
                      ) : count === 0 ? (
                        <Pill tone="danger">Empty</Pill>
                      ) : coop === undefined ? (
                        <Pill tone="danger">No coop</Pill>
                      ) : undefined
                    }
                    label={`${flock.name}, ${count} bird${count === 1 ? "" : "s"}`}
                    href={flockHref(flock, flocks)}
                    trailing={
                      <RowIconButton
                        label={`Record a change to ${flock.name}`}
                        onClick={() => onRecordChange(flock)}
                      >
                        <span aria-hidden="true" className="text-lg font-semibold leading-none">
                          ±
                        </span>
                      </RowIconButton>
                    }
                  />
                );
              })}
          </RowList>
          <div>
            <Button variant="ghost" onClick={() => setAdding(true)}>
              + Add a flock
            </Button>
          </div>
        </>
      )}

      {adding ? (
        <FlockEditor
          adjustments={adjustments}
          zones={zones}
          eggLogs={eggLogs}
          propertyId={propertyId}
          actorId={actorId}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </div>
  );
}
