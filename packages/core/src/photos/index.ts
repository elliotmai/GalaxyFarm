/**
 * The photo pipeline's domain half (spec §4.2, §5.1).
 *
 * Everything here is pure: what a photo may be, how big it should end up, what
 * a device asks the server for, and which property an object belongs to. The
 * canvas that does the compressing and the queue that survives the app being
 * killed are adapters; these are the rules both of them obey.
 */

export * from "./compression.js";
export * from "./presign.js";
export * from "./transport.js";
