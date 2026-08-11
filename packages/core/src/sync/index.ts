/**
 * Sync rules that are domain logic, not transport (spec §4.2).
 *
 * What a patch is, what a diff is, and who wins a contested field are decided
 * here so the device and the server reach the same answer by running the same
 * code — not by two implementations that agree until they do not.
 */

export * from "./patch.js";
export * from "./merge.js";
export * from "./cursors.js";
export * from "./transport.js";
export * from "./retry.js";
