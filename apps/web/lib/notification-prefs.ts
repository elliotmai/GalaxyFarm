import { and, eq, isNull, or } from "drizzle-orm";

import {
  DEFAULT_LEAD_DAYS,
  deliveryChannels,
  encodeUlid,
  type ChannelRouter,
  type NotificationChannel,
  type NotificationSetting,
  type NotificationTrigger,
  type Ulid,
} from "@galaxy-farm/core";
import { notificationSettings, type Database } from "@galaxy-farm/infra-db";

import { database } from "@/lib/credential-store";
import { findUserByEmail } from "@/lib/user-store";

/**
 * The §6 preference model, in Postgres (spec §6).
 *
 * §6 asks for "per-trigger opt-out and lead-time settings", and until there
 * was a second channel that was a list with one column: on or off. Push makes
 * it a routing question — "tell me, but not on my phone" is now a thing
 * somebody can mean — so the rows are stored per person and read at the moment
 * something is about to be sent.
 *
 * Off the sync engine, like `push-store.ts` beside it, for a quieter reason:
 * these rows are read on the server by the thing doing the sending, and no
 * screen needs a local copy of somebody else's choices. The doc comment on the
 * table says the same.
 *
 * A person with no rows at all is not opted out of anything — `deliveryChannels`
 * in core treats an absent setting as every channel, and the default is only as
 * loud as the channels somebody has actually set up.
 */

export interface SettingInput {
  readonly propertyId: Ulid;
  readonly userId: Ulid;
  readonly trigger: NotificationTrigger;
  readonly channel: NotificationChannel;
  readonly leadDays?: number;
}

function settingFromRow(row: typeof notificationSettings.$inferSelect): NotificationSetting {
  return {
    id: row.id as Ulid,
    propertyId: row.propertyId as Ulid,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    trigger: row.trigger as NotificationTrigger,
    channel: row.channel as NotificationChannel,
    leadDays: row.leadDays,
    enabled: row.enabled,
    ...(row.userId === null ? {} : { userId: row.userId as Ulid }),
  };
}

/**
 * One person's settings, plus the property-wide defaults behind them.
 *
 * Both, in one read, because `settingFor` in core resolves the pair and
 * fetching only the personal rows would silently promote a property-wide
 * "off" back to on.
 */
export async function settingsFor(
  propertyId: Ulid,
  userId: Ulid,
  db: Database = database(),
): Promise<NotificationSetting[]> {
  const rows = await db
    .select()
    .from(notificationSettings)
    .where(
      and(
        eq(notificationSettings.propertyId, propertyId),
        or(eq(notificationSettings.userId, userId), isNull(notificationSettings.userId)),
      ),
    );

  return rows.map(settingFromRow);
}

/**
 * Record what somebody chose for one trigger.
 *
 * `enabled` is derived from the channel rather than set separately: the screen
 * offers one control per trigger — email, push, both, or off — and two fields
 * that can disagree about whether something is switched off would eventually
 * disagree. `dueNotifications` reads `enabled` and `deliveryChannels` reads
 * `channel`, so they are written to agree.
 */
export async function saveSetting(
  input: SettingInput,
  now: Date,
  db: Database = database(),
): Promise<void> {
  const row = {
    id: encodeUlid(now.getTime()),
    propertyId: input.propertyId,
    userId: input.userId,
    trigger: input.trigger,
    channel: input.channel,
    leadDays: input.leadDays ?? DEFAULT_LEAD_DAYS[input.trigger],
    enabled: input.channel !== "none",
    createdAt: now,
    updatedAt: now,
  };

  await db
    .insert(notificationSettings)
    .values(row)
    .onConflictDoUpdate({
      target: [
        notificationSettings.propertyId,
        notificationSettings.userId,
        notificationSettings.trigger,
      ],
      set: {
        channel: row.channel,
        leadDays: row.leadDays,
        enabled: row.enabled,
        updatedAt: now,
      },
    });
}

/**
 * The router the composite notifier is built with (§6).
 *
 * This is the seam that keeps push from becoming a way around a preference.
 * Every message goes through it, the settings are the recipient's own, and a
 * trigger switched off resolves to no channels at all — not to "email only,
 * because push was the thing being configured".
 *
 * An address that belongs to nobody on the farm — a contact, a vet — gets the
 * default. There are no preferences to honour for somebody who has no account,
 * and no subscriptions either, so push quietly reaches nothing.
 */
export function preferenceRouter(db?: Database): ChannelRouter {
  return async (message) => {
    // A message with no trigger is not one §6 governs, and answering it costs
    // no query. Worth the early return for a second reason: the database is
    // resolved lazily below, so building a notifier never opens a connection.
    if (message.trigger === undefined) return deliveryChannels([], undefined);

    const connection = db ?? database();
    const user = await findUserByEmail(message.to, connection);
    if (user === undefined) return deliveryChannels([], message.trigger);

    const settings = await settingsFor(user.propertyId, user.id, connection);
    return deliveryChannels(settings, message.trigger, user.id);
  };
}
