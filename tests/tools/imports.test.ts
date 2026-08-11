import { describe, expect, it } from "vitest";

import {
  importsOf,
  isRelativeSpecifier,
  isWorkspaceSpecifier,
  moduleFromSpecifier,
} from "../../tools/imports.js";
import { layerOf, moduleOf } from "../../tools/workspace.js";

/**
 * The boundary tests are only as trustworthy as the analyser underneath them.
 * A parser that silently misses `export ... from` would turn every
 * architecture assertion into a false pass, so the analyser gets its own tests.
 */

describe("importsOf", () => {
  it("sees plain imports", () => {
    expect(importsOf(`import { a } from "@galaxy-farm/core";`)).toEqual(["@galaxy-farm/core"]);
  });

  it("sees type-only imports, which are still architectural dependencies", () => {
    expect(importsOf(`import type { Animal } from "@galaxy-farm/core";`)).toEqual([
      "@galaxy-farm/core",
    ]);
  });

  it("sees re-exports", () => {
    expect(importsOf(`export * from "./entities/animal.js";`)).toEqual(["./entities/animal.js"]);
    expect(importsOf(`export { Zone } from "@galaxy-farm/core";`)).toEqual(["@galaxy-farm/core"]);
  });

  it("sees dynamic imports, which is how a boundary usually gets smuggled across", () => {
    expect(importsOf(`const m = await import("@galaxy-farm/infra-db");`)).toEqual([
      "@galaxy-farm/infra-db",
    ]);
  });

  it("sees side-effect imports", () => {
    expect(importsOf(`import "./globals.css";`)).toEqual(["./globals.css"]);
  });

  it("ignores specifiers inside comments", () => {
    expect(importsOf(`// import { x } from "next/navigation";\nconst a = 1;`)).toEqual([]);
  });

  it("ignores strings that merely look like specifiers", () => {
    expect(importsOf(`const label = "import { x } from 'next'";`)).toEqual([]);
  });

  it("collects multiple specifiers in source order", () => {
    const source = `import a from "next";\nimport b from "@galaxy-farm/core";\nexport * from "./x.js";`;
    expect(importsOf(source)).toEqual(["next", "@galaxy-farm/core", "./x.js"]);
  });
});

describe("specifier classification", () => {
  it.each([
    ["@galaxy-farm/module-cattle", "cattle"],
    ["@galaxy-farm/module-housesitting", "housesitting"],
    ["@galaxy-farm/module-cattle/src/domain/x.js", "cattle"],
  ])("%s belongs to module %s", (specifier, expected) => {
    expect(moduleFromSpecifier(specifier)).toBe(expected);
  });

  it.each(["@galaxy-farm/core", "@galaxy-farm/infra-db", "react", "./local.js"])(
    "%s is not a module specifier",
    (specifier) => {
      expect(moduleFromSpecifier(specifier)).toBeUndefined();
    },
  );

  it("distinguishes workspace from third-party from relative", () => {
    expect(isWorkspaceSpecifier("@galaxy-farm/core")).toBe(true);
    expect(isWorkspaceSpecifier("react")).toBe(false);
    expect(isRelativeSpecifier("./x.js")).toBe(true);
    expect(isRelativeSpecifier("../../y.js")).toBe(true);
    expect(isRelativeSpecifier("@galaxy-farm/core")).toBe(false);
  });
});

describe("layerOf", () => {
  it.each([
    ["packages/core/src/index.ts", "core"],
    ["packages/modules/cattle/src/domain/entities/x.ts", "module-domain"],
    ["packages/modules/cattle/src/application/use-cases/x.ts", "module-application"],
    ["packages/infrastructure/db/src/index.ts", "infrastructure"],
    ["packages/ui/src/index.ts", "ui"],
    ["apps/web/app/layout.tsx", "app"],
    ["tools/imports.ts", "tooling"],
  ])("classifies %s as %s", (path, expected) => {
    expect(layerOf(path)).toBe(expected);
  });

  it("returns undefined for files that carry no layering rules", () => {
    expect(layerOf("packages/modules/cattle/package.json")).toBeUndefined();
    expect(layerOf("README.md")).toBeUndefined();
  });

  it("does not mistake a module's config file for domain code", () => {
    expect(layerOf("packages/modules/cattle/tsconfig.json")).toBeUndefined();
  });
});

describe("moduleOf", () => {
  it("extracts the module name from a path", () => {
    expect(moduleOf("packages/modules/garden/src/domain/x.ts")).toBe("garden");
  });

  it("returns undefined outside the modules tree", () => {
    expect(moduleOf("packages/core/src/x.ts")).toBeUndefined();
    expect(moduleOf("apps/web/app/page.tsx")).toBeUndefined();
  });
});
