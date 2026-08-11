import { describe, expect, it } from "vitest";

import {
  importGraph,
  isWorkspaceSpecifier,
  moduleFromSpecifier,
  packageFromSpecifier,
} from "../../tools/imports.js";
import { readJson, workspacePackages } from "../../tools/workspace.js";

/**
 * The dependency rules from spec §4.1, enforced against the real import graph.
 *
 * These are the rules that make the modularization worth anything: they are why
 * moving the database home is a connection-string change, and why adding horses
 * will not disturb cattle. Prose decays; a failing build does not.
 */

const graph = importGraph();

/** Every violation message shares this shape so failures are actionable. */
function violation(file: string, specifier: string, rule: string): string {
  return `${file}\n    imports "${specifier}"\n    ${rule}`;
}

describe("spec §4.1 — dependency rules", () => {
  it("the import graph is non-empty (the analyser is actually seeing files)", () => {
    // Guards against a silently broken walker turning every rule below into a
    // vacuous pass.
    expect(graph.length).toBeGreaterThan(0);
  });

  it("modules/*/domain imports only core", () => {
    const offenders = graph
      .filter((e) => e.fromLayer === "module-domain")
      .filter((e) => isWorkspaceSpecifier(e.specifier) && e.specifier !== "@galaxy-farm/core")
      .map((e) =>
        violation(
          e.from,
          e.specifier,
          "Domain layers import only @galaxy-farm/core. Nothing else. Ever.",
        ),
      );

    expect(offenders).toEqual([]);
  });

  it("modules/*/domain does not import a framework, database, or design system", () => {
    const forbidden = [/^react/, /^next/, /^drizzle-orm/, /^dexie$/, /^pg$/, /^@galaxy-farm\/ui$/];
    const offenders = graph
      .filter((e) => e.fromLayer === "module-domain")
      .filter((e) => forbidden.some((f) => f.test(e.specifier)))
      .map((e) =>
        violation(
          e.from,
          e.specifier,
          "The domain layer knows nothing about the web, the database, or the cloud (spec §2).",
        ),
      );

    expect(offenders).toEqual([]);
  });

  it("modules/*/application imports only its own domain and core", () => {
    const offenders = graph
      .filter((e) => e.fromLayer === "module-application")
      .filter((e) => {
        if (!isWorkspaceSpecifier(e.specifier)) return false;
        if (e.specifier === "@galaxy-farm/core") return false;
        return moduleFromSpecifier(e.specifier) !== e.fromModule;
      })
      .map((e) =>
        violation(
          e.from,
          e.specifier,
          "Application layers import their own domain plus core only.",
        ),
      );

    expect(offenders).toEqual([]);
  });

  it("modules never import each other", () => {
    const offenders = graph
      .filter((e) => e.fromModule !== undefined)
      .filter((e) => {
        const target = moduleFromSpecifier(e.specifier);
        return target !== undefined && target !== e.fromModule;
      })
      .map((e) =>
        violation(
          e.from,
          e.specifier,
          "Modules communicate through IDs and domain events, never direct imports (spec §4.1).",
        ),
      );

    expect(offenders).toEqual([]);
  });

  it("core sits at the bottom of the graph and imports nothing from the workspace", () => {
    const offenders = graph
      .filter((e) => e.fromLayer === "core")
      .filter((e) => isWorkspaceSpecifier(e.specifier))
      .map((e) =>
        violation(
          e.from,
          e.specifier,
          "core is the shared kernel; everything depends on it, it depends on nothing.",
        ),
      );

    expect(offenders).toEqual([]);
  });

  it("infrastructure implements ports and never reaches into module internals", () => {
    const offenders = graph
      .filter((e) => e.fromLayer === "infrastructure")
      .filter(
        (e) =>
          /^@galaxy-farm\/module-[^/]+\/src\//.test(e.specifier) ||
          e.specifier === "@galaxy-farm/ui",
      )
      .map((e) =>
        violation(
          e.from,
          e.specifier,
          "Infrastructure implements domain ports; it has no presentation concerns and no deep imports.",
        ),
      );

    expect(offenders).toEqual([]);
  });

  it("the design system stays free of domain and infrastructure", () => {
    const offenders = graph
      .filter((e) => e.fromLayer === "ui")
      .filter((e) => /^@galaxy-farm\/(module-|infra-)/.test(e.specifier))
      .map((e) =>
        violation(
          e.from,
          e.specifier,
          "packages/ui is presentation only — it takes data as props (spec §4.1).",
        ),
      );

    expect(offenders).toEqual([]);
  });

  /**
   * Every import, workspace or third-party, declared by the package making it.
   *
   * This carries more weight than it looks like it does. `node-linker=hoisted`
   * (see `.npmrc` — the working copy lives on a volume with no symlinks) puts
   * every transitive dependency in one flat `node_modules`, so an undeclared
   * import resolves at runtime and nothing objects. Until, one day, the
   * dependency that happened to hoist it stops depending on it. This test is
   * where that guarantee lives now.
   */
  it("declares every dependency it imports", () => {
    const byDir = workspacePackages();
    const offenders: string[] = [];

    for (const edge of graph) {
      const dependency = packageFromSpecifier(edge.specifier);
      if (dependency === undefined) continue;

      const pkg = byDir
        .filter((p) => edge.from.startsWith(`${p.dir}/`))
        .sort((a, b) => b.dir.length - a.dir.length)[0];
      if (!pkg) continue;

      const deps = {
        ...(pkg.manifest["dependencies"] as Record<string, string> | undefined),
        ...(pkg.manifest["devDependencies"] as Record<string, string> | undefined),
        ...(pkg.manifest["peerDependencies"] as Record<string, string> | undefined),
      };
      if (!(dependency in deps) && !(dependency in rootDevDependencies())) {
        offenders.push(
          violation(
            edge.from,
            edge.specifier,
            `${pkg.name} imports ${dependency} without declaring it in package.json.`,
          ),
        );
      }
    }

    expect(offenders).toEqual([]);
  });
});

/**
 * Test tooling — vitest and the testing-library family — is declared once at
 * the root rather than in all twenty-odd packages. Everything a package ships
 * still has to be declared by that package.
 */
function rootDevDependencies(): Record<string, string> {
  return (readJson("package.json")["devDependencies"] as Record<string, string> | undefined) ?? {};
}

describe("spec §4.1 — composition root", () => {
  it("apps/web is the only place that composes infrastructure", () => {
    const composers = new Set(
      graph.filter((e) => /^@galaxy-farm\/infra-/.test(e.specifier)).map((e) => e.fromLayer),
    );

    for (const layer of composers) {
      expect(
        layer,
        "Only the app composes infrastructure — dependency injection happens at the route level (spec §4.1).",
      ).toBe("app");
    }
  });
});
