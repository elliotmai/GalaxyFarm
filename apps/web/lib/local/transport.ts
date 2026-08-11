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
 * A per-entity list would be exact and would also be a list somebody forgets
 * to update the day they add `weanedAt`. The convention is already enforced by
 * the schema — every timestamp column in Postgres is `*_at` or `*Date` — so
 * the naming is the contract.
 */
function isDateField(field: string): boolean {
  return /(At|Date)$/.test(field) || (BASE_DATE_FIELDS as readonly string[]).includes(field);
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
