import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { readJson, repoRoot, workspacePackages } from "../../tools/workspace.js";

/**
 * The monorepo layout from spec §4.1, asserted as structure rather than
 * described in a README that nobody re-reads.
 */

const packages = workspacePackages();
const modules = packages.filter((p) => p.dir.startsWith("packages/modules/"));
const infrastructure = packages.filter((p) => p.dir.startsWith("packages/infrastructure/"));

const EXPECTED_MODULES = [
  "cattle",
  "feed",
  "poultry",
  "garden",
  "equipment",
  "supplies",
  "business",
  "pets",
  "horses",
  "housesitting",
] as const;

const EXPECTED_INFRASTRUCTURE = [
  "db",
  "local",
  "sync",
  "storage",
  "email",
  "weather",
  "auth",
  "quickbooks",
] as const;

describe("workspace shape", () => {
  it("discovers every workspace package", () => {
    expect(packages.length).toBe(
      1 + 1 + 1 + 1 + EXPECTED_MODULES.length + EXPECTED_INFRASTRUCTURE.length,
    );
  });

  it("has one package per farm domain named in the spec", () => {
    expect(modules.map((m) => m.dir.split("/").pop()).sort()).toEqual([...EXPECTED_MODULES].sort());
  });

  it("has one adapter package per external dependency", () => {
    expect(infrastructure.map((m) => m.dir.split("/").pop()).sort()).toEqual(
      [...EXPECTED_INFRASTRUCTURE].sort(),
    );
  });

  it("names packages consistently", () => {
    for (const pkg of packages) {
      expect(pkg.name, `${pkg.dir} should be scoped`).toMatch(/^@galaxy-farm\//);
    }
    for (const pkg of modules) {
      expect(pkg.name).toBe(`@galaxy-farm/module-${pkg.dir.split("/").pop()}`);
    }
    for (const pkg of infrastructure) {
      expect(pkg.name).toBe(`@galaxy-farm/infra-${pkg.dir.split("/").pop()}`);
    }
  });
});

describe("package manifests", () => {
  it("are all private — nothing here is publishable", () => {
    for (const pkg of packages) {
      expect(pkg.manifest["private"], `${pkg.name} must be private`).toBe(true);
    }
  });

  it("every package can be typechecked", () => {
    for (const pkg of packages) {
      const scripts = pkg.manifest["scripts"] as Record<string, string> | undefined;
      expect(
        scripts?.["typecheck"],
        `${pkg.name} needs a typecheck script for the CI gate`,
      ).toBeTruthy();
    }
  });

  it("every package extends the shared tsconfig instead of rolling its own", () => {
    // Compare resolved paths rather than the literal string: @galaxy-farm/config
    // legitimately reaches its own base as "./tsconfig.base.json", and a
    // pattern match on the text would either reject that or be loose enough to
    // accept an unrelated file that happens to end in the same name.
    const shared = join(repoRoot, "packages/config/tsconfig.base.json");

    for (const pkg of packages) {
      const tsconfig = readJson(`${pkg.dir}/tsconfig.json`);
      const extended = resolve(repoRoot, pkg.dir, String(tsconfig["extends"]));
      expect(extended, `${pkg.name} must extend the shared base, not roll its own`).toBe(shared);
    }
  });

  it("depends on core through the workspace protocol, never a version range", () => {
    for (const pkg of [...modules, ...infrastructure]) {
      const deps = pkg.manifest["dependencies"] as Record<string, string> | undefined;
      expect(deps?.["@galaxy-farm/core"], `${pkg.name} should depend on core`).toBe("workspace:*");
    }
  });
});

describe("module internal layout", () => {
  it("splits every module into a domain and an application layer", () => {
    for (const pkg of modules) {
      for (const layer of ["src/domain", "src/application"]) {
        expect(
          existsSync(join(repoRoot, pkg.dir, layer)),
          `${pkg.name} is missing ${layer} — modules contain ONLY domain and application (spec §4.1)`,
        ).toBe(true);
      }
    }
  });

  it("gives every module a place to put its tests", () => {
    for (const pkg of modules) {
      expect(existsSync(join(repoRoot, pkg.dir, "tests")), `${pkg.name} is missing tests/`).toBe(
        true,
      );
    }
  });

  it("keeps the domain layer free of an application subdirectory and vice versa", () => {
    for (const pkg of modules) {
      expect(existsSync(join(repoRoot, pkg.dir, "src/domain/application"))).toBe(false);
      expect(existsSync(join(repoRoot, pkg.dir, "src/application/domain"))).toBe(false);
    }
  });
});

describe("toolchain pinning", () => {
  const root = readJson("package.json");

  it("pins the package manager so CI and laptops agree", () => {
    expect(String(root["packageManager"])).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
  });

  it("requires a Node version that supports the toolchain", () => {
    const engines = root["engines"] as Record<string, string>;
    expect(engines["node"]).toBeTruthy();
    expect(engines["node"]).toMatch(/>=\s*2[2-9]/);
  });

  it("exposes the full verification gate as a single command", () => {
    const scripts = root["scripts"] as Record<string, string>;
    for (const step of ["lint", "typecheck", "test:coverage", "build"]) {
      expect(scripts["verify"], `verify must run ${step}`).toContain(step);
    }
  });
});
