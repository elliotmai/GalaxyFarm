/**
 * Bounding how long a page render waits on the database (spec §4.2).
 *
 * Almost nothing in this app reads from Postgres — screens read the device's
 * own store, which is what makes the barn usable at zero bars. The exceptions
 * are the pages that cannot: settings, which lists people; the invitation
 * page, which has to look a token up; and the kiosk home, which asks whether a
 * PIN is set before it offers the gate. All render on the server, so all of
 * them make somebody wait.
 *
 * That wait needs a ceiling, and the driver does not give it one that helps.
 * `connect_timeout` is thirty seconds — deliberately, to survive a Neon cold
 * start — and the pool is one connection deep, so when the database is not
 * answering, queries queue behind a connection that is retrying with backoff.
 * Measured against a dead database, six concurrent requests took 0.07s, 0.45s,
 * 1.7s, 7.3s, 18.5s, and 31s. The first person gets an apology and the sixth
 * gets a spinner until they give up.
 *
 * So the page stops waiting before that, and renders the same "could not reach
 * it" state it already has for an outright failure. The query is abandoned
 * rather than cancelled — there is nothing useful to cancel, and the next
 * request pays no penalty for it.
 */

/**
 * Long enough for the cold start the driver's timeout exists for, short enough
 * that nobody sits looking at a blank page. Neon's cold start is about a
 * second; eight is generous without being a wait anybody would tolerate twice.
 */
export const DATABASE_DEADLINE_MS = 8_000;

export class DeadlineExceededError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} did not answer within ${ms}ms`);
    this.name = "DeadlineExceededError";
  }
}

/**
 * Resolve with the work, or reject once the deadline passes.
 *
 * The timer is always cleared, including on the happy path — a pending timer
 * keeps a serverless invocation alive past the response it was holding up.
 */
export async function withDeadline<T>(
  work: Promise<T>,
  label: string,
  ms: number = DATABASE_DEADLINE_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineExceededError(label, ms)), ms);
  });

  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // The abandoned query will still reject on its own schedule, and an
    // unhandled rejection takes the whole server down with it.
    void work.catch(() => undefined);
  }
}
