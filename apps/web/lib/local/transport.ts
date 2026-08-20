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
  // A planting window is a fortnight, so it is a pair of dates rather than a
  // `*On` (§5.5). Named here rather than matched by a `*From`/`*To` suffix for
  // the reason given below.
  "windowFrom",
  "windowTo",
]);

export function isDateField(field: string): boolean {
  // Suffixes for the ones that follow a pattern, an explicit list for the rest.
  // Deliberately *not* matching `*From$`/`*To$` as suffixes: the test below
  // only catches timestamps this misses, and a future `assignedTo` holding a
  // user id would be silently turned into an Invalid Date — a false positive
  // no test here would see.
  return /(At|On|Date)$/.test(field) || NAMED_DATE_FIELDS.has(field);
}

/**
 * The same rule, inside a JSON blob.
 *
 * Several entities keep a small object or a list in one column — a pregnancy
 * check, a hair card, a registration — and the timestamps inside them are as
 * real as the ones in columns of their own. Walking only the top level left
 * them as strings, and a string is not a `Date`: the genetics panel called
 * `toLocaleDateString` on a hair card's `testedOn` and took the whole app down
 * with "a client-side exception has occurred". The same trap was one click
 * away on a breeding's `pregCheck.date`.
 *
 * Strings are matched by the key that holds them, exactly as at the top level,
 * so nothing new has to be listed here for a nested date to be revived. An
 * element inside an array is judged by the key the array itself sits under, so
 * a list of timestamps works and `photoKeys` is left alone.
 *
 * One difference from the top level, deliberately: a nested string that does
 * not parse is *kept* rather than dropped. At the top level these are columns
 * the schema says are timestamps, so an unparseable one is corrupt and NaN is
 * worse than absent. In a blob the key is a convention rather than a promise —
 * a `date` inside somebody's free-form settings could be the word "spring" —
 * and deleting a value nobody asked us to interpret is the worse mistake.
 */
function reviveNested(value: unknown, field: string): unknown {
  if (typeof value === "string") {
    if (!isDateField(field)) return value;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date;
  }

  if (Array.isArray(value)) return value.map((entry) => reviveNested(entry, field));

  if (typeof value === "object" && value !== null) {
    const revived: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (inner === null) continue;
      revived[key] = reviveNested(inner, key);
    }
    return revived;
  }

  return value;
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
    if (value !== null) record[field] = reviveNested(value, field);
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
