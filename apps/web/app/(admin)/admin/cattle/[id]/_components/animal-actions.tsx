"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId } from "react";
import type { ChangeEvent, ReactNode } from "react";

import type { Ulid } from "@galaxy-farm/core";
import { useToast } from "@galaxy-farm/ui";

import { logHref as logFlowHref } from "@/app/(admin)/admin/log/_components/log-kinds";
import { useAttachPhotos } from "@/lib/photos/use-photos";

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

const TILE =
  "flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-density border border-rule bg-panel px-1 text-[13px] font-medium text-ink hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action";

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
    <nav aria-label="Log for this animal" className="grid grid-cols-4 gap-2">
      {LOG_KINDS.map((kind) =>
        kind === "photo" ? (
          <PhotoTile key={kind} animalId={animalId} propertyId={propertyId} actorId={actorId} />
        ) : (
          <Link key={kind} href={logHref(kind, animalId, pathname)} className={TILE}>
            <Icon kind={kind} />
            {LABELS[kind]}
          </Link>
        ),
      )}
    </nav>
  );
}

function PhotoTile({
  animalId,
  propertyId,
  actorId,
}: {
  readonly animalId: Ulid;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const intake = useAttachPhotos({ propertyId, actorId, ownerEntity: "Animal", ownerId: animalId });
  const id = useId();
  const { show } = useToast();

  // A photo that could not be added says so out loud: a tile that quietly
  // went back to "Photo" reads as a photo taken.
  const { problem, clearProblem } = intake;
  useEffect(() => {
    if (problem === undefined) return;
    show({ message: problem, tone: "danger" });
    // crud-guard: allow-unconfirmed — clears an error message; nothing persisted is touched
    clearProblem();
  }, [problem, clearProblem, show]);

  function pick(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    // Cleared first, so retaking a photo the phone names `image.jpg` both
    // times still fires a change.
    event.target.value = "";
    if (files.length > 0) void intake.attach(files);
  }

  return (
    <label
      htmlFor={id}
      className={`${TILE} relative cursor-pointer ${intake.busy ? "opacity-60" : ""}`}
    >
      <input
        id={id}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        aria-label="Photo"
        aria-busy={intake.busy}
        disabled={intake.busy}
        onChange={pick}
        className="sr-only"
      />
      <Icon kind="photo" />
      {intake.busy ? "Adding…" : LABELS.photo}
    </label>
  );
}

/** Line icons, one stroke weight, in the action colour. */
function Icon({ kind }: { readonly kind: LogKind }) {
  const paths: Record<LogKind, ReactNode> = {
    treatment: (
      <>
        <path d="M18 2l4 4" />
        <path d="M17 7l3-3" />
        <path d="M19 9L9 19l-4 1 1-4L16 6z" />
        <path d="M11 11l2 2" />
      </>
    ),
    weight: (
      <>
        <path d="M6 20h12l-2-12H8z" />
        <circle cx="12" cy="5" r="2" />
      </>
    ),
    calving: (
      <>
        <path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z" />
      </>
    ),
    heat: <path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-7 2 1 3 3 3 3s1-3 0-6z" />,
    breeding: (
      <>
        <circle cx="9" cy="12" r="5" />
        <circle cx="15" cy="12" r="5" />
      </>
    ),
    move: (
      <>
        <path d="M5 12h14" />
        <path d="M13 6l6 6-6 6" />
      </>
    ),
    photo: (
      <>
        <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
        <circle cx="12" cy="13" r="3.5" />
      </>
    ),
    note: (
      <>
        <path d="M6 3h9l4 4v14H6z" />
        <path d="M9 12h7M9 16h5" />
      </>
    ),
  };
  return (
    <svg
      aria-hidden="true"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-action"
    >
      {paths[kind]}
    </svg>
  );
}
