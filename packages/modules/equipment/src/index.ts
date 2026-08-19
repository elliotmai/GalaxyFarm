/**
 * The equipment module (spec §5.6).
 *
 * Fleet, meters, maintenance rules and fuel. The candidate extension lives
 * alongside, because §5.1's PurchaseCandidate carries the shared fields and
 * what equipment adds — year, mileage, hours, title status — is what the
 * comparison view sorts and divides by.
 */

export * from "./domain/calendar.js";
export * from "./domain/equipment.js";
export * from "./domain/equipment-candidate.js";
