import { describe, expect, it } from "vitest";
import { z } from "zod";

import { makeCrudUseCases } from "../src/crud/make-crud.js";
import { InMemoryRepository } from "../src/testing/in-memory-repository.js";
import { baseRecordSchema, type BaseRecord } from "../src/entities/record.js";
import { fixedClock } from "../src/ports/index.js";
import { encodeUlid, type Ulid } from "../src/types/ids.js";
import { err, ok } from "../src/types/result.js";
import {
  relationshipKey,
  type Dependent,
  type RelationshipDeclaration,
} from "../src/crud/delete-behavior.js";
import type { EntityDefinition } from "../src/crud/contracts.js";

/**
 * One implementation of the §4.5 surface serves every entity, so it is worth
 * testing hard. A fictional `Widget` keeps the tests about the mechanism
 * rather than about cattle.
 */

let counter = 0;
const nextId = (): Ulid => encodeUlid(9_000 + counter++, () => 0.5);

const propertyId = nextId();
const userId = nextId();
const now = new Date("2026-04-01T00:00:00Z");
const later = new Date("2026-04-02T00:00:00Z");

interface Widget extends BaseRecord {
  readonly name: string;
  readonly count: number;
}

const widgetSchema = baseRecordSchema.extend({
  name: z.string().min(1),
  count: z.number().int().nonnegative(),
}) as unknown as z.ZodType<Widget>;

const childRelationship: RelationshipDeclaration = {
  from: "Gadget",
  to: "Widget",
  field: "widgetId",
  onDelete: "restrict",
  rationale: "a gadget without its widget is meaningless",
};

const definition = (
  relationships: readonly RelationshipDeclaration[] = [],
): EntityDefinition<Widget> => ({
  name: "Widget",
  schema: widgetSchema,
  relationships,
  isAggregateRoot: false,
});

const widget = (overrides: Partial<Widget> = {}): Widget => ({
  id: nextId(),
  propertyId,
  createdAt: now,
  updatedAt: now,
  name: "Bale spear",
  count: 1,
  ...overrides,
});

function setup(
  options: {
    relationships?: readonly RelationshipDeclaration[];
    dependents?: readonly Dependent[];
    invariants?: (record: Widget) => ReturnType<typeof ok<Widget>> | ReturnType<typeof err<never>>;
    clockAt?: Date;
  } = {},
) {
  const repository = new InMemoryRepository<Widget>(["name"]);
  const relationships = options.relationships ?? [];

  const crud = makeCrudUseCases<Widget>({
    definition: definition(relationships),
    repository,
    clock: fixedClock(options.clockAt ?? later),
    ...(options.invariants ? { invariants: options.invariants } : {}),
    ...(options.dependents
      ? {
          findDependents: async () =>
            new Map(relationships.map((r) => [relationshipKey(r), options.dependents ?? []])),
        }
      : {}),
  });

  return { crud, repository };
}

describe("create", () => {
  it("validates at the boundary and stores the record", async () => {
    const { crud, repository } = setup();
    const result = await crud.create(widget());

    expect(result.ok).toBe(true);
    expect(repository.size()).toBe(1);
  });

  it("rejects invalid input with the failing issues", async () => {
    const { crud, repository } = setup();
    const result = await crud.create(widget({ name: "", count: -1 }));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe("validation");
    expect(repository.size()).toBe(0);
  });

  it("enforces invariants Zod cannot express", async () => {
    // "A calving date cannot precede its breeding date" lives here, not in
    // the form (§4.5 clause 2).
    const { crud } = setup({
      invariants: (record) =>
        record.count > 10 ? err({ kind: "invariant", message: "too many" }) : ok(record),
    });

    expect((await crud.create(widget({ count: 11 }))).ok).toBe(false);
    expect((await crud.create(widget({ count: 2 }))).ok).toBe(true);
  });

  it("does not trust data just because it arrived as an object", async () => {
    const { crud } = setup();

    expect((await crud.create(null)).ok).toBe(false);
    expect((await crud.create({ id: "not-a-ulid" })).ok).toBe(false);
  });
});

