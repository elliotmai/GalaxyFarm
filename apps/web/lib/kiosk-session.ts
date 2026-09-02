import { cookies } from "next/headers";

/**
 * What a barn screen actually holds between sessions (spec §4.4).
 *
 * §4.4 says a screen "pairs via a one-time code and holds a long-lived device
 * token". It did not: `pair-form.tsx` traded the token for an Auth.js session
 * and dropped it, so the only credential on the device was the session cookie
 * — and Auth.js's default is thirty days, the same as a person's login. The
 * moment that cookie lapsed or was cleared for any reason at all, the screen
 * had nothing left to prove who it was with, and `middleware.ts` sent it to
 * `/login`, which is a form a wall-mounted tablet cannot fill in. Somebody had
 * to walk out to the barn with a fresh pairing code.
 *
 * So the token is kept, and the screen signs itself back in with it. That
 * makes a lost session a blink rather than an errand, whatever lost it: an
 * evicted cookie, a rolled `AUTH_SECRET`, a browser cleared by a launcher
 * update, a tablet whose clock jumped.
 *
 * **A cookie rather than `localStorage`, and `httpOnly` is the whole reason.**
 * The token is the screen's credential; script cannot read it here, so an XSS
 * on a kiosk board cannot walk off with one, which is not true of anything in
 * `localStorage`. `deviceId` stays in `localStorage` — that is an identifier,
 * not a secret, and `lib/local/store.ts` reads it from the browser.
 *
 * None of this widens what a revoked screen can do. `authenticateDevice`
 * refuses a revoked or deleted row, so resuming with a revoked token fails the
 * same way signing in with one does, and the live checks on every pull and
 * every write (§4.4) are untouched. A held token is a way back to a session
 * the device is *still* entitled to, never a way around losing it.
 */

/** Named for the farm rather than the framework, so it cannot collide with Auth.js's own. */
export const DEVICE_TOKEN_COOKIE = "gf.kiosk-device";

/** Attempts counter for `resumeKioskSession`, see `RESUME_WINDOW_SECONDS`. */
export const RESUME_ATTEMPT_COOKIE = "gf.kiosk-resume";

/**
 * Effectively forever.
 *
 * The row in Postgres is what decides whether this screen may still work, and
 * it is asked on every pull and every write. An expiry on the cookie would add
 * nothing to that and would only reintroduce the trip to the barn on a
 * schedule.
 */
const TEN_YEARS_SECONDS = 10 * 365 * 24 * 60 * 60;

/**
 * How long a run of failed resumes counts as the same run.
 *
 * The failure this bounds is a screen that signs in successfully and then
 * finds itself signed out again on the very next request — a session cookie
 * that is set and not kept. Left alone that is a redirect loop hammering Neon
 * from a tablet nobody is watching. A minute is long enough to catch the loop
 * and short enough that an ordinary resume tomorrow starts from zero.
 */
export const RESUME_WINDOW_SECONDS = 60;

/** How many resumes inside that window before the screen stops trying and asks for a code. */
export const MAX_RESUME_ATTEMPTS = 3;

/**
 * Scoped to `/kiosk`, so the token is not attached to every request the
 * browser makes to the rest of the app. Server actions POST to the route they
 * were rendered on, which keeps `/kiosk/pair` inside the scope.
 */
const COOKIE_PATH = "/kiosk";

function secureCookies(): boolean {
  return process.env.NODE_ENV === "production";
}

export async function rememberDeviceToken(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(DEVICE_TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: COOKIE_PATH,
    maxAge: TEN_YEARS_SECONDS,
  });
}

export async function heldDeviceToken(): Promise<string | undefined> {
  const jar = await cookies();
  const value = jar.get(DEVICE_TOKEN_COOKIE)?.value;
  return value === undefined || value === "" ? undefined : value;
}

/**
 * Drop the token.
 *
 * Called when the device is positively known to be gone — unpaired from the
 * screen itself, or refused by `authenticateDevice`. Deliberately *not* called
 * when a resume merely fails to reach the database: a Neon outage is not a
 * revocation, and throwing the token away over one would turn a five-minute
 * blip into the barn trip this whole file exists to prevent.
 */
export async function forgetDeviceToken(): Promise<void> {
  const jar = await cookies();
  // The device row this token names is untouched — taking a screen out of
  // service is `revokeDevice`, which carries the Elevated confirmation and the
  // PIN §4.5 asks for. This drops a cookie on one screen.
  // crud-guard: allow-unconfirmed — a cookie on one device, not a record
  jar.delete({ name: DEVICE_TOKEN_COOKIE, path: COOKIE_PATH });
}

/**
 * Count this resume, and say whether the screen has been going round in circles.
 *
 * Pure counting, kept here beside the cookie it reads so the policy is in one
 * place. Answers `false` when the attempt should not be made.
 */
export function withinResumeBudget(previous: string | undefined): boolean {
  return attemptsFrom(previous) < MAX_RESUME_ATTEMPTS;
}

export function attemptsFrom(previous: string | undefined): number {
  const parsed = Number.parseInt(previous ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** Read the counter, bump it, and write it back with a fresh minute on the clock. */
export async function countResumeAttempt(): Promise<{ readonly allowed: boolean }> {
  const jar = await cookies();
  const previous = jar.get(RESUME_ATTEMPT_COOKIE)?.value;
  const allowed = withinResumeBudget(previous);

  jar.set(RESUME_ATTEMPT_COOKIE, String(attemptsFrom(previous) + 1), {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: COOKIE_PATH,
    maxAge: RESUME_WINDOW_SECONDS,
  });

  return { allowed };
}

/** Pairing by hand ends the run — the next resume starts from zero. */
export async function clearResumeAttempts(): Promise<void> {
  const jar = await cookies();
  // crud-guard: allow-unconfirmed — a counter that expires in a minute anyway
  jar.delete({ name: RESUME_ATTEMPT_COOKIE, path: COOKIE_PATH });
}
