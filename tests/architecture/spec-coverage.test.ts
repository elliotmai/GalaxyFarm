import { describe, expect, it } from "vitest";

import {
  KIOSK_BOARD_COVERAGE,
  NOTIFICATION_COVERAGE,
  RULE_COVERAGE,
  SECTION_ONLY_COVERAGE,
  SPEC_COVERAGE,
  type SpecCoverageEntry,
} from "../../tools/spec-manifest.js";
import {
  exportedSymbols,
  parseDomainModelItems,
  parseKioskBoards,
  parseNotificationTriggers,
  parsePhases,
  parseRuleEngineRules,
} from "../../tools/spec-model.js";
import { appPageRoutes } from "../../tools/routes.js";

/**
 * §5 conformance — the domain model equivalent of the §7 route-map check.
 *
 * The route map has been machine-checked since the first commit: a route that
 * exists but is not in the spec fails, and so does the reverse. §5 had no such
 * check, and §5 is where nearly all the spec's substance lives. The result was
 * predictable — the parts with screens got built and the parts named only in a
 * paragraph did not, with nothing to say so.
 *
 * These tests close that. They do not assert the app is finished; `planned` is
 * a legitimate state and most of §5 is in it. They assert that the *list* is
 * complete and that nothing claims to be done when it is not.
 */

const items = parseDomainModelItems();
const symbols = exportedSymbols();
const phases = new Set(parsePhases());

const allEntries: ReadonlyArray<readonly [string, SpecCoverageEntry]> = [
  ...Object.entries(SPEC_COVERAGE),
  ...Object.entries(SECTION_ONLY_COVERAGE),
];

describe("spec §5 — every declaration in the domain model is accounted for", () => {
  it("parses a realistic number of declarations", () => {
    // Guards the parser itself. A regex that quietly matches nothing would make
    // every test below pass for the worst possible reason.
    expect(items.length).toBeGreaterThan(60);
  });

  it.each(items.map((item) => [item.label, item.section] as const))(
    "%s (§%s) appears in the manifest",
    (label) => {
      expect(
        SPEC_COVERAGE[label],
        `Spec §5 declares "${label}" and tools/spec-manifest.ts does not mention it. ` +
          `Classify it — entity, derivation, or concept — and mark it built or planned.`,
      ).toBeDefined();
    },
  );

  it("has no manifest entry the spec has stopped asking for", () => {
    // Without this the manifest slowly becomes a second, wrong spec.
    const declared = new Set(items.map((item) => item.label));
    const stale = Object.keys(SPEC_COVERAGE).filter((label) => !declared.has(label));

    expect(stale).toEqual([]);
  });

  it("files every entry under the subsection the spec puts it in", () => {
    const wrong = items
      .filter((item) => SPEC_COVERAGE[item.label]?.section !== item.section)
      .map(
        (item) =>
          `${item.label}: manifest says §${SPEC_COVERAGE[item.label]?.section}, spec says §${item.section}`,
      );

    expect(wrong).toEqual([]);
  });

  it("covers every subsection of §5, including the ones with no bold lead-ins", () => {
    // §5.9 writes its entities mid-sentence, so the parser cannot see them and
    // an unwary manifest would leave horses entirely uncovered.
    const covered = new Set(allEntries.map(([, entry]) => entry.section));
    const expected = [
      "5.1",
      "5.2",
      "5.3",
      "5.4",
      "5.5",
      "5.6",
      "5.7",
      "5.8",
      "5.9",
      "5.10",
      "5.11",
    ];

    expect(expected.filter((section) => !covered.has(section))).toEqual([]);
  });
});

