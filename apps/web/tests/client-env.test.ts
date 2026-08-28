import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * How the two client-reachable modules read the environment.
 *
 * This is a test about source text, which is unusual enough to say why. The
 * bug it guards shipped once and cost a day: `mapsApiKey` and
 * `offlineImageryBase` both took `env = process.env` as a default and then
 * indexed that parameter. On a server that is correct and every unit test
 * passes, because a test hands the function its own object and Node has a real
 * `process.env` behind the default. In a browser neither is true. Next has no
 * environment to read there — it replaces the literal text
 * `process.env.NEXT_PUBLIC_…` with the value as it bundles, a find-and-replace
 * over the source. Pass `process.env` to a parameter and there is no such text
 * anywhere, nothing is replaced, and every read is `undefined` on the client
 * however carefully the deploy was configured.
 *
 * So the failure is invisible to a behavioural test by construction: the thing
 * that breaks is what the bundler can see in the source, and the only honest
 * way to check it without building the app is to look at the source. The
 * assertions are deliberately about spelling, because spelling is the bug.
 *
 * Server-only modules — `storage`, `notifier`, `registry`, `credential-store` —
 * are not listed here and should not be. They are never bundled for a browser,
 * they read the real environment at runtime, and `= process.env` is right for
 * them.
 */

const CLIENT_ENV_READERS = [
  { file: "google-maps.ts", variable: "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY" },
  { file: "offline-imagery.ts", variable: "NEXT_PUBLIC_OFFLINE_IMAGERY_BASE_URL" },
];

const sourceOf = (file: string): string => readFileSync(join(__dirname, "..", "lib", file), "utf8");

describe.each(CLIENT_ENV_READERS)("$file", ({ file, variable }) => {
  it(`spells out process.env.${variable} so the bundler can substitute it`, () => {
    // The exact member expression, not a bracket index through a variable.
    // This string is what Next searches for; if it is not here, the value
    // cannot reach a browser.
    expect(sourceOf(file)).toContain(`process.env.${variable}`);
  });

  it("never takes process.env as a parameter default", () => {
    // The shape of the original bug. Reintroducing it would leave every
    // assertion in the suite passing and the screen reporting an unset
    // variable to somebody looking at it in the dashboard.
    const offending = sourceOf(file)
      .split("\n")
      .filter(
        (line) => /=\s*process\.env\s*,?\s*$/.test(line) && !line.trimStart().startsWith("*"),
      );

    expect(offending).toEqual([]);
  });
});
