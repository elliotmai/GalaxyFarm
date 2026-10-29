"use client";

import Link from "next/link";
import { useState } from "react";

import { Button, EmptyState, PageBody, PageHeader, SafetyBadge } from "@galaxy-farm/ui";
import {
  displayName,
  effectiveSlot,
  isOnFarm,
  openAssignments,
  type Animal,
  type Ulid,
  type Zone,
  type ZoneAssignment,
} from "@galaxy-farm/core";

import { ageLabel } from "@/app/(admin)/admin/cattle/_components/herd-row";
import { HORSE_SEX_LABELS, HorseEditor } from "@/app/(admin)/admin/horses/_components/horse-editor";
import { horseHref } from "@/lib/animal-slug";
import { useRecords } from "@/lib/local/use-records";

import { ListRow, PhoneAddButton, RowList } from "./list-row";

/**
 * The horse herd (spec §5.9, §7 `/admin/horses/herd`).
 *
 * Was a "coming soon" shell; it is now the list §5.9 said it would hold — who
 * is here and what each is like to handle — because a horse needs somewhere to
 * be added and a page to be opened from. One row per horse, the herd row's
 * anatomy, and the row is the way into her own page (`/admin/horses/[id]`).
 *
 * Until the first horse arrives it still says what the shell said, with the
 * roadmap and the shopping as the way on, plus the one new thing: adding her.
 */
export function HerdScreen({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const query = { propertyId };
  const { records: animals, loading } = useRecords<Animal>("animals", query);
  const { records: zones } = useRecords<Zone>("zones", query);
  const { records: placements } = useRecords<ZoneAssignment>("zoneAssignments", query);
  const [adding, setAdding] = useState(false);

  const now = new Date();
  const horses = animals
    .filter((animal) => animal.species === "horse" && isOnFarm(animal))
    .sort((left, right) => displayName(left).localeCompare(displayName(right)));
  const indoorZoneIds = new Set(zones.filter((zone) => zone.indoor).map((zone) => zone.id));

  /** Where she stands: the outside pen first, as on her page. */
  function whereIs(horse: Animal): string | undefined {
    const standing = openAssignments(placements, horse.id).map((entry) => ({
      name: zones.find((zone) => zone.id === entry.zoneId)?.name,
      slot: effectiveSlot(entry, indoorZoneIds),
    }));
    return (standing.find((entry) => entry.slot === "outside") ?? standing[0])?.name;
  }

  const careful = horses.filter((horse) => horse.safetyLevel >= 4).length;

  return (
    <PageBody>
      <PageHeader
        eyebrow="Horses"
        title="Herd"
        subtitle={
          horses.length === 0
            ? "Who is here, whose they are, and what each one is like to handle."
            : [
                `${horses.length} horse${horses.length === 1 ? "" : "s"}`,
                careful === 0 ? undefined : `${careful} handle with care`,
              ]
                .filter((part) => part !== undefined)
                .join(" · ")
        }
        actions={
          <span className="hidden sm:block">
            <Button variant="primary" aria-haspopup="dialog" onClick={() => setAdding(true)}>
              <span aria-hidden="true">+</span> Add a horse
            </Button>
          </span>
        }
      />

      {loading ? (
        <p className="text-muted">Loading the herd…</p>
      ) : horses.length === 0 ? (
        <EmptyState
          title="No horses here yet"
          detail="Add the first one when she arrives. The shopping is live now."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" aria-haspopup="dialog" onClick={() => setAdding(true)}>
                Add a horse
              </Button>
              <Link
                href="/admin/horses/roadmap"
                className="inline-flex min-h-target items-center rounded-density border border-rule px-4 font-semibold text-action hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
              >
                Roadmap
              </Link>
              <Link
                href="/admin/horses/candidates"
                className="inline-flex min-h-target items-center rounded-density border border-rule px-4 font-semibold text-action hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
              >
                Candidates
              </Link>
            </div>
          }
        />
      ) : (
        <RowList label="The horses">
          {horses.map((horse) => (
            <ListRow
              key={horse.id}
              title={displayName(horse)}
              line={[HORSE_SEX_LABELS[horse.sex], ageLabel(horse, now), whereIs(horse) ?? "No pen"]}
              chip={
                horse.safetyLevel >= 4 ? (
                  <SafetyBadge level={horse.safetyLevel} size="compact" />
                ) : undefined
              }
              href={horseHref(horse)}
            />
          ))}
        </RowList>
      )}

      {horses.length === 0 ? null : (
        <PhoneAddButton onClick={() => setAdding(true)}>Horse</PhoneAddButton>
      )}

      {adding ? (
        <HorseEditor
          horse={undefined}
          propertyId={propertyId}
          actorId={actorId}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </PageBody>
  );
}
