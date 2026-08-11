/**
 * The poultry module (spec §5.4).
 *
 * Flocks with an auditable headcount, egg logs built for a kiosk +1 button,
 * and a light disposition log that keeps the door open to selling eggs without
 * pretending it is a business.
 *
 * Hatching and incubation are deliberately absent — §5.4 says they are not
 * built, and the module boundary leaves the seam clean if that changes.
 */

export * from "./domain/flock.js";
export * from "./domain/eggs.js";
