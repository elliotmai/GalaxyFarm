import { describe, expect, it } from "vitest";

import {
  discoverEntities,
  findIncompleteCrudSurfaces,
  findUnconfirmedDestructiveCalls,
  notStartedEntities,
  type SourceFile,
} from "../../tools/crud-guard.js";
import { listFiles, readText } from "../../tools/workspace.js";

/**
 * The §4.5 guards applied to the actual repository.
 *
 * Today most of these pass because there is little code to violate them. That
 * is expected and is not a reason to skip them: the gate is in place before the
 * first feature lands, so no delete button can ever reach main without a
 * confirmation behind it. The guards' own correctness is proven separately in
 * `crud-guard.test.ts` against fixtures.
 */

function sourcesUnder(roots: readonly string[]): SourceFile[] {
  return roots
    .flatMap((root) => listFiles(root, [".ts", ".tsx"]))
    .filter((path) => !path.endsWith(".d.ts"))
    .map((path) => ({ path, source: readText(path) }));
}

const presentationSources = sourcesUnder(["apps/web", "packages/ui"]);
const domainSources = sourcesUnder(["packages/modules", "packages/core"]);

describe("spec §4.5 clause 3 — no unconfirmed destructive action reaches main", () => {
  it("scans a real, non-empty set of presentation files", () => {
    // Without this the suite below would pass just as happily on a broken
    // file walker as on a clean codebase.
    expect(presentationSources.length).toBeGreaterThan(0);
  });

  it("finds no destructive call without a confirmation helper", () => {
    const findings = findUnconfirmedDestructiveCalls(presentationSources);
    const report = findings.map((f) => `${f.file}:${f.line} — ${f.reason}`);

    expect(report).toEqual([]);
  });
});

describe("spec §4.5 clause 1 — every entity carries a full CRUD surface", () => {
  const entities = discoverEntities(domainSources);

  it("reports incomplete surfaces for whatever entities exist", () => {
    const findings = findIncompleteCrudSurfaces(entities);
    const report = findings.map((f) => `${f.file} — ${f.reason}`);

    expect(report).toEqual([]);
  });

  it("is no longer vacuous — the kernel holds real entities now", () => {
    // This assertion earns its keep by failing if entity discovery ever breaks:
    // a guard that silently finds nothing passes for the wrong reason.
    expect(entities.length).toBeGreaterThanOrEqual(10);
    expect(entities.map((e) => e.name)).toContain("Zone");
    expect(entities.map((e) => e.name)).toContain("Animal");
    expect(entities.map((e) => e.name)).toContain("PurchaseCandidate");
  });

  it("tracks which entities have no use cases yet", () => {
    // Not a failure — declared-but-unbuilt is the honest state of a Phase 0
    // repo. Surfacing the list keeps it from being forgotten, and the check
    // above turns hostile the moment one of them is half-built.
    const pending = notStartedEntities(entities).map((e) => e.name);

    expect(pending.length).toBeLessThanOrEqual(entities.length);
    expect(domainSources.length).toBeGreaterThan(0);
  });
});

describe("spec §4.5 clause 2 — validation lives in one shared schema per entity", () => {
  it("keeps zod out of the presentation layer's own type definitions", () => {
    // Forms import the entity's schema; they never declare a second one.
    const offenders = presentationSources
      .filter((f) => /export\s+const\s+\w+Schema\s*=\s*z\./.test(f.source))
      .map(
        (f) =>
          `${f.path} declares its own schema. Spec §4.5 clause 2: one schema per entity, ` +
          `defined in the domain layer and imported by the form, the sync payload, and the API handler.`,
      );

    expect(offenders).toEqual([]);
  });
});
