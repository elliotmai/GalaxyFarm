import type { ConfirmationTier } from "@galaxy-farm/core";

/**
 * Spec §4.5 clause 3: no delete, anywhere, on any surface, happens on a single
 * unconfirmed tap.
 *
 * The types here exist to make the *weak* version hard to write. A generic
 * "Are you sure?" does not satisfy the clause, so `recordName` is required and
 * `dependents` is not optional — a caller that has not looked up what else is
 * affected has to say so explicitly by passing an empty array.
 */

export type { ConfirmationTier };

export interface AffectedRecord {
  /** What it is: "Animal", "Zone assignment", "Weight record". */
  readonly entity: string;
  /** What it is called: "Dolly", "North Trap". */
  readonly label: string;
  /** How this record is affected if the delete proceeds. */
  readonly effect: "deleted" | "detached";
}

export interface ConfirmRequest {
  /**
   * No default, deliberately. Picking a tier is a decision each call site
   * makes knowingly; a default would quietly make everything Standard.
   */
  readonly tier: ConfirmationTier;
  /** What is being deleted, by name. Shown verbatim in the dialog. */
  readonly recordName: string;
  /** What kind of thing it is: "pen", "animal", "egg log". */
  readonly entity: string;
  /** Everything else the delete touches. Pass `[]` if genuinely nothing. */
  readonly dependents: readonly AffectedRecord[];
  /** For a bulk delete: how many records. Bulk is never Standard tier. */
  readonly bulkCount?: number;
  /** Extra context — "This cannot be undone once purged." */
  readonly consequence?: string;
  /** Kiosk PIN gate for the Elevated tier. */
  readonly pin?: string;
  /** Verb for the confirm button. Defaults to "Delete". */
  readonly action?: string;
}

export class InvalidConfirmRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfirmRequestError";
  }
}

/**
 * Reject requests that would produce a dialog too weak to satisfy §4.5.
 *
 * Called before anything renders, so a bad call site fails loudly in
 * development rather than shipping a confirmation that says nothing.
 */
export function assertValidRequest(request: ConfirmRequest): void {
  if (request.recordName.trim() === "") {
    throw new InvalidConfirmRequestError(
      "A confirmation must name the record being deleted (spec §4.5 clause 3). " +
        'A generic "Are you sure?" does not satisfy the clause.',
    );
  }

  const count = request.bulkCount ?? 1;
  if (count > 1 && request.tier === "standard") {
    throw new InvalidConfirmRequestError(
      `Bulk deletes are at least Elevated tier (spec §4.5). Got ${count} records at Standard.`,
    );
  }

  if (request.tier === "elevated" && request.pin !== undefined && request.pin.trim() === "") {
    throw new InvalidConfirmRequestError(
      "A kiosk PIN gate needs a non-empty PIN to compare against.",
    );
  }
}

/** The headline. Bulk deletes state the exact count (§4.5). */
export function confirmTitle(request: ConfirmRequest): string {
  const action = request.action ?? "Delete";
  const count = request.bulkCount ?? 1;

  return count > 1
    ? `${action} ${count} ${request.entity} records?`
    : `${action} ${request.entity} ${request.recordName}?`;
}

/**
 * The sentence that does the real work — naming what else is affected.
 * Returns undefined when nothing else is, so the dialog can omit the line
 * rather than saying "0 records are affected".
 */
export function dependentSummary(dependents: readonly AffectedRecord[]): string | undefined {
  if (dependents.length === 0) return undefined;

  const deleted = dependents.filter((d) => d.effect === "deleted").length;
  const detached = dependents.filter((d) => d.effect === "detached").length;

  const parts: string[] = [];
  if (deleted > 0) parts.push(`${deleted} ${deleted === 1 ? "record" : "records"} will be deleted`);
  if (detached > 0) {
    parts.push(`${detached} ${detached === 1 ? "record" : "records"} will lose the reference`);
  }
  return parts.join("; ");
}
