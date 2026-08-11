/**
 * Who may do what (spec §4.3).
 *
 * In the kernel because §4.3 puts permission checks in the application layer:
 * a use case declares the capability it needs, and the answer is a pure
 * function of the actor. Infrastructure supplies the actor; it does not decide.
 */

export * from "./capabilities.js";
