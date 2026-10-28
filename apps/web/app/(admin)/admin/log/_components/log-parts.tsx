"use client";

import type { ReactNode } from "react";

import { Button } from "@galaxy-farm/ui";
import { displayName, type Animal, type CrudError, type Ulid } from "@galaxy-farm/core";

import type { LogKind } from "./log-kinds";

/**
 * The pieces every step-3 form shares: the heading, the "For …" line, the
 * fields, and a save button pinned to the bottom of the screen.
 */

/** What step 4 says about what was just written. */
export interface SavedSummary {
  /** "Saved for 3 animals" — or, for a basket of eggs, what was saved. */
  readonly headline: string;
  readonly detail?: string | undefined;
  /** A follow-up decision, such as raising a dam's safety level after a calving. */
  readonly followUp?: ReactNode;
}

/** Everything a step-3 form is handed. */
export interface DetailsProps {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly kind: LogKind;
  /** Switches between the two kinds on a shared tile (heat ↔ breeding). */
  readonly onKind: (kind: LogKind) => void;
  /** The chosen animals, in the order they were picked. */
  readonly animals: readonly Animal[];
  readonly onSaved: (summary: SavedSummary) => void;
}

export function whoLine(animals: readonly Animal[]): string {
  const names = animals.map((animal) => displayName(animal));
  if (names.length <= 4) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}

export function forCount(count: number): string {
  return `${count} animal${count === 1 ? "" : "s"}`;
}

export function errorText(error: CrudError): string {
  return error.kind === "validation"
    ? (error.issues[0]?.message ?? "That is not valid")
    : "Could not save that";
}

/**
 * Midday local for a date field — the convention every screen on the farm
 * writes with, so a date never renders as the day before.
 */
export function atNoon(value: string): Date {
  return new Date(`${value}T12:00:00`);
}

export function todayValue(): string {
  return new Date().toISOString().slice(0, 10);
}

export function DetailsForm({
  title,
  who,
  switcher,
  onSubmit,
  submitLabel,
  submitDisabled = false,
  busy,
  error,
  children,
}: {
  readonly title: string;
  /** "For Rosie, Pearl" — absent for kinds with no animals. */
  readonly who?: string | undefined;
  /** The heat/breeding or note/photo toggle, under the heading. */
  readonly switcher?: ReactNode;
  readonly onSubmit: () => void;
  readonly submitLabel: string;
  readonly submitDisabled?: boolean;
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <StepBody>
        <div className="flex flex-col gap-1">
          <h1 className="text-ink">{title}</h1>
          {who === undefined ? null : <p className="text-sm text-muted">For {who}</p>}
        </div>
        {switcher}
        {children}
        {error === undefined ? null : (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </StepBody>
      <StepFooter>
        <Button
          type="submit"
          variant="primary"
          block
          busy={busy}
          disabled={submitDisabled}
          className="min-h-14 text-base"
        >
          {submitLabel}
        </Button>
      </StepFooter>
    </form>
  );
}

/** The scrolling middle of a step. */
export function StepBody({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-density overflow-y-auto px-4 pb-6 pt-1 md:overflow-visible md:px-0">
      {children}
    </div>
  );
}

/** The bar the primary action lives in, pinned to the bottom. */
export function StepFooter({ children }: { readonly children: ReactNode }) {
  return (
    <div className="border-t border-rule bg-panel px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 md:sticky md:bottom-0 md:mt-2 md:bg-canvas md:px-0 md:pb-4">
      {children}
    </div>
  );
}

/** Two kinds on one tile, switched with a pair of pills. */
export function KindSwitch({
  kind,
  options,
  onKind,
}: {
  readonly kind: LogKind;
  readonly options: readonly { readonly kind: LogKind; readonly label: string }[];
  readonly onKind: (kind: LogKind) => void;
}) {
  return (
    <div role="group" aria-label="What to log" className="flex gap-2">
      {options.map((option) => (
        <button
          key={option.kind}
          type="button"
          aria-pressed={kind === option.kind}
          onClick={() => onKind(option.kind)}
          className={[
            "inline-flex min-h-target items-center rounded-full border px-4 text-sm font-medium",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action",
            kind === option.kind
              ? "border-action bg-action text-action-ink"
              : "border-edge bg-panel text-ink hover:bg-raised",
          ].join(" ")}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
