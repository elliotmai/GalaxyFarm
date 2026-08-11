import { EventBus, type DomainEvent } from "@galaxy-farm/core";

/**
 * Where the modules meet (spec §4.1).
 *
 * `apps/web` is the composition root and the only place allowed to know that
 * both cattle and feed exist. Cattle publishes `CalvingRecorded`; feed's creep
 * suggestion is offered by whatever screen subscribes. Neither module imports
 * the other, and `boundaries.test.ts` fails the build if one ever does.
 *
 * One bus per tab, for the same reason there is one local store per tab: two
 * buses would each hold half the handlers, and which half depended on import
 * order.
 */

let bus: EventBus | undefined;

export function eventBus(): EventBus {
  bus ??= new EventBus();
  return bus;
}

/**
 * Publish, and never let a listener take the write down with it.
 *
 * `EventBus.publish` already collects handler errors rather than throwing, so
 * this exists to make the *decision* explicit at the call site: a calving is
 * recorded whether or not the feed module manages to offer a creep plan. The
 * errors are logged because silently dropping them is how a listener stays
 * broken for a season.
 */
export async function publish(event: DomainEvent): Promise<void> {
  const errors = await eventBus().publish(event);
  for (const error of errors) {
    console.error(`Handler for ${event.name} failed`, error);
  }
}

/** Tests and hot reloads need a way back to a clean slate. */
export function resetEventBus(): void {
  bus = undefined;
}
