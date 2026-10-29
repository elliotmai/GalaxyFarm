"use client";

import { usePathname } from "next/navigation";

import type { Ulid } from "@galaxy-farm/core";

import { ActionGrid, ActionLink, PhotoAction } from "@/app/(admin)/_components/animal-page";
import { logHref as logFlowHref } from "@/app/(admin)/admin/log/_components/log-kinds";

/**
 * The eight things people do to an animal, as big buttons (V2 Animal).
 *
 * Each opens the Log flow with this animal already chosen and the kind of
 * record already picked, so recording a shot from her page is the shot's
 * details and nothing else. The Log owns every write; these are only ways in.
 *
 * Photo is the exception. It is the camera, straight away, through the same
 * photo pipeline the gallery uses — issue #9's "a photo is ≤2 taps from the
 * animal's profile" — and the picture queues on the device, so it works in a
 * pen with no signal.
 *
 * The tiles themselves are shared with the other animals' pages
 * (`(admin)/_components/animal-page.tsx`); what is particular to a cow is
 * which eight there are.
 */

export const LOG_KINDS = [
  "treatment",
  "weight",
  "calving",
  "heat",
  "breeding",
  "move",
  "photo",
  "note",
] as const;
export type LogKind = (typeof LOG_KINDS)[number];

const LABELS: Readonly<Record<LogKind, string>> = {
  treatment: "Treatment",
  weight: "Weight",
  calving: "Calving",
  heat: "Heat",
  breeding: "Breeding",
  move: "Move",
  photo: "Photo",
  note: "Note",
};

/**
 * The Log flow's address for one kind of record about one animal, closing
 * back to `from` — her page — rather than to Today.
 */
export function logHref(kind: LogKind, animalId: Ulid, from?: string | null): string {
  return logFlowHref({ kind, animals: [animalId], from });
}

export function AnimalActions({
  animalId,
  propertyId,
  actorId,
}: {
  readonly animalId: Ulid;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const pathname = usePathname();
  return (
    <ActionGrid label="Log for this animal">
      {LOG_KINDS.map((kind) =>
        kind === "photo" ? (
          <PhotoAction key={kind} animalId={animalId} propertyId={propertyId} actorId={actorId} />
        ) : (
          <ActionLink key={kind} href={logHref(kind, animalId, pathname)} icon={kind}>
            {LABELS[kind]}
          </ActionLink>
        ),
      )}
    </ActionGrid>
  );
}
