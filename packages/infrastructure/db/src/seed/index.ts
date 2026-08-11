/**
 * Seeding the real farm (docs/property-layout.md).
 *
 * Idempotent by construction: ids are derived from the record's key rather
 * than generated, so a second run updates rather than duplicates. It will be
 * run against a database that already holds real records, and a seed that
 * duplicates is a seed nobody dares run.
 */

export * from "./farm.js";
export * from "./run.js";
