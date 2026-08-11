import { describe, expect, it, vi } from "vitest";

import { EventBus, createEvent, type DomainEvent } from "../src/events/domain-event.js";
import { encodeUlid, type Ulid } from "../src/types/ids.js";

let counter = 0;
const nextId = (): Ulid => encodeUlid(5_000 + counter++, () => 0.5);

const event = (name = "CalvingRecorded"): DomainEvent =>
  createEvent(name, {
    occurredAt: new Date("2026-03-01T00:00:00Z"),
    propertyId: nextId(),
    aggregateId: nextId(),
    payload: { calfId: nextId() },
  });

describe("EventBus — how modules talk without importing each other", () => {
  it("delivers an event to a registered handler", async () => {
    // Spec §4.1: cattle publishes CalvingRecorded, feed offers a creep plan,
    // and neither module knows the other exists.
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on("CalvingRecorded", handler);

    await bus.publish(event());

    expect(handler).toHaveBeenCalledOnce();
  });

  it("delivers to every handler for the same event", async () => {
    const bus = new EventBus();
    const first = vi.fn();
    const second = vi.fn();
    bus.on("CalvingRecorded", first);
    bus.on("CalvingRecorded", second);

    await bus.publish(event());

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it("ignores handlers registered for other events", async () => {
    const bus = new EventBus();
    const other = vi.fn();
    bus.on("AnimalMoved", other);

    await bus.publish(event("CalvingRecorded"));

    expect(other).not.toHaveBeenCalled();
  });

  it("is a no-op when nobody is listening", async () => {
    const bus = new EventBus();

    await expect(bus.publish(event())).resolves.toEqual([]);
  });

  it("awaits async handlers", async () => {
    const bus = new EventBus();
    let finished = false;
    bus.on("CalvingRecorded", async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      finished = true;
    });

    await bus.publish(event());

    expect(finished).toBe(true);
  });

  it("one failing handler does not stop the others", async () => {
    // A feed module that blows up must not prevent a calving being recorded.
    const bus = new EventBus();
    const survivor = vi.fn();
    bus.on("CalvingRecorded", () => {
      throw new Error("creep plan exploded");
    });
    bus.on("CalvingRecorded", survivor);

    const errors = await bus.publish(event());

    expect(survivor).toHaveBeenCalledOnce();
    expect(errors).toHaveLength(1);
  });

  it("returns errors rather than swallowing them", async () => {
    const bus = new EventBus();
    bus.on("CalvingRecorded", () => {
      throw new Error("boom");
    });

    const errors = await bus.publish(event());

    expect((errors[0] as Error).message).toBe("boom");
  });

  it("unsubscribes", async () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const off = bus.on("CalvingRecorded", handler);

    off();
    await bus.publish(event());

    expect(handler).not.toHaveBeenCalled();
    expect(bus.handlerCount("CalvingRecorded")).toBe(0);
  });

  it("counts handlers and clears them", () => {
    const bus = new EventBus();
    bus.on("CalvingRecorded", vi.fn());
    bus.on("CalvingRecorded", vi.fn());

    expect(bus.handlerCount("CalvingRecorded")).toBe(2);
    expect(bus.handlerCount("Nothing")).toBe(0);

    bus.clear();
    expect(bus.handlerCount("CalvingRecorded")).toBe(0);
  });

  it("builds an event with its metadata intact", () => {
    const built = event("AnimalMoved");

    expect(built.name).toBe("AnimalMoved");
    expect(built.occurredAt).toEqual(new Date("2026-03-01T00:00:00Z"));
    expect(built.payload).toBeDefined();
  });
});
