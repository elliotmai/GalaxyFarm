import type { Notifier } from "@galaxy-farm/core";
import { resendNotifier, resolveEmailConfig, type EmailConfig } from "@galaxy-farm/infra-email";

/**
 * Where email is composed (spec §4.1, §6).
 *
 * §4.1 puts the composition root in the app, and this is email's corner of it:
 * the only file in the repository that reads `RESEND_API_KEY`, and the only
 * one that names the adapter. Everything else asks for a `Notifier` and gets
 * one, which is what makes web push later a change to this file (§6).
 *
 * Server-side only, like `credential-store.ts` beside it. `RESEND_API_KEY` has
 * no `NEXT_PUBLIC_` prefix, so it is not in a client bundle to leak — what a
 * browser import would produce is an email path that silently reads `undefined`
 * and reports itself as unconfigured. Everything here is reached from a server
 * action or a route handler.
 */

/**
 * How email is configured, without constructing anything.
 *
 * Separate from `notifier()` because a screen wants to say "email is not set
 * up, here is what to set" without a notifier it has no intention of using,
 * and because the shared-sender limitation has to reach a person rather than a
 * log — the send succeeds, and the mail only arrives if the recipient happens
 * to be the Resend account holder.
 */
export function emailConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): EmailConfig {
  return resolveEmailConfig(env);
}

/**
 * The notifier, or nothing when email is not configured.
 *
 * Nothing rather than a throw, and nothing rather than a recording notifier
 * that quietly swallows the send. §6's own acceptance criteria treat an
 * unreachable third party as something to report and skip — the calving watch
 * still writes to the calendar with no key set — so a caller has to be able to
 * see that there was nowhere to send, and say so.
 */
export function notifier(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Notifier | undefined {
  const config = emailConfig(env);
  return config.ok ? resendNotifier({ apiKey: config.apiKey, from: config.from }) : undefined;
}
