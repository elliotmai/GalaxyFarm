import { z } from "zod";

import { addDays } from "../value-objects/date-range.js";
import { ulidSchema, type Ulid } from "../types/ids.js";
import { baseRecordSchema, type BaseRecord } from "./record.js";

/**
 * Notification settings, and what is due (spec §5.1, §6).
 *
 * §6 lists twenty-two default triggers and adds "per-trigger opt-out and
 * lead-time settings". Both halves matter: a farm app that cannot be told to
 * stop mentioning something is a farm app whose notifications get filtered to
 * a folder, and at that point every one of the twenty-two is lost including
 * the calving watch.
 *
 * The trigger list lives here rather than in each module because §6 owns it and
 * because the settings screen has to render all of them, including ones whose
 * module is not built yet. `tests/architecture/spec-coverage.test.ts` checks
 * this list against the spec's own prose.
 */

export const NOTIFICATION_TRIGGERS = [
  "vaccine_booster_due",
  "withdrawal_ending",
  "preg_check_due",
  "calving_window_opening",
  "sync_protocol_step_today",
  "feed_run_out_approaching",
  "med_expiring",
  "maintenance_due",
  "bull_ring_due",
  "departure_approaching",
  "new_booking_request",
  "liability_form_unsigned",
  "drop_off_pickup_reminder",
  "planting_window_opening",
  "chore_overdue",
  "low_semen_inventory",
  "supply_low_stock",
  "candidate_sale_date",
  "candidate_listing_expiring",
  "frost_warning",
  "tank_freeze_warning",
  "calving_watch",
] as const;
export type NotificationTrigger = (typeof NOTIFICATION_TRIGGERS)[number];

/**
 * Where one trigger's notifications go.
 *
 * `both` exists because the composite notifier does: a calving watch that
 * reaches a phone in the barn *and* an inbox to read later is the point of
 * having two channels at all, and a model that could only pick one would make
 * "turn push on" mean "turn email off". `none` is the opt-out §6 asks for, and
 * is not a channel anything sends to — see `deliveryChannels`.
 */
