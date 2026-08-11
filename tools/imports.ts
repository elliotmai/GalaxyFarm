import ts from "typescript";

import { layerOf, listFiles, moduleOf, readText, type Layer } from "./workspace.js";

export interface ImportEdge {
  /** Repo-relative path of the importing file. */
  from: string;
  /** The literal module specifier, e.g. `@galaxy-farm/core` or `../domain/x`. */
  specifier: string;
  fromLayer: Layer | undefined;
  fromModule: string | undefined;
}

/**
 * Extract every module specifier a source file imports.
 *
 * Uses TypeScript's own pre-processor rather than a regex, so it sees
 * `import type`, `export ... from`, dynamic `import()`, and `require()`
 * correctly, and does not trip over specifiers that appear inside comments or
 * string literals.
 */
export function importsOf(source: string): string[] {
  const info = ts.preProcessFile(
    source,
    /* readImportFiles */ true,
    /* detectJavaScriptImports */ true,
  );
  return info.importedFiles.map((f) => f.fileName);
}

/** Build the workspace-wide import graph for the given roots. */
export function importGraph(roots: readonly string[] = ["packages", "apps"]): ImportEdge[] {
  const edges: ImportEdge[] = [];
  for (const root of roots) {
    for (const file of listFiles(root, [".ts", ".tsx"])) {
      if (file.endsWith(".d.ts")) continue;
      for (const specifier of importsOf(readText(file))) {
        edges.push({
          from: file,
          specifier,
          fromLayer: layerOf(file),
          fromModule: moduleOf(file),
        });
      }
    }
  }
  return edges;
}

/** `@galaxy-farm/module-cattle` → `cattle`; anything else → undefined. */
export function moduleFromSpecifier(specifier: string): string | undefined {
  const match = /^@galaxy-farm\/module-([^/]+)/.exec(specifier);
  return match?.[1];
}

export function isWorkspaceSpecifier(specifier: string): boolean {
  return specifier.startsWith("@galaxy-farm/");
}

export function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith(".");
}

/** Node's own modules, which no package declares. */
const BUILT_IN = /^(node:|assert|buffer|crypto|events|fs|http|https|os|path|stream|url|util|zlib)/;

/**
 * The package a bare specifier resolves to: `@scope/name/sub` → `@scope/name`,
 * `dexie/live` → `dexie`. Relative paths and Node built-ins return undefined.
 */
export function packageFromSpecifier(specifier: string): string | undefined {
  if (isRelativeSpecifier(specifier) || specifier.startsWith("/")) return undefined;
  if (BUILT_IN.test(specifier)) return undefined;

  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}
