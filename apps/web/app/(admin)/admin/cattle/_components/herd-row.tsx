"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { Pill, SafetyBadge, type Tone } from "@galaxy-farm/ui";
import { ageInDays, type Animal, type SafetyLevel } from "@galaxy-farm/core";

/**
 * One animal in the herd list (spec §7, §8).
 *
 * The anatomy is fixed, and it is fixed small on purpose: the tag, the name,
 * one muted line, and at most one chip. A row is for finding the animal, not
 * for reading her — the old table carried breed, status, pen, handling level
 * and withdrawal side by side, and on a phone that became a card per cow with
 * seven labelled pairs in it, which is a list nobody scans. Everything that
 * was dropped is one tap away on her own page.
 *
 * The one chip is the most important thing that is true of her today, chosen
 * by `flagFor` below rather than by whichever column happened to come first.
 */

/** The single state a row is allowed to shout about. */
export type HerdFlag =
  | { readonly kind: "pill"; readonly tone: Tone; readonly label: string }
  | { readonly kind: "safety"; readonly level: SafetyLevel };

export interface HerdRowProps {
  readonly animal: Animal;
  readonly href: string;
  readonly title: string;
  /** "Cow · 7 yr · Pasture 3" — already joined, so the row stays dumb. */
  readonly line: string;
  readonly flag?: HerdFlag | undefined;
  readonly onEdit: () => void;
}

export function HerdRow({ animal, href, title, line, flag, onEdit }: HerdRowProps) {
  return (
    <li className="flex items-center bg-panel">
      {/*
        The whole row is the link. A row whose only target is the name puts
        the smallest thing on the screen in front of the most common action,
        and on a phone that is a thumb landing on the muted line and nothing
        happening.
      */}
      <Link
        href={href}
        className="flex min-h-[66px] min-w-0 flex-1 items-center gap-3 py-2 pl-4 pr-2 text-ink hover:bg-canvas focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-action"
      >
        <TagBadge tag={animal.tagNumber} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate font-semibold">{title}</span>
          {line === "" ? null : <span className="truncate text-sm text-muted">{line}</span>}
        </span>
        {flag === undefined ? null : <span className="shrink-0">{renderFlag(flag)}</span>}
      </Link>

      {/*
        Beside the link rather than inside it — a button nested in an anchor is
        two targets the browser has to guess between. The editor is where pen,
        barn and delete now live, so this is the one way to all three.
      */}
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${title}`}
        className="mr-1 inline-flex min-h-target min-w-target shrink-0 items-center justify-center rounded-full text-muted hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-action"
      >
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 20h4L19 9l-4-4L4 16z" />
          <path d="M13.5 6.5l4 4" />
        </svg>
      </button>
    </li>
  );
}

/**
 * The ear tag, in a round badge.
 *
 * Round while the tag is short, which nearly all of them are, and stretching
 * into a lozenge rather than truncating when it is not: half a tag number is
 * the wrong tag number. No tag reads as a dash, hidden from a screen reader,
 * because "dash" in front of every untagged calf's name is noise.
 */
function TagBadge({ tag }: { readonly tag: string | undefined }) {
  const has = tag !== undefined && tag !== "";
  return (
    <span
      aria-hidden={has ? undefined : true}
      className="gf-numeric flex h-[42px] min-w-[42px] max-w-[5.5rem] shrink-0 items-center justify-center rounded-full bg-raised px-2 text-[13px] font-semibold text-action"
    >
      <span className="truncate">{has ? tag : "–"}</span>
    </span>
  );
}

function renderFlag(flag: HerdFlag): ReactNode {
  return flag.kind === "safety" ? (
    <SafetyBadge level={flag.level} size="compact" />
  ) : (
    <Pill tone={flag.tone}>{flag.label}</Pill>
  );
}

/** What matters about an animal today, in the order it matters. */
export interface FlagInput {
  readonly animal: Animal;
  readonly withdrawn: boolean;
  readonly unplaced: boolean;
  readonly due: Date | undefined;
  readonly now: Date;
}

/**
 * The one chip, chosen.
 *
 * In order: an animal that is not working here any more — sold, dead, retired
 * — is that before it is anything else; then a withdrawal, because that one sends meat or milk somewhere it
 * must not go; then a handling level that hurts people; then a calving; and
 * then a record with no pen, which is real but is paperwork; and a boarded
 * calf last of all. Levels below 4
 * stay off the list — a row of green chips is a row nobody reads, and the
 * level is on her page and on the pen board.
 */
export function flagFor({
  animal,
  withdrawn,
  unplaced,
  due,
  now,
}: FlagInput): HerdFlag | undefined {
  if (animal.status !== "active" && animal.status !== "boarding") {
    return { kind: "pill", tone: "neutral", label: capitalise(animal.status) };
  }
  if (withdrawn) return { kind: "pill", tone: "danger", label: "Withdrawal" };
  if (animal.safetyLevel >= 4) return { kind: "safety", level: animal.safetyLevel };
  if (due !== undefined) return { kind: "pill", tone: "action", label: dueLabel(due, now) };
  if (unplaced) return { kind: "pill", tone: "danger", label: "No pen" };
  // Somebody else's calf, here on purpose — worth knowing, never urgent.
  if (animal.status === "boarding") return { kind: "pill", tone: "identity", label: "Boarding" };
  return undefined;
}

const DAY = 86_400_000;

/**
 * "Due Sun", the way it is said in the yard.
 *
 * A weekday inside the week, because that is how a calving is talked about
 * and a date has to be converted in somebody's head first; a date past that,
 * because "Due Tue" a fortnight out is ambiguous. Counted in calendar days,
 * not elapsed hours, so a cow due tomorrow morning is "tomorrow" at 9pm.
 */
export function dueLabel(due: Date, now: Date): string {
  const days = Math.round((startOfDay(due) - startOfDay(now)) / DAY);
  if (days < 0) return `Overdue ${-days}d`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days < 7) return `Due ${due.toLocaleDateString(undefined, { weekday: "short" })}`;
  return `Due ${due.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

/**
 * Age in the unit somebody would use: days for the first fortnight, weeks to
 * three months, months to two years, years after that. A tilde marks a birth
 * date that is a guess, because every age-based rule reads the estimate flag
 * and the row should not look surer than the record is.
 */
export function ageLabel(animal: Pick<Animal, "dob" | "dobIsEstimate">, now: Date): string {
  const days = ageInDays(animal, now);
  if (days === undefined || days < 0) return "";
  const prefix = animal.dobIsEstimate ? "~" : "";
  if (days < 14) return `${prefix}${days} d`;
  if (days < 91) return `${prefix}${Math.floor(days / 7)} wk`;
  if (days < 730) return `${prefix}${Math.floor(days / 30.437)} mo`;
  return `${prefix}${Math.floor(days / 365.25)} yr`;
}

function startOfDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
