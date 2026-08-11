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
