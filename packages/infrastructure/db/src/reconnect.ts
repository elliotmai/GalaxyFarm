/**
 * Surviving a connection that died while nobody was using it.
 *
 * `database()` keeps one postgres.js connection per process and reuses it
 * across invocations. On a serverless host the process is frozen between
 * requests, so the driver's `idle_timeout` never fires — and meanwhile Neon
 * suspends an idle compute and drops every socket it was holding. The first
 * query after a quiet spell is written into that dead socket and fails with a
 * reset or a "connection closed", even though the database is fine and the
 * very next query would reconnect and succeed.
 *
 * That is what a barn screen hit: its sync pull every minute, a tick, a change
 * of board — whichever came first after the farm went quiet got a 500.
 */

/** postgres.js's own codes for a socket that went away under it. */
const DRIVER_CODES = new Set(["CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECTION_DESTROYED"]);

/** The operating system's version of the same thing. */
const SOCKET_CODES = new Set(["ECONNRESET", "EPIPE", "ETIMEDOUT"]);

/**
 * SQLSTATEs Postgres sends when it is the one closing the connection —
 * `57P01` admin_shutdown is what a Neon suspend looks like from the client,
 * and class `08` is connection exceptions.
 */
const isTerminationState = (code: string) => code === "57P01" || code.startsWith("08");

export function isDroppedConnection(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== "string") return false;
  return DRIVER_CODES.has(code) || SOCKET_CODES.has(code) || isTerminationState(code);
}

/**
 * Run a read, and run it once more if the first attempt hit a dead connection.
 *
 * Reads only. A write that failed on a reset may still have landed, and
 * repeating it is a decision for the use case, not for the plumbing. One retry
 * rather than a loop: the second attempt opens a fresh connection, so if that
 * fails too the database really is unreachable and the caller should hear so.
 */
export async function retryOnDroppedConnection<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (!isDroppedConnection(error)) throw error;
    return read();
  }
}
