import { deliveryChannels, type DeliveryChannel } from "../entities/notification.js";
import type { NotificationMessage, NotificationReceipt, Notifier } from "./index.js";

/**
 * One `Notifier` over several channels (spec §6).
 *
 * §6 says "email now (Resend), web push later behind the same `Notifier`
 * port", and this is the "same port" part taken literally. Nothing that sends
 * a notification learns that there are now two ways it can arrive: a caller
 * still holds one `Notifier` and still calls `send` once, and which channels
 * that turns into is configuration — decided in the composition root, where
 * every other adapter choice is already made.
 *
 * The alternative, an `if (pushConfigured)` beside each of §6's twenty-two
 * triggers, is the thing worth naming out loud: it would put the preference
 * model in twenty-two places, and the day SMS is wanted it would put it in
 * twenty-two more.
 *
 * **Routing is a function of the message, not of the channels.** `route`
 * answers "where may this go?" and defaults to everywhere, because a message
 * with no §6 trigger on it is not one anybody has a preference about. The app
 * passes a router that reads the recipient's own settings, which is what makes
 * "switched off" mean switched off on both channels rather than on the one
 * that happened to be checked.
 */

export interface ChannelNotifiers {
  readonly email?: Notifier | undefined;
  readonly push?: Notifier | undefined;
}

/**
 * Which channels one message may use.
 *
 * Async because the honest implementation is a database read — the settings
 * belong to the person being written to, and the message identifies them by
 * address.
 */
export type ChannelRouter = (
  message: NotificationMessage,
) => Promise<readonly DeliveryChannel[]> | readonly DeliveryChannel[];

/** The default router: no settings to consult, so §6's own default applies. */
export const everyChannel: ChannelRouter = (message) => deliveryChannels([], message.trigger);

/**
 * Fan one message out to the channels a router allows.
 *
 * Email first, then push, and the returned receipt is the first channel's that
 * accepted it — `NotificationReceipt` carries one id and email's is the one
 * worth having, because it is the id a provider's log can be searched by when
 * somebody says an alert never arrived.
 *
 * **A channel failing is not the send failing, unless they all do.** A push
 * service being unreachable while the email went is not something to report to
 * a person as a failure — they have the message. So a throw only happens when
 * every channel that was tried threw, and it names each of them, because "push
 * failed" and "both failed" call for different responses and a single wrapped
 * error would say neither.
 *
 * No channel allowed at all is a successful no-op with an empty receipt. That
 * is §6 being honoured rather than an error: somebody said they did not want
 * this, and the caller did nothing wrong by offering it.
 */
export function compositeNotifier(
  channels: ChannelNotifiers,
  route: ChannelRouter = everyChannel,
): Notifier {
  return {
    async send(input: NotificationMessage): Promise<NotificationReceipt> {
      const allowed = await route(input);

      const attempts: Array<{ channel: DeliveryChannel; notifier: Notifier }> = [];
      for (const channel of ["email", "push"] as const) {
        const notifier = channels[channel];
        if (notifier !== undefined && allowed.includes(channel))
          attempts.push({ channel, notifier });
      }

      if (attempts.length === 0) return {};

      let receipt: NotificationReceipt | undefined;
      const failures: string[] = [];

      for (const attempt of attempts) {
        try {
          const sent = await attempt.notifier.send(input);
          receipt ??= sent;
        } catch (error) {
          failures.push(
            `${attempt.channel}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      if (receipt === undefined) {
        throw new Error(`Every notification channel failed — ${failures.join("; ")}`);
      }
      return receipt;
    },
  };
}
