/**
 * The supplies module (spec §5.11, added v0.3).
 *
 * Everything the ranch runs on that is not feed, medicine, or engine-bearing —
 * shavings through show sticks. Purchases and usage follow the same shape as
 * feed on purpose: both land on the same boarding invoice in Phase 5, and a
 * client would notice if the two were costed differently.
 */

export * from "./domain/supply-item.js";
export * from "./domain/durable.js";
