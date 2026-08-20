import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { listFiles } from "../../tools/workspace.js";

/**
 * A day typed into a date field is the day that gets stored (spec §4.2).
 *
 * `<input type="date">` hands over `2026-02-14`, and `new Date("2026-02-14")`
 * reads that as **midnight UTC** — the language says so for a bare date
 * string. Every screen renders with `toLocaleDateString`, which is local. West
 * of Greenwich the two disagree by a day.
 *
 * It shipped on the breeding screen and was reported from the farm: a cow bred
 * on the 14th was logged as bred on the 13th, and because §2 derives
 * everything from that one date, her due date, her calving window and her
 * preg-check reminder were all a day early with her. Every other screen had
 * written `T12:00:00` by hand and was right, which is exactly why nobody
 * noticed the one that had not — twenty-four files doing it correctly and one
 * doing it silently wrong.
 *
 * So it is checked rather than remembered. For every `type="date"` field on a
 * screen, the state it is bound to may not be handed to a bare `new Date`.
 * `fromDateInput` is the one reading, and it is midday local: the same
 * calendar day in every timezone, either side of both daylight-saving changes.
 */

const ROOT = process.cwd();

/** The state a `type="date"` input is bound to, per file. */
function dateFieldStates(source: string): string[] {
  const names = new Set<string>();

  // Both orders, because JSX props are written either way round:
  // `type="date" ... value={bred}` and `value={bred} ... type="date"`.
  //
  // Bounded by `[^<]` rather than `[^>]`: props hold arrow functions, and the
  // `>` in `(event) => …` ends the match halfway through the element it is
  // supposed to be reading.
  for (const [, name] of source.matchAll(/type="date"[^<]{0,600}?value=\{([A-Za-z0-9_.]+)\}/g)) {
    names.add(name as string);
  }
  for (const [, name] of source.matchAll(/value=\{([A-Za-z0-9_.]+)\}[^<]{0,600}?type="date"/g)) {
    names.add(name as string);
  }

  return [...names];
}

describe("a date field is read as the day it says", () => {
  const screens = listFiles("apps/web/app", [".tsx"]);

  it("finds the date fields it is meant to be guarding", () => {
    // A regex that matched nothing would pass every assertion below while
    // checking nothing at all, which is the failure mode of a guard like this.
    const withFields = screens.filter(
      (file) => dateFieldStates(readFileSync(join(ROOT, file), "utf8")).length > 0,
    );
    expect(withFields.length).toBeGreaterThan(8);
  });

  it("never hands a date field's value to a bare new Date", () => {
    const offenders: string[] = [];

    for (const file of screens) {
      const source = readFileSync(join(ROOT, file), "utf8");
      for (const state of dateFieldStates(source)) {
        // `new Date(bred)` — the bug. `new Date(`${bred}T12:00:00`)` and
        // `fromDateInput(bred)` are both fine, and neither matches this.
        const bare = new RegExp(`new Date\\(\\s*${state.replace(".", "\\.")}\\s*\\)`);
        if (bare.test(source)) {
          offenders.push(`${file} reads ${state} with a bare new Date`);
        }
      }
    }

    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
