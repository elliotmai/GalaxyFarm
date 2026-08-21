import { compositeNotifier, type Notifier } from "@galaxy-farm/core";
import { resendNotifier, resolveEmailConfig, type EmailConfig } from "@galaxy-farm/infra-email";
import { resolvePushConfig, webPushNotifier, type PushConfig } from "@galaxy-farm/infra-push";
import type { Database } from "@galaxy-farm/infra-db";

import { preferenceRouter } from "@/lib/notification-prefs";
import { forgetEndpoint, subscriptionsForEmail } from "@/lib/push-store";

/**
 * Where notifications are composed (spec §4.1, §6).
 *
 * §4.1 puts the composition root in the app, and this is its notification
 * corner: the only file in the repository that reads `RESEND_API_KEY` or
 * `VAPID_PRIVATE_KEY`, and the only one that names either adapter. Everything
 * else asks for a `Notifier` and gets one — which is exactly what §6 promised
 * when it said "email now (Resend), web push later behind the same `Notifier`
 * port", and the whole of what that later turned out to cost.
 *
 * Server-side only, like `credential-store.ts` beside it. Neither secret has a
 * `NEXT_PUBLIC_` prefix, so neither is in a client bundle to leak; what a
 * browser import would produce is a channel that silently reads `undefined`
 * and reports itself as unconfigured. `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is the
 * exception and is meant to be public — it is handed to the browser at
 * subscribe time, and it identifies this application server rather than
 * authorising anything.
 *
 * **Two notifiers, and the difference matters.** `emailNotifier` is email and
 * says so; an invitation link and the Test email button are email features,
 * and pushing them to a phone that may not exist yet would be nonsense.
 * `alertNotifier` is the one §6's triggers use, and it fans out to whatever
 * channels are configured and the recipient has not turned off.
 */

/**
 * How email is configured, without constructing anything.
 *
 * Separate from the notifiers because a screen wants to say "email is not set
 * up, here is what to set" without one it has no intention of using, and
 * because the shared-sender limitation has to reach a person rather than a
 * log — the send succeeds, and the mail only arrives if the recipient happens
 * to be the Resend account holder.
 */
export function emailConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): EmailConfig {
  return resolveEmailConfig(env);
}

/** The same, for push. The settings screen renders the reason when it is not ok. */
export function pushConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): PushConfig {
  return resolvePushConfig(env);
}

/**
 * The email notifier, or nothing when email is not configured.
 *
 * Nothing rather than a throw, and nothing rather than a recording notifier
 * that quietly swallows the send. §6's own acceptance criteria treat an
 * unreachable third party as something to report and skip — the calving watch
 * still writes to the calendar with no key set — so a caller has to be able to
 * see that there was nowhere to send, and say so.
 */
export function emailNotifier(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Notifier | undefined {
  const config = emailConfig(env);
  return config.ok ? resendNotifier({ apiKey: config.apiKey, from: config.from }) : undefined;
}

/**
 * The push notifier, or nothing when no VAPID pair is configured.
 *
 * The two functions injected here are the whole of what the adapter does not
 * know: which subscriptions belong to an address, and what to do with one a
 * push service says is gone. Pruning is wired straight to the store rather
 * than reported, because there is nothing for a person to decide — a browser
 * that answers 410 has revoked permission, and the row will never work again.
 */
export function pushNotifier(
  env: Readonly<Record<string, string | undefined>> = process.env,
  db?: Database,
): Notifier | undefined {
  const config = pushConfig(env);
  if (!config.ok) return undefined;

  return webPushNotifier({
    config,
    subscriptions: (to) => subscriptionsForEmail(to, db),
    onGone: (subscription) => forgetEndpoint(subscription.endpoint, db),
    // Where a tap lands. The dashboard rather than the record the alert came
    // from, until a notification carries its source: §6's triggers span nine
    // modules, and a wrong deep link is worse than a right shallow one.
    defaultUrl: "/admin",
  });
}

/**
 * The notifier §6's triggers send through, or nothing when no channel exists.
 *
 * Composed rather than chosen: with both configured a message goes to both, and
 * with one configured it goes to that one, and no caller learns which. The
 * router is what keeps that honest — every message is checked against the
 * recipient's own preferences first, so a trigger somebody switched off does
 * not arrive by the channel they were not thinking about when they switched it
 * off.
 */
export function alertNotifier(
  env: Readonly<Record<string, string | undefined>> = process.env,
  db?: Database,
): Notifier | undefined {
  const email = emailNotifier(env);
  const push = pushNotifier(env, db);
  if (email === undefined && push === undefined) return undefined;

  return compositeNotifier(
    { ...(email === undefined ? {} : { email }), ...(push === undefined ? {} : { push }) },
    preferenceRouter(db),
  );
}

/**
 * Why nothing can be sent, when nothing can be.
 *
 * One sentence naming both channels, because "email is not configured" on a
 * screen where push is also unset sends somebody to fix half the problem.
 */
export function noChannelReason(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const email = emailConfig(env);
  const push = pushConfig(env);
  if (email.ok || push.ok) return undefined;

  return `${email.reason} ${push.reason}`;
}
