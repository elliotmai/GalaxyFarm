import { z } from "zod";

import { moneySchema, type Money } from "../value-objects/money.js";
import { baseRecordSchema, type BaseRecord } from "./record.js";

/**
 * The generic roadmap (spec §5.1) — used by cattle, horses, and equipment.
 *
 * A roadmap item is a *want*: "truck, need, ASAP", "reach 20 head by year five",
 * "improve calving ease". What you are actually looking at to satisfy that want
 * is a PurchaseCandidate, which is a different entity for a good reason.
 */

export const ROADMAP_ITEM_TYPES = ["goal", "milestone", "wishlist", "planned_action"] as const;
export type RoadmapItemType = (typeof ROADMAP_ITEM_TYPES)[number];

export const ROADMAP_DOMAINS = ["cattle", "horses", "equipment"] as const;
export type RoadmapDomain = (typeof ROADMAP_DOMAINS)[number];

export const PRIORITIES = ["need", "want", "someday"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const ROADMAP_STATUSES = ["open", "in_progress", "achieved", "dropped"] as const;
export type RoadmapStatus = (typeof ROADMAP_STATUSES)[number];

export interface RoadmapItem extends BaseRecord {
  readonly domain: RoadmapDomain;
  readonly type: RoadmapItemType;
  readonly title: string;
  readonly detail?: string | undefined;
  readonly targetDate?: Date | undefined;
  readonly targetSeason?: string | undefined;
  readonly priority: Priority;
  readonly budgetEstimate?: Money | undefined;
  readonly status: RoadmapStatus;
}

export const roadmapItemSchema = baseRecordSchema.extend({
  domain: z.enum(ROADMAP_DOMAINS),
  type: z.enum(ROADMAP_ITEM_TYPES),
  title: z.string().min(1, "A roadmap item needs a title").max(120),
  detail: z.string().max(5000).optional(),
  targetDate: z.coerce.date().optional(),
  targetSeason: z.string().max(40).optional(),
  priority: z.enum(PRIORITIES),
  budgetEstimate: moneySchema.optional(),
  status: z.enum(ROADMAP_STATUSES),
}) as unknown as z.ZodType<RoadmapItem>;

export function isRoadmapOpen(item: Pick<RoadmapItem, "status">): boolean {
  return item.status === "open" || item.status === "in_progress";
}

/** Needs first, then wants, then somedays — the order you actually shop in. */
export function byPriority(left: RoadmapItem, right: RoadmapItem): number {
  return PRIORITIES.indexOf(left.priority) - PRIORITIES.indexOf(right.priority);
}
