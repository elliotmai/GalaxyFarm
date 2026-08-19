import type { NotificationTrigger } from "../entities/notification.js";
import type { BaseRecord } from "../entities/record.js";
import type { Ulid } from "../types/ids.js";
import type { ListQuery } from "../crud/contracts.js";

export * from "./sync.js";
export * from "./weather.js";
export * from "./storage.js";
export * from "./photo-queue.js";
export * from "./invoicing.js";
export * from "./geocoder.js";
export * from "./composite-notifier.js";

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

/**
 * One notification, in both the forms a mail client might render it.
 *
 * `body` is the plain text and is required; `html` is optional and is a richer
 * rendering of the same thing, never additional content. Two reasons it is
 * that way round rather than the other: a text part is what a watch, a
 * screen reader, and a barn phone with images switched off actually show, and
 * an email sent as HTML alone is markedly more likely to be filed as spam.
 *
 * Web push, which §6 says arrives later behind this same port, has no HTML at
 * all — it will use `subject` and `body` and ignore the rest, which is the
 * property that keeps this a port and not a Resend-shaped hole.
 */
export interface NotificationMessage {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly html?: string | undefined;
  /** Where a reply should go, when that is not the sender. */
  readonly replyTo?: string | undefined;
  /**
   * Which of §6's triggers this is, when it is one of them.
   *
   * The one thing a message says about itself beyond its words, and it is here
   * so that no *caller* has to know how many channels exist: §6 gives every
   * trigger a per-user channel choice, something has to apply that choice, and
   * the alternative to naming the trigger is asking each sender to pick the
   * channels itself — which is the `if` in every call site this port exists to
   * avoid. `compositeNotifier` reads it; the Resend and web-push adapters both
   * ignore it.
   *
   * Optional because not every notification is one of the twenty-two. An
   * invitation and a test send have no trigger, no preference governing them,
   * and go out on whatever channel the caller asked for.
   */
  readonly trigger?: NotificationTrigger | undefined;
}

/**
 * What came back from handing a message over.
 *
 * The id is the provider's, and it is the whole reason this is not `void`:
 * "the farm sent it and the provider accepted it" and "it reached an inbox"
 * are different claims, and when somebody says an alert never arrived the id
 * is what turns that into a question a provider's log can answer. Optional,
 * because not every notifier has one to give.
 */
export interface NotificationReceipt {
  readonly id?: string | undefined;
}

export interface Notifier {
  send(input: NotificationMessage): Promise<NotificationReceipt>;
}

/** A fixed clock, for tests and for replaying a sync batch at one timestamp. */
export function fixedClock(at: Date): Clock {
  return { now: () => at };
}

export function systemClock(): Clock {
  return { now: () => new Date() };
}
