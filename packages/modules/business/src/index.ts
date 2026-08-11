/**
 * The business module (spec §5.7) — scaffold: full schema and rules now, UI in
 * Phase 5.
 *
 * Two parts are live well before the screens are. The rule engine, because
 * §5.7 asks for "first-class, testable policy objects" and those rules are also
 * the text of an agreement somebody signs. And ProgramEnrollment, because
 * §12 decision 11 decoupled the programme from ownership — your own show calves
 * run the identical pipeline, and the roster is the real capacity picture
 * whether or not a customer ever books.
 */

export * from "./domain/rules.js";
export * from "./domain/entities.js";
export * from "./domain/schedule.js";
