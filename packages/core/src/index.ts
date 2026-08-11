/**
 * The shared kernel (spec §5.1).
 *
 * Pure TypeScript: no framework, no database, no cloud. This package sits at
 * the bottom of the dependency graph and imports nothing from the workspace —
 * `tests/architecture/boundaries.test.ts` fails the build if that ever changes.
 */

export * from "./types/index.js";
export * from "./value-objects/index.js";
export * from "./entities/index.js";
export * from "./events/index.js";
export * from "./ports/index.js";
export * from "./crud/index.js";
export * from "./testing/in-memory-repository.js";
