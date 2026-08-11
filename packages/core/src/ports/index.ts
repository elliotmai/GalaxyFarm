import type { BaseRecord } from "../entities/record.js";
import type { Ulid } from "../types/ids.js";
import type { ListQuery } from "../crud/contracts.js";

export * from "./sync.js";

/**
 * Ports the domain defines and infrastructure implements (spec §4.1).
 *
 * These exist so the domain can be tested with no infrastructure at all, and so
 * the Postgres and IndexedDB repositories can be held to the same contract —
 * which is what stops the two stores drifting apart.
 */

export interface ReadRepository<T extends BaseRecord> {
  findById(id: Ulid): Promise<T | undefined>;
  list(query: ListQuery): Promise<T[]>;
  count(query: ListQuery): Promise<number>;
}

export interface Repository<T extends BaseRecord> extends ReadRepository<T> {
  save(record: T): Promise<void>;
  saveMany(records: readonly T[]): Promise<void>;
  /** Hard removal. Only the owner-only purge path calls this (§4.5). */
  purge(id: Ulid): Promise<void>;
}

export type Unsubscribe = () => void;

/**
 * A repository whose reads can be watched.
 *
 * This is what makes local-first feel local: the Pen Board on a barn kiosk has
 * to redraw when someone moves an animal from the house, and that change
 * arrives through a sync pull rather than through anything the kiosk did. A
 * store that only notifies on local writes would leave every other screen
 * stale until somebody refreshed it.
 */
export interface ObservableRepository<T extends BaseRecord> extends Repository<T> {
  observe(query: ListQuery, onChange: (records: T[]) => void): Unsubscribe;
  observeById(id: Ulid, onChange: (record: T | undefined) => void): Unsubscribe;
}

/** Injected so the domain stays pure and tests are deterministic. */
export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): Ulid;
}

export interface Notifier {
  send(input: {
    readonly to: string;
    readonly subject: string;
    readonly body: string;
  }): Promise<void>;
}

/** A fixed clock, for tests and for replaying a sync batch at one timestamp. */
export function fixedClock(at: Date): Clock {
  return { now: () => at };
}

export function systemClock(): Clock {
  return { now: () => new Date() };
}
