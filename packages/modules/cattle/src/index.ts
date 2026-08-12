/**
 * The cattle module (spec §5.2).
 *
 * Pure domain: entities, invariants, and the derivations §5.2 asks for. It
 * imports `@galaxy-farm/core` and nothing else, which `boundaries.test.ts`
 * enforces — no database, no React, no other module. Feed costs and calendar
 * projections arrive as arguments rather than as imports, because §4.1 has
 * modules talk through ids and events.
 *
 * This is the phase racing a real date: Andromeda was bred 14 February 2026,
 * which projects to 24 November, with the watch opening on the 10th.
 */

export * from "./domain/ancestors.js";
export * from "./domain/breeding-record.js";
export * from "./domain/calving-record.js";
export * from "./domain/calving-watch.js";
export * from "./domain/cattle-candidate.js";
export * from "./domain/cattle-profile.js";
export * from "./domain/coat-colour.js";
export * from "./domain/digital-beef.js";
export * from "./domain/events.js";
export * from "./domain/fertility-test.js";
export * from "./domain/genetics.js";
export * from "./domain/health-record.js";
export * from "./domain/import-identity.js";
export * from "./domain/heat-record.js";
export * from "./domain/herd-roadmap.js";
export * from "./domain/mating-analysis.js";
export * from "./domain/med-inventory.js";
export * from "./domain/pedigree.js";
export * from "./domain/processing-record.js";
export * from "./domain/refresh.js";
export * from "./domain/risks.js";
export * from "./domain/profit-and-loss.js";
export * from "./domain/semen-inventory.js";
export * from "./domain/sync-protocol.js";
export * from "./domain/transactions.js";
export * from "./domain/weight-record.js";