describe("get", () => {
  it("returns a stored record", async () => {
    const { crud } = setup();
    const created = await crud.create(widget());
    if (!created.ok) throw new Error("setup failed");

    const found = await crud.get(created.value.id);
    expect(found.ok && found.value.name).toBe("Bale spear");
  });

  it("reports not-found for an unknown id", async () => {
    const { crud } = setup();
    const result = await crud.get(nextId());

    expect(!result.ok && result.error.kind).toBe("not-found");
  });

  it("hides a soft-deleted record from the normal read path", async () => {
    const { crud } = setup();
    const created = await crud.create(widget());
    if (!created.ok) throw new Error("setup failed");
    await crud.delete(created.value.id, userId);

    expect((await crud.get(created.value.id)).ok).toBe(false);
  });
});

describe("list", () => {
  it("excludes tombstones by default and includes them for Trash", async () => {
    const { crud } = setup();
    const a = await crud.create(widget({ name: "Kept" }));
    const b = await crud.create(widget({ name: "Binned" }));
    if (!a.ok || !b.ok) throw new Error("setup failed");
    await crud.delete(b.value.id, userId);

    const live = await crud.list({ propertyId });
    const trash = await crud.list({ propertyId, includeDeleted: true });

    expect(live.ok && live.value.map((w) => w.name)).toEqual(["Kept"]);
    expect(trash.ok && trash.value).toHaveLength(2);
  });

  it("scopes to a property, so a second location is a filter not a migration", async () => {
    const { crud } = setup();
    await crud.create(widget());
    await crud.create(widget({ propertyId: nextId() }));

    const result = await crud.list({ propertyId });
    expect(result.ok && result.value).toHaveLength(1);
  });

  it("searches, paginates, and counts", async () => {
    const { crud, repository } = setup();
    await crud.create(widget({ name: "Hay ring" }));
    await crud.create(widget({ name: "Hay spear" }));
    await crud.create(widget({ name: "Mineral tub" }));

    const search = await crud.list({ propertyId, search: "hay" });
    expect(search.ok && search.value).toHaveLength(2);

    const page = await crud.list({ propertyId, limit: 2 });
    expect(page.ok && page.value).toHaveLength(2);

    expect(await repository.count({ propertyId })).toBe(3);
  });
});

describe("update", () => {
  it("merges the patch and stamps updatedAt", async () => {
    const { crud } = setup();
    const created = await crud.create(widget({ count: 1 }));
    if (!created.ok) throw new Error("setup failed");

    const updated = await crud.update(created.value.id, { count: 5 });

    expect(updated.ok && updated.value.count).toBe(5);
    expect(updated.ok && updated.value.name).toBe("Bale spear");
    expect(updated.ok && updated.value.updatedAt).toEqual(later);
  });

  it("refuses to let a patch rewrite identity or provenance", async () => {
    // Otherwise a sloppy form post could re-parent a record to another
    // property, or forge its creation time.
    const { crud } = setup();
    const created = await crud.create(widget());
    if (!created.ok) throw new Error("setup failed");
    const otherProperty = nextId();

    const updated = await crud.update(created.value.id, {
      id: nextId(),
      propertyId: otherProperty,
      createdAt: new Date("2000-01-01T00:00:00Z"),
    });

    expect(updated.ok && updated.value.id).toBe(created.value.id);
    expect(updated.ok && updated.value.propertyId).toBe(propertyId);
    expect(updated.ok && updated.value.createdAt).toEqual(now);
  });

  it("re-validates the whole record, not just the patch", async () => {
    const { crud } = setup();
    const created = await crud.create(widget());
    if (!created.ok) throw new Error("setup failed");

    expect((await crud.update(created.value.id, { count: -3 })).ok).toBe(false);
  });

  it("reports not-found for an unknown or deleted record", async () => {
    const { crud } = setup();
    expect((await crud.update(nextId(), { count: 1 })).ok).toBe(false);

    const created = await crud.create(widget());
    if (!created.ok) throw new Error("setup failed");
    await crud.delete(created.value.id, userId);

    expect((await crud.update(created.value.id, { count: 1 })).ok).toBe(false);
  });
});

