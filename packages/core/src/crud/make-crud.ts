import type { z } from "zod";

import { assessDeleteImpact, type Dependent, type DeleteImpact } from "./delete-behavior.js";
import {
  validate,
  type CrudError,
  type CrudUseCases,
  type EntityDefinition,
  type ListQuery,
} from "./contracts.js";
import { restore, softDelete, type BaseRecord } from "../entities/record.js";
import { err, ok, type Result } from "../types/result.js";
import type { Clock, Repository } from "../ports/index.js";
import type { Ulid } from "../types/ids.js";

/**
 * One implementation of the §4.5 surface, shared by every entity.
 *
 * Written once and tested once, rather than hand-rolled per module where the
 * fifth entity is where somebody forgets the tombstone. Modules supply the
 * entity definition and whatever invariants Zod cannot express; everything
 * else — validation at the boundary, soft delete, restrict/cascade/detach —
 * comes from here.
 */

export interface CrudDependencies<T extends BaseRecord> {
  readonly definition: EntityDefinition<T>;
  readonly repository: Repository<T>;
  readonly clock: Clock;
  /**
   * Domain invariants Zod cannot express: a calving date that cannot precede
   * its breeding date, a straw count that cannot go negative. Enforced in the
   * use case, not in the form (§4.5 clause 2).
   */
  readonly invariants?: (record: T) => Result<T, CrudError>;
  /** Looks up what a delete would affect, keyed by relationship. */
  readonly findDependents?: (id: Ulid) => Promise<ReadonlyMap<string, readonly Dependent[]>>;
  /** Executes cascades and detaches once the delete is allowed to proceed. */
  readonly applyImpact?: (impact: DeleteImpact, at: Date, by: Ulid) => Promise<void>;
}

export interface CrudUseCasesWithTrash<T extends BaseRecord> extends CrudUseCases<T> {
  /** Preview what a delete would do — feeds the confirmation dialog. */
  previewDelete(id: Ulid): Promise<Result<DeleteImpact, CrudError>>;
  restore(id: Ulid): Promise<Result<T, CrudError>>;
  /** Permanent. Owner-only, Typed-tier at the UI layer (§4.5 clause 4). */
  purge(id: Ulid): Promise<Result<void, CrudError>>;
}

export function makeCrudUseCases<T extends BaseRecord>(
  deps: CrudDependencies<T>,
): CrudUseCasesWithTrash<T> {
  const { definition, repository, clock } = deps;
  const schema = definition.schema as z.ZodType<T>;

  const notFound = (id: Ulid): CrudError => ({
    kind: "not-found",
    entity: definition.name,
    id,
  });

  const check = (record: T): Result<T, CrudError> =>
    deps.invariants === undefined ? ok(record) : deps.invariants(record);

  const load = async (id: Ulid): Promise<Result<T, CrudError>> => {
    const found = await repository.findById(id);
    return found === undefined ? err(notFound(id)) : ok(found);
  };

  return {
    async create(input) {
      const parsed = validate(schema, input);
      if (!parsed.ok) return parsed;

      const checked = check(parsed.value);
      if (!checked.ok) return checked;

      await repository.save(checked.value);
      return ok(checked.value);
    },

    async get(id) {
      const found = await load(id);
      // A soft-deleted record is not "found" on the normal read path; Trash
      // reaches it through list({ includeDeleted: true }).
      if (found.ok && found.value.deletedAt !== undefined) return err(notFound(id));
      return found;
    },

    async list(query: ListQuery) {
      return ok(await repository.list(query));
    },

    async update(id, patch) {
      const existing = await load(id);
      if (!existing.ok) return existing;
      if (existing.value.deletedAt !== undefined) return err(notFound(id));

      const merged = {
        ...existing.value,
        ...(patch as Partial<T>),
        // Identity and provenance are not patchable.
        id: existing.value.id,
        propertyId: existing.value.propertyId,
        createdAt: existing.value.createdAt,
        updatedAt: clock.now(),
      };

      const parsed = validate(schema, merged);
      if (!parsed.ok) return parsed;

      const checked = check(parsed.value);
      if (!checked.ok) return checked;

      await repository.save(checked.value);
      return ok(checked.value);
    },

    async previewDelete(id) {
      const existing = await load(id);
      if (!existing.ok) return existing;

      const dependents =
        deps.findDependents === undefined ? new Map() : await deps.findDependents(id);
      return ok(assessDeleteImpact(definition.relationships, dependents));
    },

    async delete(id, by, reason) {
      const existing = await load(id);
      if (!existing.ok) return existing;
      if (existing.value.deletedAt !== undefined) return err(notFound(id));

      const dependents =
        deps.findDependents === undefined ? new Map() : await deps.findDependents(id);
      const impact = assessDeleteImpact(definition.relationships, dependents);

      if (!impact.allowed) {
        return err({
          kind: "blocked",
          message:
            `${definition.name} cannot be deleted while other records depend on it. ` +
            `Remove or reassign them first.`,
          blockedBy: impact.blockedBy.map((d) => `${d.entity} ${d.label}`),
        });
      }

      const at = clock.now();
      const deleted = softDelete(existing.value, at, by, reason);
      await repository.save(deleted);
      await deps.applyImpact?.(impact, at, by);

      return ok(deleted);
    },

    async restore(id) {
      const existing = await load(id);
      if (!existing.ok) return existing;
      if (existing.value.deletedAt === undefined) {
        return err({ kind: "invariant", message: `${definition.name} is not deleted` });
      }

      const restored = restore(existing.value, clock.now());
      await repository.save(restored);
      return ok(restored);
    },

    async purge(id) {
      const existing = await load(id);
      if (!existing.ok) return existing;
      if (existing.value.deletedAt === undefined) {
        return err({
          kind: "invariant",
          message: `Purge only removes records already in Trash. Delete ${definition.name} first.`,
        });
      }

      await repository.purge(id);
      return ok(undefined);
    },
  };
}