describe("nothing is marked built unless it is", () => {
  it("resolves every symbol a built entry claims", () => {
    const missing = allEntries
      .filter(([, entry]) => entry.status === "built")
      .flatMap(([label, entry]) =>
        entry.declares
          .filter((symbol) => !symbols.has(symbol))
          .map(
            (symbol) =>
              `${label} is marked built but nothing exports "${symbol}". ` +
              `Either write it or set status: "planned".`,
          ),
      );

    expect(missing).toEqual([]);
  });

  it("gives a planned entry a to-do list, or an explanation for having none", () => {
    const empty = allEntries
      .filter(([, entry]) => entry.status === "planned")
      .filter(([, entry]) => entry.declares.length === 0 && entry.note === undefined)
      .map(([label]) => `${label} is planned but says nothing about what it will build`);

    expect(empty).toEqual([]);
  });

  it("marks every concept not-applicable rather than planned", () => {
    // A concept produces no artifact — `Pet` is an Animal with a species — so
    // leaving them "planned" would give the backlog a floor it can never
    // reach, and a backlog that cannot reach zero is one nobody reads.
    const wrong = allEntries
      .filter(([, entry]) => entry.kind === "concept")
      .filter(
        ([, entry]) =>
          entry.declares.length > 0 ||
          entry.note === undefined ||
          entry.status !== "not-applicable",
      )
      .map(
        ([label]) =>
          `${label} is a concept: it must declare nothing, carry a note saying why, and be not-applicable`,
      );

    expect(wrong).toEqual([]);
  });

  it("reserves not-applicable for concepts", () => {
    // Otherwise it becomes the escape hatch for anything inconvenient.
    const misused = allEntries
      .filter(([, entry]) => entry.status === "not-applicable" && entry.kind !== "concept")
      .map(([label]) => label);

    expect(misused).toEqual([]);
  });

  it("assigns every entry to a build phase §11 actually has", () => {
    const unknown = allEntries
      .filter(([, entry]) => !phases.has(entry.phase))
      .map(([label, entry]) => `${label} → ${entry.phase}`);

    expect(unknown).toEqual([]);
  });
});

describe("spec §6 — every default notification trigger has something behind it", () => {
  const triggers = parseNotificationTriggers();

  it("reads the whole trigger list", () => {
    expect(triggers.length).toBeGreaterThan(15);
  });

  it.each(triggers)("%s is in the manifest", (trigger) => {
    expect(
      NOTIFICATION_COVERAGE[trigger],
      `Spec §6 lists "${trigger}" as a default notification trigger and the manifest ` +
        `does not name the derivation that decides when it fires.`,
    ).toBeDefined();
  });

  it("has no trigger the spec has dropped", () => {
    const listed = new Set(triggers);
    expect(Object.keys(NOTIFICATION_COVERAGE).filter((t) => !listed.has(t))).toEqual([]);
  });

  it("resolves the derivation behind every trigger marked built", () => {
    const missing = Object.entries(NOTIFICATION_COVERAGE)
      .filter(([, entry]) => entry.status === "built")
      .filter(([, entry]) => !symbols.has(entry.derivedFrom))
      .map(([trigger, entry]) => `${trigger} → ${entry.derivedFrom} does not exist`);

    expect(missing).toEqual([]);
  });
});

describe("spec §5.7 — the rule engine table is covered rule by rule", () => {
  const rules = parseRuleEngineRules();

  it("reads all nine rules", () => {
    expect(rules).toHaveLength(9);
  });

  it.each(rules)("%s has a policy id", (rule) => {
    expect(RULE_COVERAGE[rule], `Spec §5.7 rule "${rule}" is not in the manifest`).toBeDefined();
  });

  it("gives every rule a distinct id", () => {
    const ids = Object.values(RULE_COVERAGE).map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("spec §4.4 — every kiosk board has a route", () => {
  const boards = parseKioskBoards();
  const routes = new Set(appPageRoutes());

  it("reads all six boards", () => {
    expect(boards).toHaveLength(6);
  });

  it.each(boards)("%s is routed and the route exists", (board) => {
    const route = KIOSK_BOARD_COVERAGE[board];
    expect(
      route,
      `§4.4 names the "${board}" board and the manifest gives it no route`,
    ).toBeDefined();
    expect(routes.has(route as string), `${route} does not exist in the app`).toBe(true);
  });
});