export const NOTIFICATION_CHANNELS = ["email", "push", "both", "none"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** A channel something is actually delivered on. `none` and `both` are choices, not routes. */
export const DELIVERY_CHANNELS = ["email", "push"] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

/**
 * Default lead times, in days.
 *
 * Chosen from how long the thing takes to act on rather than from a round
 * number: a tank-freeze warning is "the evening before" per §6, and a feed
 * run-out leads by the supplier's own lead time, which is a per-feed setting
 * rather than one of these.
 */
export const DEFAULT_LEAD_DAYS: Readonly<Record<NotificationTrigger, number>> = {
  vaccine_booster_due: 7,
  withdrawal_ending: 3,
  preg_check_due: 7,
  calving_window_opening: 7,
  sync_protocol_step_today: 0,
  feed_run_out_approaching: 0,
  med_expiring: 30,
  maintenance_due: 7,
  bull_ring_due: 14,
  departure_approaching: 21,
  new_booking_request: 0,
  liability_form_unsigned: 7,
  drop_off_pickup_reminder: 2,
  planting_window_opening: 7,
  chore_overdue: 0,
  low_semen_inventory: 0,
  supply_low_stock: 0,
  candidate_sale_date: 14,
  candidate_listing_expiring: 3,
  frost_warning: 1,
  tank_freeze_warning: 1,
  calving_watch: 0,
};

export interface NotificationSetting extends BaseRecord {
  readonly trigger: NotificationTrigger;
  readonly channel: NotificationChannel;
  readonly leadDays: number;
  readonly enabled: boolean;
  /** Per-user rather than per-property: two people want different noise. */
  readonly userId?: Ulid | undefined;
}

export const notificationSettingSchema = baseRecordSchema.extend({
  trigger: z.enum(NOTIFICATION_TRIGGERS),
  channel: z.enum(NOTIFICATION_CHANNELS),
  leadDays: z.number().int().min(0).max(365),
  enabled: z.boolean(),
  userId: ulidSchema.optional(),
}) as unknown as z.ZodType<NotificationSetting>;

/** One thing worth telling somebody about, already resolved to words. */
export interface PendingNotification {
  readonly trigger: NotificationTrigger;
  /** Stable, so the same alert is not sent twice by two devices. */
  readonly key: string;
  readonly subject: string;
  readonly body: string;
  readonly dueOn: Date;
  readonly source?: { readonly entity: string; readonly id: Ulid } | undefined;
}

export function settingFor(
  settings: readonly NotificationSetting[],
  trigger: NotificationTrigger,
  userId?: Ulid,
): NotificationSetting | undefined {
  return (
    settings.find((setting) => setting.trigger === trigger && setting.userId === userId) ??
    settings.find((setting) => setting.trigger === trigger && setting.userId === undefined)
  );
}

/**
 * Which channels one trigger may be delivered on (spec §6).
 *
 * The routing half of "per-trigger opt-out": `dueNotifications` decides
 * *whether* to say something, and this decides *where* it goes. They are
 * separate because a farm has two kinds of silence — "never tell me about
 * this" and "tell me, but not on my phone at 2am" — and a model with only the
 * first turns the second into the first.
 *
 * Two defaults worth stating, because both go the permissive way:
 *
 * - **No setting at all means every channel.** A trigger nobody has configured
 *   is one nobody has opted out of, and the same reasoning `dueNotifications`
 *   gives applies: a trigger that silently defaulted to off is one nobody
 *   knows they are missing.
 * - **No trigger on the message means every channel.** An invitation or a test
 *   send is not one of §6's twenty-two, so there is no preference to honour and
 *   nothing to suppress it.
 *
 * Neither default is as loud as it sounds, because a channel only delivers
 * where somebody has set it up: push reaches exactly the devices a person
 * subscribed by hand, and reaches nothing at all before they do.
 */
export function deliveryChannels(
  settings: readonly NotificationSetting[],
  trigger: NotificationTrigger | undefined,
  userId?: Ulid,
): readonly DeliveryChannel[] {
  if (trigger === undefined) return DELIVERY_CHANNELS;

  const setting = settingFor(settings, trigger, userId);
  if (setting === undefined) return DELIVERY_CHANNELS;
  if (!setting.enabled) return [];

  switch (setting.channel) {
    case "none":
      return [];
    case "email":
      return ["email"];
    case "push":
      return ["push"];
    case "both":
      return DELIVERY_CHANNELS;
  }
}

/**
 * Filter candidates down to the ones actually due, honouring the settings.
 *
 * The lead time is applied here rather than by each producing module, so
 * "tell me earlier about calving" is one setting change rather than an
 * argument threaded through six call sites. A trigger with no setting uses the
 * default and stays on — opting *out* has to be deliberate, because a trigger
 * that silently defaulted to off would be one nobody knows they are missing.
 */
export function dueNotifications(
  candidates: readonly PendingNotification[],
  settings: readonly NotificationSetting[],
  now: Date,
  userId?: Ulid,
): PendingNotification[] {
  return candidates
    .filter((candidate) => {
      const setting = settingFor(settings, candidate.trigger, userId);
      if (setting !== undefined && (!setting.enabled || setting.channel === "none")) return false;

      const leadDays = setting?.leadDays ?? DEFAULT_LEAD_DAYS[candidate.trigger];
      return now >= addDays(candidate.dueOn, -leadDays);
    })
    .sort(
      (left, right) =>
        left.dueOn.getTime() - right.dueOn.getTime() || left.key.localeCompare(right.key),
    );
}

/** Already sent? Keyed rather than counted, so a resend is a decision. */
export function unsent(
  due: readonly PendingNotification[],
  sentKeys: ReadonlySet<string>,
): PendingNotification[] {
  return due.filter((notification) => !sentKeys.has(notification.key));
}
