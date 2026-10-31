"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId } from "react";
import type { ChangeEvent, ReactNode } from "react";

import type { Ulid } from "@galaxy-farm/core";
import { useToast } from "@galaxy-farm/ui";

import { logHref } from "@/app/(admin)/admin/log/_components/log-kinds";
import { useAttachPhotos } from "@/lib/photos/use-photos";

/**
 * The things people do with a flock, as big buttons (the cow page's grid).
 *
 * Eggs is the one that belongs to the ＋ Log: it opens the Log's eggs form on
 * this flock, closing back here. The rest have no Log kind — the Log's who
 * step only answers for animals, and a flock is not one — so each opens the
 * screen's own form as a side panel on this page: the headcount log's form,
 * the coop, a dated note. Photo is the camera, straight away, through the
 * same photo pipeline an animal's photos use.
 *
 * No Treatment: health records are written against an animal, and there is
 * no flock-level treatment in the data to write to.
 */

export type FlockAction = "headcount" | "move" | "note";

const TILE =
  "flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-density border border-rule bg-panel px-1 text-[13px] font-medium text-ink hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action";

export function FlockActions({
  flockId,
  propertyId,
  actorId,
  onAction,
}: {
  readonly flockId: Ulid;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  /** Opens one of the page's own panels. */
  readonly onAction: (action: FlockAction) => void;
}) {
  const pathname = usePathname();

  const panel = (action: FlockAction, label: string, icon: ReactNode) => (
    <button type="button" aria-haspopup="dialog" onClick={() => onAction(action)} className={TILE}>
      {icon}
      {label}
    </button>
  );

  return (
    <nav aria-label="Log for this flock" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
      <Link href={logHref({ kind: "eggs", flock: flockId, from: pathname })} className={TILE}>
        <Icon>
          <path d="M12 3c-3.5 0-6 5-6 9a6 6 0 0 0 12 0c0-4-2.5-9-6-9z" />
        </Icon>
        Collect eggs
      </Link>
      {panel(
        "headcount",
        "Headcount",
        <Icon>
          <path d="M12 4v8M8 8h8M8 18h8" />
        </Icon>,
      )}
      {panel(
        "move",
        "Move",
        <Icon>
          <path d="M5 12h14" />
          <path d="M13 6l6 6-6 6" />
        </Icon>,
      )}
      {panel(
        "note",
        "Note",
        <Icon>
          <path d="M6 3h9l4 4v14H6z" />
          <path d="M9 12h7M9 16h5" />
        </Icon>,
      )}
      <PhotoTile flockId={flockId} propertyId={propertyId} actorId={actorId} />
    </nav>
  );
}

function PhotoTile({
  flockId,
  propertyId,
  actorId,
}: {
  readonly flockId: Ulid;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const intake = useAttachPhotos({ propertyId, actorId, ownerEntity: "Flock", ownerId: flockId });
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
        // No `capture`: it forces the camera, and a phone then never offers
        // its photo library — a picture already taken could not be added.
        // Without it the phone asks "Take Photo or Choose from Library".
        multiple
        aria-label="Photo"
        aria-busy={intake.busy}
        disabled={intake.busy}
        onChange={pick}
        className="sr-only"
      />
      <Icon>
        <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
        <circle cx="12" cy="13" r="3.5" />
      </Icon>
      {intake.busy ? "Adding…" : "Photo"}
    </label>
  );
}

/** Line icons, one stroke weight, in the action colour — the cow page's set. */
function Icon({ children }: { readonly children: ReactNode }) {
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
      {children}
    </svg>
  );
}
