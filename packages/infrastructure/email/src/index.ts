import type { Notifier } from "@galaxy-farm/core";

/**
 * Resend (spec §3, §6).
 *
 * Behind the kernel's `Notifier` port, which is the same port web push will
 * sit behind later — §6 says "email now (Resend), web push later behind the
 * same `Notifier` port", so nothing that sends a notification learns which of
 * the two it got.
 */

export interface ResendOptions {
  readonly apiKey: string;
  /** Verified sender. A wrong one fails at send time, not at build time. */
  readonly from: string;
  readonly endpoint?: string;
  readonly fetch?: typeof globalThis.fetch;
}

const ENDPOINT = "https://api.resend.com/emails";

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
        }),
      });

      if (!response.ok) {
        // The body carries Resend's own reason, which is worth surfacing: most
        // failures here are an unverified sender domain, and "422" alone sends
        // somebody looking in the wrong place.
        const detail = await response.text().catch(() => "");
        throw new Error(`Resend returned ${response.status} ${response.statusText}: ${detail}`);
      }
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
  readonly sent: Array<{ to: string; subject: string; body: string }>;
} {
  const sent: Array<{ to: string; subject: string; body: string }> = [];
  return {
    sent,
    async send(input) {
      sent.push({ to: input.to, subject: input.subject, body: input.body });
    },
  };
}
