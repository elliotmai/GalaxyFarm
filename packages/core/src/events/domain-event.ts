import type { Ulid } from "../types/ids.js";

/**
 * Modules never import each other (spec §4.1). They talk through IDs and these.
 *
 * `CalvingRecorded` is published by cattle and consumed by feed, which offers a
 * creep plan; the business module listens for `AnimalAgeThresholdReached` to
 * fire the bull-ringing deadline. Neither side knows the other exists, which is
 * exactly the property that lets horses bolt on later without touching cattle.
 */

export interface DomainEvent<TName extends string = string, TPayload = unknown> {
  readonly name: TName;
  readonly occurredAt: Date;
  readonly propertyId: Ulid;
  /** Which record this happened to, for tracing. */
  readonly aggregateId: Ulid;
  readonly payload: TPayload;
}

export type EventHandler<TEvent extends DomainEvent> = (event: TEvent) => void | Promise<void>;

/**
 * A minimal synchronous-registration bus.
 *
 * Handlers are awaited so a caller can know the fan-out finished, but one
 * handler throwing must not stop the others — a feed module that blows up
 * should not prevent a calving from being recorded.
 */
export class EventBus {
  private readonly handlers = new Map<string, Set<EventHandler<never>>>();

  on<TEvent extends DomainEvent>(name: TEvent["name"], handler: EventHandler<TEvent>): () => void {
    const existing = this.handlers.get(name) ?? new Set();
    existing.add(handler as EventHandler<never>);
    this.handlers.set(name, existing);
    return () => {
      existing.delete(handler as EventHandler<never>);
    };
  }

  /** Returns the errors thrown by handlers rather than swallowing them. */
  async publish(event: DomainEvent): Promise<unknown[]> {
    const handlers = this.handlers.get(event.name);
    if (handlers === undefined) return [];

    const errors: unknown[] = [];
    for (const handler of handlers) {
      try {
        await (handler as EventHandler<DomainEvent>)(event);
      } catch (error) {
        errors.push(error);
      }
    }
    return errors;
  }

  handlerCount(name: string): number {
    return this.handlers.get(name)?.size ?? 0;
  }

  clear(): void {
    this.handlers.clear();
  }
}

/** Events the kernel itself defines. Modules add their own. */
export type AnimalMovedEvent = DomainEvent<
  "AnimalMoved",
  { readonly animalId: Ulid; readonly fromZoneId?: Ulid; readonly toZoneId: Ulid }
>;

export type RecordDeletedEvent = DomainEvent<
  "RecordDeleted",
  { readonly entity: string; readonly recordId: Ulid; readonly deletedBy: Ulid }
>;

export type RecordRestoredEvent = DomainEvent<
  "RecordRestored",
  { readonly entity: string; readonly recordId: Ulid }
>;

export function createEvent<TName extends string, TPayload>(
  name: TName,
  input: {
    readonly occurredAt: Date;
    readonly propertyId: Ulid;
    readonly aggregateId: Ulid;
    readonly payload: TPayload;
  },
): DomainEvent<TName, TPayload> {
  return { name, ...input };
}
