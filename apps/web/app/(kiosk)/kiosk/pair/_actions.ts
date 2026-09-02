"use server";

import { signIn } from "@/lib/auth";
import { withDeadline } from "@/lib/deadline";
import { authenticateDevice, redeemPairing } from "@/lib/device-store";
import {
  clearResumeAttempts,
  countResumeAttempt,
  forgetDeviceToken,
  heldDeviceToken,
  rememberDeviceToken,
} from "@/lib/kiosk-session";

/**
 * Redeeming a pairing code, and getting back a session that lapsed (spec §4.4).
 *
 * `redeemPairingCode` is the one server action on this surface reachable by
 * somebody with no session at all — pairing is how a barn screen *gets* one.
 * Deliberately unauthenticated rather than gated: `middleware.ts` carries the
 * same exception for `/kiosk/pair` itself, for the same reason. Nothing in the
 * code is sensitive on its own — it is single-use and expires in minutes — but
 * the token it mints is: it is the credential the screen holds from now on.
 *
 * That token is now *kept*, in an `httpOnly` cookie the browser cannot read
 * (`lib/kiosk-session.ts` says why), which is what `resumeKioskSession` below
 * spends. Before, the screen traded the token for a session and dropped it, so
 * a lapsed session meant a walk to the barn with a fresh code — §4.4 promises
 * a screen "holds a long-lived device token", and this is the half of that
 * promise the implementation was missing.
 */

export type RedeemResult =
  | { readonly ok: true; readonly token: string; readonly deviceId: string; readonly name: string }
  | { readonly ok: false; readonly error: string };

export async function redeemPairingCode(code: string): Promise<RedeemResult> {
  if (code.trim() === "") {
    return { ok: false, error: "Enter the code shown in Settings." };
  }

  const result = await redeemPairing(code, new Date());
  if (result === undefined) {
    return { ok: false, error: "That code is wrong or has expired. Ask for a new one." };
  }

  // Held from here on, so this is the last time anybody has to type a code at
  // this screen. Written before the browser trades the token for a session:
  // if that call is the thing that fails, the screen can still resume itself
  // rather than needing a second code for a device that is already paired.
  await rememberDeviceToken(result.token);
  // A code typed by hand is a fresh start — whatever loop the last few
  // resumes were in, it is over.
  // crud-guard: allow-unconfirmed — resets a one-minute cookie, not a record
  await clearResumeAttempts();

  return {
    ok: true,
    token: result.token,
    deviceId: result.device.id,
    name: result.device.name,
  };
}

/**
 * Why a resume did not happen. Each one is a different thing to tell the
 * person who eventually walks up to the screen.
 */
export type ResumeFailure =
  /** No token held, or the device row is revoked or gone. A code is the only way back. */
  | "unpaired"
  /** The database did not answer. The token is still good; try again shortly. */
  | "unreachable"
  /** Signing in keeps working and keeps not sticking. Something is eating the cookie. */
  | "looping";

export type ResumeResult =
  { readonly ok: true } | { readonly ok: false; readonly why: ResumeFailure };

/**
 * Sign this screen back in with the token it already holds.
 *
 * The device row is checked before `signIn` rather than letting the provider's
 * `null` speak for everything, because "this screen was revoked" and "Neon did
 * not answer" need opposite responses: the first should throw the token away
 * and ask for a code, and the second must not, or a five-minute outage costs
 * somebody a trip to the barn. It is two round trips on a path that should run
 * approximately never, which is the right side of that trade.
 */
export async function resumeKioskSession(): Promise<ResumeResult> {
  const token = await heldDeviceToken();
  if (token === undefined) return { ok: false, why: "unpaired" };

  // Counted before the work, so a screen stuck in a redirect loop stops
  // hammering the database rather than accelerating into it.
  const { allowed } = await countResumeAttempt();
  if (!allowed) return { ok: false, why: "looping" };

  let device;
  try {
    device = await withDeadline(authenticateDevice(token, new Date()), "the kiosk device");
  } catch (error: unknown) {
    console.error("[kiosk:resume] device lookup failed", error);
    return { ok: false, why: "unreachable" };
  }

  if (device === undefined) {
    // Positively refused, not merely unanswered: this token names no live
    // device, so holding on to it would only fail again every time.
    await forgetDeviceToken();
    return { ok: false, why: "unpaired" };
  }

  let outcome: unknown;
  try {
    outcome = await signIn("kiosk-device", { token, redirect: false });
  } catch (error: unknown) {
    console.error("[kiosk:resume] sign-in threw for a live device", error);
    return { ok: false, why: "unreachable" };
  }

  // A Credentials provider that refuses does not throw: `signIn` hands back
  // the URL it would have sent a browser to, with `error` on it. Taking the
  // absence of an exception as success would report a session that was never
  // set, and the screen would bounce straight back here — three times, and
  // then be told to pair, over what may have been a revoke landing mid-resume.
  if (typeof outcome === "string" && errorInUrl(outcome)) {
    console.error("[kiosk:resume] sign-in refused a token that had just authenticated");
    // Retryable rather than "unpaired": the token is not thrown away on an
    // inference. If the device really is revoked, the `authenticateDevice`
    // above says so on the next attempt and that is where it gets dropped.
    return { ok: false, why: "unreachable" };
  }

  return { ok: true };
}

/** Auth.js reports a refusal as a query parameter on the URL it returns. */
function errorInUrl(url: string): boolean {
  try {
    // A base, because what comes back may be a path rather than absolute.
    return new URL(url, "http://kiosk.invalid").searchParams.has("error");
  } catch {
    return false;
  }
}
