/**
 * The feed module (spec §5.3).
 *
 * Cross-species on purpose: one round bale feeds cattle and one bag of scratch
 * feeds chickens, and the run-out projection that decides when to buy more is
 * the same arithmetic either way. §4.1 keeps it out of the cattle module for
 * exactly that reason.
 *
 * The plans themselves live in the kernel — `FeedingPlan` is §5.1 — because
 * poultry and horses will target them too. What is here is the inventory, the
 * projection, and who the bill belongs to.
 */

export * from "./domain/feed-type.js";
export * from "./domain/grain-measures.js";
export * from "./domain/inventory.js";
export * from "./domain/allocation.js";
export * from "./domain/creep-plan.js";
