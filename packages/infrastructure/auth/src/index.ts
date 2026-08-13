/**
 * Auth.js wiring against our own Postgres (spec §4.3).
 *
 * This package holds the credential logic and nothing about the database. The
 * store is a port, implemented in the app's composition root — §4.1 forbids
 * one adapter importing another, and it is what keeps the sign-in path
 * testable without a Postgres.
 */

export * from "./password.js";
export * from "./invitation.js";
export * from "./sign-in.js";
