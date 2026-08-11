/**
 * The shared kernel (spec §5.1).
 *
 * Pure TypeScript: no framework, no database, no cloud. This package sits at
 * the bottom of the dependency graph and imports nothing from the workspace —
 * `tests/architecture/boundaries.test.ts` fails the build if that ever changes.
 *
 * Test helpers — the in-memory repository and the repository conformance suite
 * — are deliberately **not** here. They import `node:assert`, and anything on
 * this entry point ends up in the browser bundle. They live at
 * `@galaxy-farm/core/testing` instead.
 */

export * from "./types/index.js";
export * from "./value-objects/index.js";
export * from "./entities/index.js";
export * from "./events/index.js";
export * from "./ports/index.js";
export * from "./crud/index.js";
export * from "./auth/index.js";
export * from "./sync/index.js";