describe("delete — spec §4.5 clause 4", () => {
  it("writes a tombstone instead of removing the row", async () => {
    const { crud, repository } = setup();
    const created = await crud.create(widget());
    if (!created.ok) throw new Error("setup failed");

    const deleted = await crud.delete(created.value.id, userId, "wrong entry");

    expect(deleted.ok && deleted.value.deletedAt).toEqual(later);
    expect(deleted.ok && deleted.value.deletedBy).toBe(userId);
    expect(deleted.ok && deleted.value.deletedReason).toBe("wrong entry");
    expect(repository.size()).toBe(1);
  });

  it("blocks on a restrict relationship and names what is in the way", async () => {
    const { crud } = setup({
      relationships: [childRelationship],
      dependents: [{ entity: "Gadget", id: nextId(), label: "spear tip" }],
    });
    const created = await crud.create(widget());
    if (!created.ok) throw new Error("setup failed");

    const result = await crud.delete(created.value.id, userId);

    expect(!result.ok && result.error.kind).toBe("blocked");
    expect(!result.ok && result.error.kind === "blocked" && result.error.blockedBy).toEqual([
      "Gadget spear tip",
    ]);
  });

  it("proceeds when a cascade relationship has dependents, and applies them", async () => {
    const applied: string[] = [];
    const cascade: RelationshipDeclaration = { ...childRelationship, onDelete: "cascade" };
    const repository = new InMemoryRepository<Widget>();
    const dependent: Dependent = { entity: "Gadget", id: nextId(), label: "spear tip" };

    const crud = makeCrudUseCases<Widget>({
      definition: definition([cascade]),
      repository,
      clock: fixedClock(later),
      findDependents: async () => new Map([[relationshipKey(cascade), [dependent]]]),
      applyImpact: async (impact) => {
        applied.push(...impact.cascades.map((d) => d.label));
      },
    });

    const created = await crud.create(widget());
    if (!created.ok) throw new Error("setup failed");
    const result = await crud.delete(created.value.id, userId);

    expect(result.ok).toBe(true);
    expect(applied).toEqual(["spear tip"]);
  });

  it("refuses to delete the same record twice", async () => {
    const { crud } = setup();
    const created = await crud.create(widget());
    if (!created.ok) throw new Error("setup failed");
    await crud.delete(created.value.id, userId);

    expect((await crud.delete(created.value.id, userId)).ok).toBe(false);
  });

  it("previews the impact without deleting anything", async () => {
    // This is what the confirmation dialog renders (§4.5 clause 3).
    const { crud, repository } = setup({
      relationships: [childRelationship],
      dependents: [{ entity: "Gadget", id: nextId(), label: "spear tip" }],
    });
    const created = await crud.create(widget());
    if (!created.ok) throw new Error("setup failed");

    const preview = await crud.previewDelete(created.value.id);

    expect(preview.ok && preview.value.allowed).toBe(false);
    expect(preview.ok && preview.value.blockedBy).toHaveLength(1);
    expect((await crud.get(created.value.id)).ok).toBe(true);
    expect(repository.size()).toBe(1);
  });
});

describe("restore and purge", () => {
  it("brings a record back from Trash", async () => {
    const { crud } = setup();
    const created = await crud.create(widget());
    if (!created.ok) throw new Error("setup failed");
    await crud.delete(created.value.id, userId);

    const restored = await crud.restore(created.value.id);

    expect(restored.ok && restored.value.deletedAt).toBeUndefined();
    expect((await crud.get(created.value.id)).ok).toBe(true);
  });

  it("refuses to restore something that was never deleted", async () => {
    const { crud } = setup();
    const created = await crud.create(widget());
    if (!created.ok) throw new Error("setup failed");

    expect((await crud.restore(created.value.id)).ok).toBe(false);
  });

  it("purges only what is already in Trash", async () => {
    // Purge is the separate, owner-only action — never a shortcut past delete.
    const { crud, repository } = setup();
    const created = await crud.create(widget());
    if (!created.ok) throw new Error("setup failed");

    expect((await crud.purge(created.value.id)).ok).toBe(false);
    expect(repository.size()).toBe(1);

    await crud.delete(created.value.id, userId);
    expect((await crud.purge(created.value.id)).ok).toBe(true);
    expect(repository.size()).toBe(0);
  });

  it("reports not-found when restoring or purging an unknown id", async () => {
    const { crud } = setup();

    expect((await crud.restore(nextId())).ok).toBe(false);
    expect((await crud.purge(nextId())).ok).toBe(false);
  });
});
