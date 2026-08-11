import {
  SyncServerError,
  type BaseRecord,
  type CursorSet,
  type OutboxEntry,
  type PullPage,
  type PushResult,
  type SyncTransport,
} from "@galaxy-farm/core";

/**
 * The engine's transport, over HTTP (spec §4.2).
 *
 * Small on purpose. The engine owns the reconciliation logic — what to retry,
 * in what order, how long to wait — and this only carries bytes. Everything
 * interesting is already tested against a fake transport that fails, delays,
 * and reorders; putting judgement in here would put it somewhere that only a
 * real server can exercise.
 *
 * Dates go out as ISO strings and come back the same way, so the reviving
 * happens on both ends: the server has `lib/sync-payload.ts`, and this has
 * `reviveRecord` below. A `Date` that arrives as a string does not throw — it
 * produces NaN comparisons that silently lose, which is why neither end trusts
 * the other to have done it.
 */

/** Fields that are Dates on every record, whatever the entity. */
const BASE_DATE_FIELDS = ["createdAt", "updatedAt", "deletedAt"] as const;

/**
 * Anything named like a timestamp is one.
 *
 * By name, because this runs in the browser and cannot import the drizzle
 * schema to ask. The push side *does* ask the schema — see `dateFieldsOf` —
 * and this is the one place a convention still stands in for the truth.
 *
 * It used to claim "every timestamp column in Postgres is `*_at` or `*Date`",
 * and that was simply untrue: the schema has `date`, `dob`, `performed_on`,
 * `period_from`, `period_to`. A missed timestamp arrives as a string, every
 * comparison against it is NaN, and a cow drops out of her own calving window
 * with nothing logged anywhere.
 *
 * So it is no longer a claim. `tests/date-fields.test.ts` walks every table in
 * the schema and fails the build if a timestamp column is not matched here —
 * add one named `weanedAt` and it passes, add one named `weaned` and the build
 * tells you to fix the name or this predicate.
 */
const NAMED_DATE_FIELDS: ReadonlySet<string> = new Set([
  ...BASE_DATE_FIELDS,
  "date",
  "dob",
  "at",
  "periodFrom",
  "periodTo",
  "accessFrom",
  "accessTo",
  "firstSeen",
]);

export function isDateField(field: string): boolean {
  // Suffixes for the ones that follow a pattern, an explicit list for the rest.
  // Deliberately *not* matching `*From$`/`*To$` as suffixes: the test below
  // only catches timestamps this misses, and a future `assignedTo` holding a
  // user id would be silently turned into an Invalid Date — a false positive
  // no test here would see.
  return /(At|On|Date)$/.test(field) || NAMED_DATE_FIELDS.has(field);
}

export function reviveRecord<T extends BaseRecord>(raw: Record<string, unknown>): T {
  const record: Record<string, unknown> = {};

  for (const [field, value] of Object.entries(raw)) {
    if (value !== null && typeof value === "string" && isDateField(field)) {
      const date = new Date(value);
      // An unparseable timestamp is dropped rather than stored as an Invalid
      // Date. Absent is a state the code already handles; NaN is not.
      record[field] = Number.isNaN(date.getTime()) ? undefined : date;
      continue;
    }
    // null becomes absent, matching what the repositories do on both sides.
    if (value !== null) record[field] = value;
  }

  return record as T;
}

export interface HttpTransportOptions {
  /** Overridden in tests; the real thing is `fetch`. */
  readonly fetch?: typeof globalThis.fetch;
  readonly pushUrl?: string;
  readonly pullUrl?: string;
}

export function httpTransport<T extends BaseRecord>(
  options: HttpTransportOptions = {},
): SyncTransport<T> {
  const call = options.fetch ?? globalThis.fetch.bind(globalThis);
  const pushUrl = options.pushUrl ?? "/api/sync/push";
  const pullUrl = options.pullUrl ?? "/api/sync/pull";

  async function post(url: string, body: unknown): Promise<unknown> {
    const response = await call(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      // Thrown, not returned: the outbox stays intact and the engine backs off.
      // But a server that answered is not the same as one that was not there —
      // no signal in a pasture is normal and fixes itself, a 500 does not — so
      // this carries the status and whatever the server said about why.
      const detail = (await response.json().catch(() => undefined)) as
        { error?: string; kind?: string } | undefined;

      throw new SyncServerError(
        response.status,
        detail?.error ?? `${url} responded ${response.status}`,
        detail?.kind,
      );
    }

    return response.json();
  }

  return {
    async push(entries: readonly OutboxEntry[]): Promise<PushResult> {
      const body = (await post(pushUrl, { entries })) as {
        accepted?: string[];
        rejected?: { id: string; reason: string }[];
        audit?: unknown[];
      };

      return {
        accepted: (body.accepted ?? []) as unknown as PushResult["accepted"],
        rejected: (body.rejected ?? []) as unknown as PushResult["rejected"],
        // The audit is display-only — a change log someone reads later. It is
        // not revived because nothing computes with it here.
        audit: (body.audit ?? []) as PushResult["audit"],
      };
    },

    async pull(cursors: CursorSet, entities: readonly string[]): Promise<PullPage<T>[]> {
      const body = (await post(pullUrl, { cursors, entities })) as {
        pages?: { entity: string; records: Record<string, unknown>[]; hasMore: boolean }[];
      };

      return (body.pages ?? []).map((page) => ({
        entity: page.entity,
        records: page.records.map((record) => reviveRecord<T>(record)),
        hasMore: page.hasMore,
      }));
    },
  };
}
