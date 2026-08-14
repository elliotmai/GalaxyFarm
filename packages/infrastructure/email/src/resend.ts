import type { NotificationReceipt, Notifier } from "@galaxy-farm/core";

/**
 * Resend (spec §3, §6).
 *
 * Behind the kernel's `Notifier` port, which is the same port web push will
 * sit behind later — §6 says "email now (Resend), web push later behind the
 * same `Notifier` port", so nothing that sends a notification learns which of
 * the two it got.
 *
 * Written against `fetch` and Resend's HTTP API rather than the `resend` npm
 * package. The whole surface this app needs is one POST, the package would
 * pull a dependency into every deploy for it, and — the reason that actually
 * settles it — a `fetch` this file can be handed is what makes every test
 * below run without a network or a key.
 */

export interface ResendOptions {
  readonly apiKey: string;
  /** Verified sender. A wrong one fails at send time, not at build time. */
  readonly from: string;
  readonly endpoint?: string;
  readonly fetch?: typeof globalThis.fetch;
}

const ENDPOINT = "https://api.resend.com/emails";

/**
 * Resend's own id for the message, when it gives one.
 *
 * Defensive about the body on purpose: a 200 with a body this cannot parse is
 * still a message Resend accepted, and throwing here would turn a delivered
 * email into a reported failure — which is the one wrong answer, because it is
 * the one that has somebody send it again.
 */
async function receiptFrom(response: Response): Promise<NotificationReceipt> {
  try {
    const payload: unknown = await response.json();
    if (typeof payload === "object" && payload !== null && "id" in payload) {
      const id = (payload as { id: unknown }).id;
      if (typeof id === "string" && id !== "") return { id };
    }
  } catch {
    // Unparseable, or a fetch stub with no json(). Accepted either way.
  }
  return {};
}

export function resendNotifier(options: ResendOptions): Notifier {
  const doFetch = options.fetch ?? globalThis.fetch;

  return {
    async send(input) {
      const response = await doFetch(options.endpoint ?? ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: options.from,
          to: [input.to],
          subject: input.subject,
          text: input.body,
          // Omitted rather than sent as null when there is none: Resend reads
          // an absent key as "no HTML part" and a present one as a promise of
          // content, and an empty HTML part renders as an empty email in the
          // clients that prefer it.
          ...(input.html === undefined ? {} : { html: input.html }),
          ...(input.replyTo === undefined ? {} : { reply_to: input.replyTo }),
        }),
      });

      if (!response.ok) {
        // The body carries Resend's own reason, which is worth surfacing: most
        // failures here are an unverified sender domain, and "422" alone sends
        // somebody looking in the wrong place.
        const detail = await response.text().catch(() => "");
        throw new Error(`Resend returned ${response.status} ${response.statusText}: ${detail}`);
      }

      return receiptFrom(response);
    },
  };
}

/**
 * A notifier that records instead of sending.
 *
 * Used in development and in tests. Named for what it does rather than called
 * a mock, because it is genuinely useful to run the app with notifications
 * going nowhere and still be able to see what it tried to send.
 */
export function recordingNotifier(): Notifier & {
  readonly sent: Array<{
    to: string;
    subject: string;
    body: string;
    html?: string | undefined;
    replyTo?: string | undefined;
  }>;
} {
  const sent: Array<{
    to: string;
    subject: string;
    body: string;
    html?: string | undefined;
    replyTo?: string | undefined;
  }> = [];
  return {
    sent,
    async send(input) {
      sent.push({
        to: input.to,
        subject: input.subject,
        body: input.body,
        html: input.html,
        replyTo: input.replyTo,
      });
      // Shaped like a real receipt so a caller that reports the id has
      // something to report in development rather than a special case.
      return { id: `recorded-${sent.length}` };
    },
  };
}

/**
 * Resend's shared sender, usable before any domain is verified.
 *
 * Resend will only deliver from this address to the address the account was
 * opened with, which makes it exactly good enough to prove the wiring works
 * and not good enough to alert anybody. `resolveEmailConfig` says so out loud
 * rather than leaving somebody to discover it from a 403.
 */
export const SHARED_SENDER = "onboarding@resend.dev";

export type EmailConfig =
  | {
      readonly ok: true;
      readonly apiKey: string;
      readonly from: string;
      /**
       * Set when sending is running on Resend's shared address, which only
       * reaches the account holder's own inbox. Shown, not logged: somebody
       * testing an invitation to a housesitter needs to know why it never
       * arrived, and the send itself will look like it succeeded.
       */
      readonly limitation?: string;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Read the sending configuration out of the environment.
 *
 * A pure function of an env object rather than a read of `process.env` at
 * import time, which is what lets the app ask "is email set up?" for a screen
 * without constructing anything, and lets the tests below cover every branch.
 *
 * Missing configuration is a returned reason rather than a throw. Email is not
 * load-bearing for a farm records app — the calving watch still writes to the
 * calendar with no key configured (§6) — so an unset variable has to degrade
 * to a sentence somebody can act on, not take a page down.
 */
export function resolveEmailConfig(env: Readonly<Record<string, string | undefined>>): EmailConfig {
  const apiKey = env["RESEND_API_KEY"]?.trim() ?? "";
  if (apiKey === "") {
    return {
      ok: false,
      reason:
        "RESEND_API_KEY is not set, so nothing can be sent. Add it to .env.local for a laptop, or to the Netlify environment variables for the deployed site.",
    };
  }

  const from = env["EMAIL_FROM"]?.trim() ?? "";
  if (from === "") {
    return {
      ok: true,
      apiKey,
      from: SHARED_SENDER,
      limitation: `EMAIL_FROM is not set, so this is going out from ${SHARED_SENDER} — Resend's shared sender. It only delivers to the address the Resend account was opened with. Verify a domain at resend.com/domains and set EMAIL_FROM to send to anybody else.`,
    };
  }

  return senderAddress(from) === SHARED_SENDER
    ? {
        ok: true,
        apiKey,
        from,
        limitation: `EMAIL_FROM uses ${SHARED_SENDER}, Resend's shared sender, which only delivers to the address the Resend account was opened with. Verify a domain at resend.com/domains to send to anybody else.`,
      }
    : { ok: true, apiKey, from };
}

/**
 * The address out of `Name <address>`, or the whole string if it is bare.
 *
 * Both spellings are valid in `EMAIL_FROM` and the display-name form is the
 * one worth encouraging, so the shared-sender check has to see through it —
 * otherwise `Galaxy Farm <onboarding@resend.dev>` silently loses the warning
 * that the bare form gets.
 */
export function senderAddress(from: string): string {
  const angled = /<([^>]+)>/.exec(from);
  return (angled?.[1] ?? from).trim().toLowerCase();
}
