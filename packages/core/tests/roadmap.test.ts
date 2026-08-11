import { describe, expect, it } from "vitest";

import {
  byPriority,
  isRoadmapOpen,
  roadmapItemSchema,
  type RoadmapItem,
} from "../src/entities/roadmap.js";
import { fromDollars } from "../src/value-objects/money.js";
import { encodeUlid, type Ulid } from "../src/types/ids.js";

let counter = 0;
const nextId = (): Ulid => encodeUlid(3_000 + counter++, () => 0.5);

const item = (overrides: Partial<RoadmapItem> = {}): RoadmapItem =>
  ({
    id: nextId(),
    propertyId: nextId(),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    domain: "equipment",
    type: "wishlist",
    title: "Truck",
    priority: "need",
    status: "open",
    ...overrides,
  }) as RoadmapItem;

describe("RoadmapItem", () => {
  it("validates, including a budget", () => {
    expect(roadmapItemSchema.safeParse(item({ budgetEstimate: fromDollars(35_000) })).success).toBe(
      true,
    );
  });

  it("requires a title", () => {
    expect(roadmapItemSchema.safeParse(item({ title: "" })).success).toBe(false);
  });

  it("treats open and in-progress as live", () => {
    expect(isRoadmapOpen({ status: "open" })).toBe(true);
    expect(isRoadmapOpen({ status: "in_progress" })).toBe(true);
    expect(isRoadmapOpen({ status: "achieved" })).toBe(false);
    expect(isRoadmapOpen({ status: "dropped" })).toBe(false);
  });

  it("sorts needs before wants before somedays — the order you shop in", () => {
    const sorted = [
      item({ priority: "someday", title: "ATV" }),
      item({ priority: "need", title: "Truck" }),
      item({ priority: "want", title: "Tractor" }),
    ].sort(byPriority);

    expect(sorted.map((i) => i.title)).toEqual(["Truck", "Tractor", "ATV"]);
  });
});
