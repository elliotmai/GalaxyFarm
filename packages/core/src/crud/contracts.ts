import type { z } from "zod";

import type { BaseRecord } from "../entities/record.js";
import type { Result } from "../types/result.js";
import type { Ulid } from "../types/ids.js";
import type { RelationshipDeclaration } from "./delete-behavior.js";

/**
 * The shape every CRUD-able entity satisfies (spec §4.5 clause 1).
 *
 * Declaring the surface as a type rather than trusting each module to remember
 * it is what lets the conformance gate be mechanical: an entity either has all
 * five operations or it does not compile.
 */

export const CRUD_OPERATIONS = ["create", "get", "list", "update", "delete"] as const;
export type CrudOperation = (typeof CRUD_OPERATIONS)[number];

/** Why an entity may legitimately skip part of the surface (§4.5, closed list). */
export type CrudExemptionReason =
  "derived-read-model" | "immutable-legal-record" | "immutable-audit-record" | "system-owned";

export interface EntityDefinition<T extends BaseRecord> {
  /** Entity name as it appears in the spec, e.g. `CattleProfile`. */
  readonly name: string;
  /** The single schema shared by forms, sync payloads, and API handlers. */
  readonly schema: z.ZodType<T>;
  /** Every outbound reference, with its declared delete behaviour. */
  readonly relationships: readonly RelationshipDeclaration[];
  /** Aggregate roots always demand a Typed-tier confirmation to delete. */
  readonly isAggregateRoot: boolean;
  /** Set only for entities on the §4.5 exception list. */
  readonly exemption?: { readonly reason: CrudExemptionReason; readonly detail: string };
}

export interface ListQuery {
  readonly propertyId: Ulid;
  /** Trash is the only caller that passes `true`. */
  readonly includeDeleted?: boolean;
  readonly limit?: number;
  readonly offset?: number;
  readonly search?: string;
}

export type CrudError =
  | { readonly kind: "not-found"; readonly entity: string; readonly id: Ulid }
  | { readonly kind: "validation"; readonly issues: readonly z.ZodIssue[] }
  | { readonly kind: "invariant"; readonly message: string }
  | { readonly kind: "blocked"; readonly message: string; readonly blockedBy: readonly string[] }
  | { readonly kind: "forbidden"; readonly capability: string };

/**
 * The full surface. `delete` is soft — there is no hard-delete operation here
 * on purpose; purge is a separate, owner-only use case (§4.5 clause 4).
 */
export interface CrudUseCases<T extends BaseRecord> {
  create(input: unknown): Promise<Result<T, CrudError>>;
  get(id: Ulid): Promise<Result<T, CrudError>>;
  list(query: ListQuery): Promise<Result<T[], CrudError>>;
  update(id: Ulid, patch: unknown): Promise<Result<T, CrudError>>;
  delete(id: Ulid, by: Ulid, reason?: string): Promise<Result<T, CrudError>>;
}

/** Does this definition satisfy clause 1, or is it exempt? */
export function isCrudComplete(
  definition: Pick<EntityDefinition<BaseRecord>, "exemption">,
  operations: readonly string[],
): boolean {
  if (definition.exemption !== undefined) return true;
  return CRUD_OPERATIONS.every((operation) => operations.includes(operation));
}

export function missingOperations(operations: readonly string[]): CrudOperation[] {
  return CRUD_OPERATIONS.filter((operation) => !operations.includes(operation));
}

/**
 * Validate at the boundary (§4.5 clause 2). Every entry point calls this — the
 * form, the API handler, and the sync push handler alike. Data arriving from a
 * local store is not trusted just because it came from our own client.
 */
export function validate<T>(schema: z.ZodType<T>, input: unknown): Result<T, CrudError> {
  const parsed = schema.safeParse(input);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: { kind: "validation", issues: parsed.error.issues } };
}
