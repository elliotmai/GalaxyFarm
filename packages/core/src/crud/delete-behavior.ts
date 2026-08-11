import type { Ulid } from "../types/ids.js";

/**
 * Every relationship declares what happens to its dependents when the parent is
 * deleted (spec §4.5). A relationship with no declared behaviour is a build
 * error, not a runtime surprise — which is why `DeleteBehavior` has no default.
 */

export type DeleteBehavior =
  /** Block the delete and say what is in the way. */
  | "restrict"
  /** Delete the dependents too — and list them in the confirmation. */
  | "cascade"
  /** Null the reference, keep the dependent. */
  | "detach";

export interface RelationshipDeclaration {
  /** The entity that owns the reference, e.g. `ZoneAssignment`. */
  readonly from: string;
  /** The entity being pointed at, e.g. `Zone`. */
  readonly to: string;
  /** Field on `from` holding the reference. */
  readonly field: string;
  readonly onDelete: DeleteBehavior;
  /** Why this behaviour is right. Future-you deletes something and reads this. */
  readonly rationale: string;
}

export interface Dependent {
  readonly entity: string;
  readonly id: Ulid;
  /** Human-readable, for the confirmation dialog. "North Trap", "Dolly". */
  readonly label: string;
}

export interface DeleteImpact {
  /** True when nothing blocks the delete. */
  readonly allowed: boolean;
  /** Dependents that block it — non-empty only when `allowed` is false. */
  readonly blockedBy: readonly Dependent[];
  /** Dependents that will be deleted alongside it. */
  readonly cascades: readonly Dependent[];
  /** Dependents that will lose their reference but survive. */
  readonly detaches: readonly Dependent[];
}

/**
 * Work out what deleting a record actually does.
 *
 * The result feeds the confirmation dialog directly, which is the point: §4.5
 * requires the dialog to name what else is affected, and it can only do that if
 * something computed the list first.
 */
export function assessDeleteImpact(
  relationships: readonly RelationshipDeclaration[],
  dependentsByRelationship: ReadonlyMap<string, readonly Dependent[]>,
): DeleteImpact {
  const blockedBy: Dependent[] = [];
  const cascades: Dependent[] = [];
  const detaches: Dependent[] = [];

  for (const relationship of relationships) {
    const key = relationshipKey(relationship);
    const dependents = dependentsByRelationship.get(key) ?? [];
    if (dependents.length === 0) continue;

    switch (relationship.onDelete) {
      case "restrict":
        blockedBy.push(...dependents);
        break;
      case "cascade":
        cascades.push(...dependents);
        break;
      case "detach":
        detaches.push(...dependents);
        break;
    }
  }

  return { allowed: blockedBy.length === 0, blockedBy, cascades, detaches };
}

export function relationshipKey(relationship: RelationshipDeclaration): string {
  return `${relationship.from}.${relationship.field}->${relationship.to}`;
}

/**
 * Which confirmation tier a delete needs (spec §4.5).
 *
 * Deliberately a function of the impact rather than a per-screen choice, so two
 * screens deleting the same thing cannot disagree about how dangerous it is.
 */
export type ConfirmationTier = "standard" | "elevated" | "typed";

export function requiredTier(input: {
  readonly impact: DeleteImpact;
  /** Aggregate roots — an animal, a zone, a contact — are always Typed. */
  readonly isAggregateRoot: boolean;
  readonly onKiosk: boolean;
  readonly bulkCount?: number;
}): ConfirmationTier {
  if (input.isAggregateRoot) return "typed";

  const hasDependents = input.impact.cascades.length > 0 || input.impact.detaches.length > 0;
  const isBulk = (input.bulkCount ?? 1) > 1;

  if (hasDependents || input.onKiosk || isBulk) return "elevated";
  return "standard";
}
