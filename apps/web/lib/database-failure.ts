import { DeadlineExceededError } from "@/lib/deadline";

/**
 * Saying which way the database failed (spec §4.2).
 *
 * Almost nothing here reads from Postgres — screens read the device. The two
 * that must, settings and the invitation page, previously said one sentence
 * for every way it could go wrong: "could not reach the database". That
 * sentence is true of a connection refused and false of the other three
 * things that actually happen, and each of them wants a different next step:
 *
 *   - **Not configured.** No `DATABASE_URL`. Fix a file.
 *   - **Schema behind.** The build expects a column the database has not got,
 *     because a deploy published ahead of its migration. Wait, or run one.
 *   - **Waking.** Neon scales an idle database to zero and the first request
 *     after that pays the wake-up. Reload.
 *   - **Unreachable.** Genuinely nothing answering. Somebody has to look.
 *
 * Told apart by SQLSTATE and by the error's own type, without a second query:
 * this runs on a page render that has already spent its patience, and the
 * richer drift report in `api-errors.ts` — which does make another round trip
 * — belongs on the sync route, which can afford one.
 */

/** Postgres errors carry a five-character SQLSTATE; ours do not. */
export function sqlState(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
}

/** `42P01` undefined_table, `42703` undefined_column. */
export const SCHEMA_CODES: ReadonlySet<string> = new Set(["42P01", "42703"]);

export type DatabaseFailureKind = "not-configured" | "schema-behind" | "waking" | "unreachable";

export interface DatabaseFailure {
  readonly kind: DatabaseFailureKind;
  /** One sentence for whoever is looking at the screen. */
  readonly message: string;
  /** Whether trying again in a moment is likely to work. */
  readonly retryable: boolean;
}

export function classifyDatabaseFailure(error: unknown): DatabaseFailure {
  if (error instanceof DeadlineExceededError) {
    return {
      kind: "waking",
      message:
        "The database did not answer in time. An idle one is allowed to sleep, and the first request after that pays the wake-up — try again in a moment.",
      retryable: true,
    };
  }

  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("DATABASE_URL is not set")) {
    return {
      kind: "not-configured",
      message:
        "This app has no database connection string. Copy .env.example to .env.local and fill in DATABASE_URL.",
      retryable: false,
    };
  }

  const state = sqlState(error);
  if (state !== undefined && SCHEMA_CODES.has(state)) {
    return {
      kind: "schema-behind",
      message:
        "The database is missing something this version of the app expects, which means a migration has not been applied yet. A deploy can publish a few minutes ahead of its migration — wait and reload. If it persists, run pnpm db:migrate.",
      retryable: true,
    };
  }

  return {
    kind: "unreachable",
    message: `Could not reach the database: ${message}`,
    retryable: true,
  };
}
