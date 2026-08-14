/**
 * What a notification actually says (spec §5.1, §6).
 *
 * Separate from the Resend adapter because none of this is about Resend: it
 * renders words, and §6's web push will want the same words. The adapter
 * carries them; this decides them.
 *
 * **The farm name is a parameter, never a literal.** §5.1 is explicit that the
 * farm and business names are global variables injected into every page title,
 * PDF, kiosk board and email template, because both are still undecided —
 * landing on one later has to be a settings edit rather than a search across
 * the codebase, and an email that hardcoded it is exactly the sort of thing
 * that would be missed.
 *
 * **Colours are literals here, and that is not the app's rule being broken.**
 * §8's palette is CSS custom properties resolved by the browser against a
 * theme; an email is rendered by a mail client that has no stylesheet, no
 * variables, and — in Gmail's case — no `<style>` block by the time it is
 * shown. So every rule is inline and every colour is written out, chosen to
 * stay legible on the white and near-white grounds mail clients supply.
 */

export interface EmailContent {
  readonly subject: string;
  /** The plain-text part. Always present — see `NotificationMessage`. */
  readonly body: string;
  readonly html: string;
}

export interface EmailBlocks {
  readonly farmName: string;
  readonly subject: string;
  readonly heading: string;
  readonly paragraphs: readonly string[];
  readonly action?: { readonly label: string; readonly url: string } | undefined;
  /** Small print under the rule. Why they got this, usually. */
  readonly footer?: string | undefined;
}

/**
 * Escape for HTML text and for a double-quoted attribute.
 *
 * Everything interpolated below is farm data — a person's name, a farm's name,
 * a line of a notification — and any of it can contain an ampersand or an
 * angle bracket without anybody meaning anything by it. Unescaped, an
 * apostrophe in "O'Brien" is harmless and a `<` silently eats the rest of the
 * paragraph, which is the failure mode worth preventing here.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Only `http(s)` reaches an `href`.
 *
 * The one link in these emails is built by the app from its own origin, so
 * this guards against a mistake rather than an attacker. It is still worth the
 * three lines: `javascript:` in an `href` is the classic way a template that
 * takes a URL from a caller becomes a way to attack whoever opens the mail.
 */
function safeUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

const INK = "#1f2421";
const MUTED = "#5c6660";
const EDGE = "#dfe3e0";
const ACTION = "#2f6f4f";
const CANVAS = "#f6f7f6";

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/**
 * One notification, in both parts.
 *
 * The plain-text part is built from the same blocks rather than written twice.
 * Two hand-maintained copies of the same message drift, and the one that
 * drifts is always the text part, because it is the one nobody looks at.
 */
export function renderEmail(blocks: EmailBlocks): EmailContent {
  const href = blocks.action === undefined ? undefined : safeUrl(blocks.action.url);

  const textLines = [
    blocks.heading,
    "",
    ...blocks.paragraphs.flatMap((paragraph) => [paragraph, ""]),
    ...(blocks.action !== undefined && href !== undefined
      ? [`${blocks.action.label}: ${href}`, ""]
      : []),
    "—",
    blocks.farmName,
    ...(blocks.footer === undefined ? [] : [blocks.footer]),
  ];

  const paragraphs = blocks.paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${INK};">${escapeHtml(paragraph)}</p>`,
    )
    .join("");

  const button =
    blocks.action === undefined || href === undefined
      ? ""
      : `<p style="margin:0 0 16px;"><a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:${ACTION};color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;">${escapeHtml(blocks.action.label)}</a></p>`;

  const footer =
    blocks.footer === undefined
      ? ""
      : `<p style="margin:12px 0 0;font-size:13px;line-height:1.5;color:${MUTED};">${escapeHtml(blocks.footer)}</p>`;

  // A single centred column with a max width. No table layout: the clients
  // that genuinely needed one are the ones this farm does not use, and a table
  // scaffold is a lot of markup to carry for a message that is a heading and
  // three lines.
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(blocks.subject)}</title></head>
<body style="margin:0;padding:24px 12px;background:${CANVAS};font-family:${FONT};">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid ${EDGE};border-radius:12px;padding:28px;">
<p style="margin:0 0 20px;font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};">${escapeHtml(blocks.farmName)}</p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${INK};">${escapeHtml(blocks.heading)}</h1>
${paragraphs}${button}
<hr style="margin:24px 0 0;border:0;border-top:1px solid ${EDGE};">
${footer}
</div>
</body>
</html>`;

  return { subject: blocks.subject, body: textLines.join("\n").trimEnd(), html };
}

export interface TestEmailInput {
  readonly farmName: string;
  /** Who pressed the button, so the person receiving it knows why. */
  readonly sentBy: string;
  readonly sentAt: Date;
  /** Where the app is being served from, for the link back. */
  readonly origin?: string | undefined;
}

/**
 * The message behind the Test email button on `/admin/settings`.
 *
 * Deliberately says what it is in the subject line. Somebody testing an alert
 * path is going to send several of these while getting a domain verified, and
 * a test that arrives looking like a real calving alert is worse than no test
 * at all.
 */
export function testEmailMessage(input: TestEmailInput): EmailContent {
  const at = input.sentAt.toISOString().replace("T", " ").slice(0, 16);

  return renderEmail({
    farmName: input.farmName,
    subject: `Test email from ${input.farmName}`,
    heading: "Email is working",
    paragraphs: [
      `${input.sentBy} sent this from the ${input.farmName} settings screen to check that email is set up. There is nothing to do with it.`,
      `Sent ${at} UTC.`,
    ],
    ...(input.origin === undefined
      ? {}
      : { action: { label: "Open the farm records", url: input.origin } }),
    footer:
      "If you were not expecting this, somebody with an owner account on the farm records pressed Test email against your address.",
  });
}
