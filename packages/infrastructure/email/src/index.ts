/**
 * Email, behind the kernel's `Notifier` port (spec §3, §6).
 *
 * §6: "email now (Resend), web push later behind the same `Notifier` port".
 * The adapter is in `resend.ts` and the message bodies are in `template.ts`,
 * split because the second one is the half that has nothing to do with Resend
 * — it renders words, and it will render the same words for web push.
 */

export * from "./resend.js";
export * from "./template.js";
