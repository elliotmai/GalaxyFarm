import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

/**
 * Connecting to Neon.
 *
 * Neon scales to zero, so the first query after an idle period pays a cold
 * start of a second or so. That is tolerable here only because nothing a person
 * is looking at waits on it — screens read the local store and the sync engine
 * reconciles in the background (§4.2). The settings below are about surviving
 * that cold start rather than hiding it.
 *
 * Nothing here is Neon-specific in the way that matters: it is the postgres.js
 * driver against a connection string, so §10's move to a box in the barn is a
 * change of `DATABASE_URL`.
 */

export interface ConnectionOptions {
  /**
   * Connections per process. One is right for a serverless function, which
   * gets its own process and would otherwise hold connections Neon has to
   * account for; a long-lived server should raise it.
   */
  readonly max?: number;
  /** Seconds to wait for a connection — long enough to cover a cold start. */
  readonly connectTimeoutSeconds?: number;
  /** Seconds an unused connection is kept before it is dropped. */
  readonly idleTimeoutSeconds?: number;
}

/**
 * Driver options, separated from the connecting so they can be asserted
 * without a database. Getting `prepare` wrong is the kind of thing that passes
 * every test and then fails against the pooled endpoint in production.
 */
export function connectionConfig(options: ConnectionOptions = {}) {
  return {
    max: options.max ?? 1,
    connect_timeout: options.connectTimeoutSeconds ?? 30,
    idle_timeout: options.idleTimeoutSeconds ?? 20,
    // Neon's pooled endpoint is PgBouncer in transaction mode, which cannot
    // carry a prepared statement across whichever pooled connection it hands
    // you next. Disabled on the direct endpoint too, so the two behave alike.
    prepare: false,
    onnotice: () => {},
  } as const;
}

/**
 * What a connection string points at, with the password removed.
 *
 * Every "which database did that run against?" question wants this, and the
 * obvious way to answer it — logging the URL — writes the password into CI
 * output that outlives the run.
 */
export function describeConnection(url: string): {
  host: string;
  database: string;
  pooled: boolean;
} {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    database: parsed.pathname.replace(/^\//, ""),
    // Neon's `-pooler` host is the PgBouncer one. Worth knowing at a glance:
    // migrations want the direct endpoint, application traffic wants this one.
    pooled: parsed.hostname.includes("-pooler."),
  };
}

export function createDatabase(url: string, options: ConnectionOptions = {}) {
  const sql = postgres(url, connectionConfig(options));
  // No schema handed to drizzle: nothing here uses the relational query API,
  // and registering one narrows the instance's type so it no longer satisfies
  // the plain `Database` the repositories and sync handlers are written
  // against. Queries name their table explicitly instead.
  return { db: drizzle(sql), close: () => sql.end() };
}
