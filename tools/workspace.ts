import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");

/** The architectural layer a source file belongs to (spec §4.1). */
export type Layer =
  | "core"
  | "module-domain"
  | "module-application"
  | "infrastructure"
  | "ui"
  | "app"
  | "config"
  | "tooling";

export interface WorkspacePackage {
  /** Package name from its manifest, e.g. `@galaxy-farm/module-cattle`. */
  name: string;
  /** Path relative to the repo root, e.g. `packages/modules/cattle`. */
  dir: string;
  manifest: Record<string, unknown>;
}

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  "dist",
  "coverage",
  "playwright-report",
  "test-results",
]);

/** Recursively list files under `dir` (repo-relative paths, POSIX separators). */
export function listFiles(dir: string, extensions?: readonly string[]): string[] {
  const absolute = join(repoRoot, dir);
  const out: string[] = [];

  const walk = (current: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return; // directory does not exist — callers assert on that separately
    }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry)) continue;
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (!extensions || extensions.some((e) => entry.endsWith(e))) {
        out.push(relative(repoRoot, full).split(sep).join("/"));
      }
    }
  };

  walk(absolute);
  return out.sort();
}

export function readJson(relPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(repoRoot, relPath), "utf8")) as Record<string, unknown>;
}

export function readText(relPath: string): string {
  return readFileSync(join(repoRoot, relPath), "utf8");
}

/** Every workspace package, discovered the same way pnpm discovers them. */
export function workspacePackages(): WorkspacePackage[] {
  const globs = ["apps", "packages", "packages/modules", "packages/infrastructure"];
  const packages: WorkspacePackage[] = [];
  const seen = new Set<string>();

  for (const glob of globs) {
    let entries: string[];
    try {
      entries = readdirSync(join(repoRoot, glob));
    } catch {
      continue;
    }
    for (const entry of entries) {
      const dir = `${glob}/${entry}`;
      if (IGNORED_DIRS.has(entry) || seen.has(dir)) continue;
      let manifest: Record<string, unknown>;
      try {
        manifest = readJson(`${dir}/package.json`);
      } catch {
        continue; // a grouping directory such as `packages/modules` itself
      }
      seen.add(dir);
      packages.push({ name: String(manifest["name"]), dir, manifest });
    }
  }

  return packages.sort((a, b) => a.dir.localeCompare(b.dir));
}

/**
 * Classify a repo-relative source path into its architectural layer.
 * Returns `undefined` for files that carry no layering rules (fixtures, configs
 * inside a package, generated output).
 */
export function layerOf(path: string): Layer | undefined {
  if (path.startsWith("packages/core/src/")) return "core";
  if (path.startsWith("packages/modules/")) {
    if (path.includes("/src/domain/")) return "module-domain";
    if (path.includes("/src/application/")) return "module-application";
    return undefined;
  }
  if (path.startsWith("packages/infrastructure/")) return "infrastructure";
  if (path.startsWith("packages/ui/src/")) return "ui";
  if (path.startsWith("packages/config/")) return "config";
  if (path.startsWith("apps/web/")) return "app";
  if (path.startsWith("tools/") || path.startsWith("tests/")) return "tooling";
  return undefined;
}

/** `packages/modules/cattle/src/domain/x.ts` → `cattle`. */
export function moduleOf(path: string): string | undefined {
  const match = /^packages\/modules\/([^/]+)\//.exec(path);
  return match?.[1];
}
