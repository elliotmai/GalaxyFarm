import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The credential a barn screen keeps between sessions (spec §4.4).
 *
 * §4.4 says a screen "holds a long-lived device token" and until now it did
 * not — it traded the token for an Auth.js session and dropped it, so any
 * lapse at all meant somebody walking out to the barn with a fresh pairing
 * code. These assertions are about the two properties that make holding it
 * safe rather than merely convenient: script cannot read it, and a screen that
 * cannot keep a session gives up instead of looping.
 */

const jar = vi.hoisted(() => ({
  values: new Map<string, string>(),
  sets: [] as Array<{ name: string; value: string; options: Record<string, unknown> }>,
  deletes: [] as Array<{ name: string; path?: string }>,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.values.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string, options: Record<string, unknown>) => {
      jar.values.set(name, value);
      jar.sets.push({ name, value, options });
    },
    delete: (target: { name: string; path?: string }) => {
      jar.values.delete(target.name);
      jar.deletes.push(target);
    },
  }),
}));

const {
  DEVICE_TOKEN_COOKIE,
  MAX_RESUME_ATTEMPTS,
  RESUME_ATTEMPT_COOKIE,
  RESUME_WINDOW_SECONDS,
  attemptsFrom,
  clearResumeAttempts,
  countResumeAttempt,
  forgetDeviceToken,
  heldDeviceToken,
  rememberDeviceToken,
  withinResumeBudget,
} = await import("../lib/kiosk-session.js");

const lastSet = (name: string) => jar.sets.filter((entry) => entry.name === name).at(-1);

beforeEach(() => {
  jar.values.clear();
  jar.sets.length = 0;
  jar.deletes.length = 0;
  vi.unstubAllEnvs();
});

describe("the held device token", () => {
  it("is kept where script cannot reach it", async () => {
    await rememberDeviceToken("a-device-token");

    const written = lastSet(DEVICE_TOKEN_COOKIE);
    // The whole reason this is a cookie and not `localStorage`: an XSS on a
    // kiosk board must not be able to walk off with the screen's credential.
    expect(written?.options["httpOnly"]).toBe(true);
    expect(written?.options["sameSite"]).toBe("lax");
    // Not sent with every request the browser makes to the rest of the app.
    expect(written?.options["path"]).toBe("/kiosk");
  });

  it("outlives any session, because the row in Postgres is what decides", async () => {
    await rememberDeviceToken("a-device-token");

    const maxAge = lastSet(DEVICE_TOKEN_COOKIE)?.options["maxAge"];
    // A year is the floor worth asserting; an expiry short enough to matter
    // would put the walk to the barn back on a schedule.
    expect(maxAge).toBeGreaterThan(365 * 24 * 60 * 60);
  });

  it("is marked secure only where the site is served over https", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await rememberDeviceToken("a-device-token");
    expect(lastSet(DEVICE_TOKEN_COOKIE)?.options["secure"]).toBe(true);

    // A laptop running `next dev` over http would never receive the cookie at
    // all if this were pinned on.
    vi.stubEnv("NODE_ENV", "development");
    await rememberDeviceToken("a-device-token");
    expect(lastSet(DEVICE_TOKEN_COOKIE)?.options["secure"]).toBe(false);
  });

  it("reads back what was stored, and nothing for a screen that has none", async () => {
    expect(await heldDeviceToken()).toBeUndefined();

    await rememberDeviceToken("a-device-token");
    expect(await heldDeviceToken()).toBe("a-device-token");
  });

  it("treats an empty cookie as no token rather than as a token", async () => {
    // A cleared-but-present cookie would otherwise send the screen into a
    // resume it cannot possibly complete.
    jar.values.set(DEVICE_TOKEN_COOKIE, "");
    expect(await heldDeviceToken()).toBeUndefined();
  });

  it("is dropped on the same path it was set on", async () => {
    await rememberDeviceToken("a-device-token");
    await forgetDeviceToken();

    // A delete on the wrong path silently leaves the cookie in place, which
    // would leave an unpaired screen trying to resume with a revoked token.
    expect(jar.deletes).toContainEqual({ name: DEVICE_TOKEN_COOKIE, path: "/kiosk" });
    expect(await heldDeviceToken()).toBeUndefined();
  });
});

describe("the resume budget", () => {
  it("allows a run of attempts and then stops", async () => {
    for (let attempt = 0; attempt < MAX_RESUME_ATTEMPTS; attempt += 1) {
      expect((await countResumeAttempt()).allowed, `attempt ${attempt + 1}`).toBe(true);
    }

    // The failure this bounds is a session that is set and not kept: without
    // it the screen redirects in a loop, hammering Neon from a tablet nobody
    // is watching.
    expect((await countResumeAttempt()).allowed).toBe(false);
  });

  it("counts within a window short enough that tomorrow starts from zero", async () => {
    await countResumeAttempt();

    expect(lastSet(RESUME_ATTEMPT_COOKIE)?.options["maxAge"]).toBe(RESUME_WINDOW_SECONDS);
    expect(RESUME_WINDOW_SECONDS).toBeLessThanOrEqual(300);
  });

  it("is reset by a code typed at the screen", async () => {
    for (let attempt = 0; attempt <= MAX_RESUME_ATTEMPTS; attempt += 1) {
      await countResumeAttempt();
    }
    expect((await countResumeAttempt()).allowed).toBe(false);

    await clearResumeAttempts();

    // Whatever loop the last few resumes were in, pairing by hand ends it.
    expect((await countResumeAttempt()).allowed).toBe(true);
  });

  it("reads a missing or nonsensical counter as no attempts yet", () => {
    // The cookie is device-supplied, so it can be anything at all.
    expect(attemptsFrom(undefined)).toBe(0);
    expect(attemptsFrom("")).toBe(0);
    expect(attemptsFrom("not a number")).toBe(0);
    expect(attemptsFrom("-4")).toBe(0);
    expect(attemptsFrom("2")).toBe(2);

    expect(withinResumeBudget(undefined)).toBe(true);
    expect(withinResumeBudget(String(MAX_RESUME_ATTEMPTS))).toBe(false);
  });
});
