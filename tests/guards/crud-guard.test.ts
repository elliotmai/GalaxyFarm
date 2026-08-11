import { describe, expect, it } from "vitest";

import {
  REQUIRED_CRUD_OPERATIONS,
  discoverEntities,
  findIncompleteCrudSurfaces,
  findUnconfirmedDestructiveCalls,
  notStartedEntities,
  toSlug,
  type SourceFile,
} from "../../tools/crud-guard.js";

/**
 * Unit tests for the §4.5 guards themselves.
 *
 * The guards run against a codebase that is still mostly unwritten, so applying
 * them to the repo proves very little today. Proving them against fixtures
 * proves they will actually bite when the first delete button lands — which is
 * the whole point of writing them now rather than later.
 */

const file = (path: string, source: string): SourceFile => ({ path, source });

describe("clause 3 — confirmation before destructive actions", () => {
  it("flags a delete handler with no confirmation helper", () => {
    const findings = findUnconfirmedDestructiveCalls([
      file(
        "apps/web/app/(admin)/admin/cattle/delete-button.tsx",
        `export function DeleteButton({ id }: { id: string }) {
           return <button onClick={() => deleteAnimal(id)}>Delete</button>;
         }`,
      ),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.symbol).toBe("deleteAnimal");
    expect(findings[0]?.reason).toContain("§4.5 clause 3");
  });

  it("accepts a delete guarded by a confirmation hook", () => {
    const findings = findUnconfirmedDestructiveCalls([
      file(
        "apps/web/app/(admin)/admin/cattle/delete-button.tsx",
        `import { useConfirmDelete } from "@galaxy-farm/ui";

         export function DeleteButton({ id }: { id: string }) {
           const confirm = useConfirmDelete();
           return <button onClick={() => confirm(() => deleteAnimal(id))}>Delete</button>;
         }`,
      ),
    ]);

    expect(findings).toEqual([]);
  });

  it.each([
    ["removeZone", "removeZone(zoneId)"],
    ["purgeTrash", "purgeTrash()"],
    ["revokeDevice", "revokeDevice(token)"],
    ["terminateAgreement", "terminateAgreement(id)"],
    ["voidInvoice", "voidInvoice(id)"],
    ["destroyDraft", "destroyDraft()"],
  ])("catches %s — the contract covers irreversible non-deletes too", (symbol, call) => {
    const findings = findUnconfirmedDestructiveCalls([
      file("apps/web/app/(admin)/admin/thing.tsx", `export const go = () => ${call};`),
    ]);

    expect(findings.map((f) => f.symbol)).toContain(symbol);
  });

  it("does not flag DOM and timer APIs that merely sound destructive", () => {
    const findings = findUnconfirmedDestructiveCalls([
      file(
        "apps/web/app/(kiosk)/kiosk/board.tsx",
        `useEffect(() => {
           const t = setTimeout(tick, 1000);
           node.removeEventListener("click", handler);
           window.localStorage.removeItem("draft");
           return () => clearTimeout(t);
         }, []);`,
      ),
    ]);

    expect(findings).toEqual([]);
  });

  it("honours an opt-out that states a reason", () => {
    const findings = findUnconfirmedDestructiveCalls([
      file(
        "apps/web/app/(admin)/admin/form.tsx",
        `// crud-guard: allow-unconfirmed — clears an unsaved local draft, nothing persisted
         export const reset = () => clearDraft();`,
      ),
    ]);

    expect(findings).toEqual([]);
  });

  it("rejects a bare opt-out with no reason", () => {
    const findings = findUnconfirmedDestructiveCalls([
      file(
        "apps/web/app/(admin)/admin/form.tsx",
        `// crud-guard: allow-unconfirmed
         export const reset = () => deleteEverything();`,
      ),
    ]);

    expect(findings).toHaveLength(1);
  });

  it("exempts tests, fixtures, and the confirmation component itself", () => {
    const findings = findUnconfirmedDestructiveCalls([
      file("packages/ui/src/components/confirm-dialog.tsx", "export const run = () => deleteIt();"),
      file("apps/web/app/thing.test.tsx", "deleteAnimal('x')"),
      file("packages/ui/__fixtures__/sample.tsx", "removeZone('x')"),
    ]);

    expect(findings).toEqual([]);
  });

  it("reports the line number so the failure is navigable", () => {
    const findings = findUnconfirmedDestructiveCalls([
      file("apps/web/a.tsx", ["// one", "// two", "deleteAnimal(id);"].join("\n")),
    ]);

    expect(findings[0]?.line).toBe(3);
  });

  it("finds every unguarded call in a file, not just the first", () => {
    const findings = findUnconfirmedDestructiveCalls([
      file("apps/web/a.tsx", "deleteAnimal(a);\nremoveZone(b);\npurgeTrash();"),
    ]);

    expect(findings.map((f) => f.symbol)).toEqual(["deleteAnimal", "removeZone", "purgeTrash"]);
  });
});

describe("clause 1 — full CRUD surface", () => {
  it("passes an entity with every operation", () => {
    const findings = findIncompleteCrudSurfaces([
      {
        name: "Zone",
        file: "packages/modules/cattle/src/domain/entities/zone.ts",
        operations: [...REQUIRED_CRUD_OPERATIONS],
      },
    ]);

    expect(findings).toEqual([]);
  });

  it("names exactly which operations are missing", () => {
    const findings = findIncompleteCrudSurfaces([
      { name: "Zone", file: "z.ts", operations: ["create", "get", "list"] },
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.reason).toContain("`update`");
    expect(findings[0]?.reason).toContain("`delete`");
    expect(findings[0]?.reason).not.toContain("`create`");
  });

  it("respects a declared exemption for the enumerated exception list", () => {
    const findings = findIncompleteCrudSurfaces([
      {
        name: "SignedLiabilitySnapshot",
        file: "s.ts",
        operations: ["create", "get", "list"],
        exempt: "immutable legal record — spec §4.5",
      },
    ]);

    expect(findings).toEqual([]);
  });

  it("requires delete even when everything else is present", () => {
    const findings = findIncompleteCrudSurfaces([
      { name: "EggLog", file: "e.ts", operations: ["create", "get", "list", "update"] },
    ]);

    expect(findings[0]?.reason).toContain("`delete`");
  });

  describe("not-started entities", () => {
    it("does not fail an entity with no use cases at all", () => {
      // Declared but not yet built. Failing here would make the gate
      // permanently red, and a permanently red gate is one nobody reads.
      expect(findIncompleteCrudSurfaces([{ name: "Zone", file: "z.ts", operations: [] }])).toEqual(
        [],
      );
    });

    it("reports them separately so the count stays visible", () => {
      const entities = [
        { name: "Zone", file: "z.ts", operations: [] },
        { name: "Animal", file: "a.ts", operations: [...REQUIRED_CRUD_OPERATIONS] },
      ];

      expect(notStartedEntities(entities).map((e) => e.name)).toEqual(["Zone"]);
    });

    it("fails the moment a surface is half-built", () => {
      // This is the case that matters: a create screen shipped without a
      // delete button is exactly what §4.5 exists to prevent.
      const findings = findIncompleteCrudSurfaces([
        { name: "Zone", file: "z.ts", operations: ["create"] },
      ]);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.reason).toContain("`delete`");
    });

    it("does not report an exempt entity as not started", () => {
      const exempt = [
        { name: "AuditEntry", file: "a.ts", operations: [], exempt: "immutable audit record" },
      ];

      expect(notStartedEntities(exempt)).toEqual([]);
    });
  });
});

describe("entity discovery", () => {
  const entityFile = (module: string, name: string, extra = "") =>
    file(
      `packages/modules/${module}/src/domain/entities/${toSlug(name)}.ts`,
      `${extra}\nexport const ${name}Schema = z.object({});`,
    );

  const useCase = (module: string, operation: string, entity: string) =>
    file(
      `packages/modules/${module}/src/application/use-cases/${operation}-${toSlug(entity)}.ts`,
      "",
    );

  it("finds entities by their exported schema", () => {
    const entities = discoverEntities([entityFile("cattle", "CattleProfile")]);

    expect(entities.map((e) => e.name)).toEqual(["CattleProfile"]);
  });

  it("normalises a camelCase schema name to the entity it describes", () => {
    // Schemas are values and are written `purchaseCandidateSchema`; the entity
    // is `PurchaseCandidate`, and that is what a failure message should say.
    const entities = discoverEntities([
      file(
        "packages/core/src/entities/purchase-candidate.ts",
        "export const purchaseCandidateSchema = z.object({});",
      ),
    ]);

    expect(entities.map((e) => e.name)).toEqual(["PurchaseCandidate"]);
  });

  it("still pairs use cases after normalising the name", () => {
    const entities = discoverEntities([
      file(
        "packages/core/src/entities/purchase-candidate.ts",
        "export const purchaseCandidateSchema = z.object({});",
      ),
      file("packages/core/src/use-cases/create-purchase-candidate.ts", ""),
    ]);

    expect(entities[0]?.operations).toEqual(["create"]);
  });

  it("pairs use cases to their entity by filename convention", () => {
    const entities = discoverEntities([
      entityFile("cattle", "CattleProfile"),
      useCase("cattle", "create", "CattleProfile"),
      useCase("cattle", "delete", "CattleProfile"),
    ]);

    expect(entities[0]?.operations.sort()).toEqual(["create", "delete"]);
  });

  it("drives the completeness check end to end", () => {
    const entities = discoverEntities([
      entityFile("poultry", "EggLog"),
      ...REQUIRED_CRUD_OPERATIONS.map((op) => useCase("poultry", op, "EggLog")),
    ]);

    expect(findIncompleteCrudSurfaces(entities)).toEqual([]);
  });

  it("picks up an inline exemption comment", () => {
    const entities = discoverEntities([
      entityFile(
        "business",
        "AuditEntry",
        "// crud-guard: exempt — immutable audit record, spec §4.5",
      ),
    ]);

    expect(entities[0]?.exempt).toContain("immutable audit record");
  });

  it("ignores files outside an entities directory", () => {
    const entities = discoverEntities([
      file("packages/ui/src/components/form.tsx", "export const ThingSchema = z.object({});"),
    ]);

    expect(entities).toEqual([]);
  });

  it("discovers entities in the shared kernel as well as in modules", () => {
    // core holds Zone, Animal, Contact and friends. If the guard cannot see
    // them it goes blind exactly where the first entities landed.
    const entities = discoverEntities([
      file("packages/core/src/entities/zone.ts", "export const ZoneSchema = z.object({});"),
      file(
        "packages/modules/cattle/src/domain/entities/cattle-profile.ts",
        "export const CattleProfileSchema = z.object({});",
      ),
    ]);

    expect(entities.map((e) => e.name)).toEqual(["CattleProfile", "Zone"]);
  });

  it("pairs kernel use cases to kernel entities", () => {
    const entities = discoverEntities([
      file("packages/core/src/entities/zone.ts", "export const ZoneSchema = z.object({});"),
      file("packages/core/src/use-cases/create-zone.ts", ""),
      file("packages/core/src/use-cases/delete-zone.ts", ""),
    ]);

    expect(entities[0]?.operations.sort()).toEqual(["create", "delete"]);
  });
});

describe("toSlug", () => {
  it.each([
    ["CattleProfile", "cattle-profile"],
    ["EggLog", "egg-log"],
    ["Zone", "zone"],
    ["PastureCareLog", "pasture-care-log"],
    ["ZoneAssignment", "zone-assignment"],
  ])("%s → %s", (input, expected) => {
    expect(toSlug(input)).toBe(expected);
  });
});
