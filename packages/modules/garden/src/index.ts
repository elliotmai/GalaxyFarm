/**
 * The garden module (spec §5.5, Phase 3).
 *
 * Beds under a garden Zone, crops keyed by botanical family so the rotation
 * guard runs on the thing that matters, and a season plan whose windows are the
 * only things that raise a notification — §5.5 is explicit that alerts fire for
 * what is planned, not for the whole seed catalogue.
 */

export * from "./domain/beds.js";
export * from "./domain/planting.js";
export * from "./domain/season-plan.js";
