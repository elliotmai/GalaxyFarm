"use client";

import Link from "next/link";

import { Pill, SafetyBadge } from "@galaxy-farm/ui";

import type { AnimalEntry } from "@/app/(admin)/admin/animals/_components/animal-entries";

/**
 * One row of the Animals list: the badge, the name, one muted line, at most
 * one chip — the herd row's anatomy, for every species.
 *
 * Two shapes. Browsing, the whole row is a link to the animal. Selecting, the
 * whole row is a checkbox, so there is never a link and a toggle fighting over
 * the same thumb.
 */

const ROW =
  "flex min-h-[66px] w-full min-w-0 items-center gap-3 py-2 pl-4 pr-3 text-left text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-action";

export function AnimalListRow({
  entry,
  selecting,
  selected,
  onToggle,
}: {
  readonly entry: AnimalEntry;
  readonly selecting: boolean;
  readonly selected: boolean;
  readonly onToggle: () => void;
}) {
  const body = (
    <>
      {!selecting ? null : entry.selectable ? (
        <Tick on={selected} />
      ) : (
        <span aria-hidden="true" className="w-[26px] shrink-0" />
      )}
      <Badge text={entry.badge} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-semibold">{entry.title}</span>
        {entry.line === "" ? null : (
          <span className="truncate text-sm text-muted">{entry.line}</span>
        )}
      </span>
      {entry.flag === undefined ? null : (
        <span className="shrink-0">
          {entry.flag.kind === "safety" ? (
            <SafetyBadge level={entry.flag.level} size="compact" />
          ) : (
            <Pill tone={entry.flag.tone}>{entry.flag.label}</Pill>
          )}
        </span>
      )}
    </>
  );

  return (
    <li className={selected ? "bg-action/10" : "bg-panel"}>
      {selecting && !entry.selectable ? (
        // Shown, so the list does not jump when Select is pressed, but not a
        // control — see `selectable`.
        <div className={`${ROW} opacity-50`}>{body}</div>
      ) : selecting ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={entry.title}
          onClick={onToggle}
          className={`${ROW} hover:bg-canvas`}
        >
          {body}
        </button>
      ) : (
        <Link href={entry.href} className={`${ROW} hover:bg-canvas`}>
          {body}
        </Link>
      )}
    </li>
  );
}

/**
 * The round badge. Stretches into a lozenge rather than truncating a long
 * tag — half a tag number is the wrong tag number — and an untagged calf is a
 * dash hidden from a screen reader, as on the herd.
 */
function Badge({ text }: { readonly text: string | undefined }) {
  return (
    <span
      aria-hidden={text === undefined ? true : undefined}
      className="gf-numeric flex h-[42px] min-w-[42px] max-w-[5.5rem] shrink-0 items-center justify-center rounded-full bg-raised px-2 text-[13px] font-semibold text-action"
    >
      <span className="truncate">{text ?? "–"}</span>
    </span>
  );
}

/** The drawn checkbox. The row itself carries the checkbox role and state. */
function Tick({ on }: { readonly on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={[
        "flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-density border-2",
        on ? "border-action bg-action text-action-ink" : "border-edge bg-panel",
      ].join(" ")}
    >
      {on ? (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12l5 5L20 7" />
        </svg>
      ) : null}
    </span>
  );
}
