import { listFiles, readText } from "./workspace.js";

/**
 * The spec, parsed.
 *
 * `routes.ts` already reads §7 so the router and the spec cannot drift apart.
 * This file does the same job for the parts of the spec that are *lists of
 * things to build*: the §5 domain model, the §6 notification triggers, the
 * §5.7 rule engine, and the §4.4 kiosk boards.
 *
 * The reason it exists: prose is easy to skim and easy to under-deliver
 * against. §11.1 makes exactly this argument about §4.1 and §4.5 — "rules which
 * are merely written down decay under deadline pressure". A spec section that
 * names sixty-nine things is no different. Parsed and checked against a
 * manifest, forgetting one fails the build; unparsed, forgetting one is
 * invisible until somebody goes looking.
 */

export const SPEC_PATH = "docs/galaxy-farm-spec.md";

export interface SpecItem {
  /** Subsection it was found under, e.g. `5.1`. */
  readonly section: string;
  /** The bold lead-in, with version annotations stripped. */
  readonly label: string;
  /** The label exactly as the spec writes it, annotations and all. */
  readonly raw: string;
}

/**
 * Cut a `## N.` … next-top-level-heading slice out of the document.
 *
 * Sliced by index rather than one lazy regex: JavaScript has no `\z`, so the
 * obvious "up to the next heading or end of input" pattern silently treats the
 * escape as a literal `z` and stops at the first one in the prose.
 */
function topLevelSection(markdown: string, number: number): string {
  const start = new RegExp(`^## ${number}\\. `, "m").exec(markdown);
  if (start === null) throw new Error(`Could not locate section ${number} in the spec`);

  const rest = markdown.slice(start.index + start[0].length);
  const end = /^## \d+\. /m.exec(rest);
  return end === null
    ? markdown.slice(start.index)
    : markdown.slice(start.index, start.index + start[0].length + end.index);
}

/**
 * Strip the bookkeeping the spec attaches to a name so the manifest can key on
 * the name itself: `WaterSource (added v1.3)` → `WaterSource`, and a trailing
 * full stop on a sentence-shaped lead-in like `Planned → actual.`.
 */
export function normaliseLabel(raw: string): string {
  return raw
    .replace(/\s*\((?:added|generic aggregate)[^)]*\)/gi, "")
    .replace(/\s*\(base\)\s*$/i, "")
    .replace(/\.$/, "")
    .trim();
}

/**
 * Every bold lead-in in §5, in order, tagged with its subsection.
 *
 * A lead-in is a line that *starts* with `**…**` — how the spec introduces each
 * entity. Bold used mid-sentence for emphasis ("**need, ASAP**") is not a
 * declaration and is deliberately not collected; sub-entities named mid-
 * paragraph are carried in the manifest's own `declares` lists and in
 * `SECTION_ONLY_COVERAGE`, because only a human can tell `SeedInventory` from
 * `client enrollments only`.
 */
export function parseDomainModelItems(markdown: string = readText(SPEC_PATH)): SpecItem[] {
  const section = topLevelSection(markdown, 5);
  const items: SpecItem[] = [];
  let current = "5";

  for (const line of section.split("\n")) {
    const heading = /^### (\d+\.\d+)/.exec(line);
    if (heading?.[1] !== undefined) {
      current = heading[1];
      continue;
    }

    const lead = /^\*\*(.+?)\*\*/.exec(line.trim());
    if (lead?.[1] === undefined) continue;
    items.push({ section: current, label: normaliseLabel(lead[1]), raw: lead[1] });
  }

  return items;
}

/**
 * The default notification triggers from §6, which the spec writes as one
 * middot-separated run of prose.
 */
export function parseNotificationTriggers(markdown: string = readText(SPEC_PATH)): string[] {
  const section = topLevelSection(markdown, 6);
  const line = /Default triggers:\s*([\s\S]*?)\.\s*Per-trigger opt-out/.exec(section);
  if (line?.[1] === undefined) throw new Error("Could not locate the §6 trigger list");

  return line[1]
    .split("·")
    .map((trigger) => trigger.replace(/\*\*/g, "").trim())
    .filter((trigger) => trigger.length > 0);
}

/** The §5.7 rule engine table: the left column is the rule. */
export function parseRuleEngineRules(markdown: string = readText(SPEC_PATH)): string[] {
  const section = topLevelSection(markdown, 5);
  const table = /\| Rule \| Enforcement \|\n\|[-| ]+\|\n([\s\S]*?)\n\n/.exec(section);
  if (table?.[1] === undefined) throw new Error("Could not locate the §5.7 rule table");

  return table[1]
    .split("\n")
    .filter((row) => row.startsWith("|"))
    .map((row) => (row.split("|")[1] ?? "").replace(/\*\*/g, "").trim())
    .filter((rule) => rule.length > 0);
}

/** The preset boards named in §4.4. */
export function parseKioskBoards(markdown: string = readText(SPEC_PATH)): string[] {
  const section = topLevelSection(markdown, 4);
  const paragraph = /### 4\.4 Kiosk mode\s*\n([\s\S]*?)\n\n/.exec(section);
  if (paragraph?.[1] === undefined) throw new Error("Could not locate §4.4");

  const sentence = /Kiosk home offers preset boards:([\s\S]*?)\. Large touch targets/.exec(
    paragraph[1],
  );
  if (sentence?.[1] === undefined) throw new Error("Could not locate the §4.4 board list");

  return [...sentence[1].matchAll(/\*\*(.+?)\*\*/g)].map((match) => match[1] ?? "");
}

/** The build phases named in §11, e.g. `Phase 1`. */
export function parsePhases(markdown: string = readText(SPEC_PATH)): string[] {
  const section = topLevelSection(markdown, 11);
  return [...section.matchAll(/^\*\*(Phase \d+)\s*—/gm)].map((match) => match[1] ?? "");
}

/**
 * Every symbol the workspace's source packages export.
 *
 * Used to check that a manifest entry claiming something is built is telling
 * the truth. A manifest that can drift from the code is just a second spec.
 */
export function exportedSymbols(): Map<string, string> {
  const found = new Map<string, string>();
  const roots = ["packages", "apps/web/lib"];
  const declaration =
    /^export\s+(?:declare\s+)?(?:async\s+)?(?:const|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;

  for (const root of roots) {
    for (const file of listFiles(root, [".ts", ".tsx"])) {
      if (file.includes("/tests/") || file.endsWith(".d.ts")) continue;
      for (const match of readText(file).matchAll(declaration)) {
        const name = match[1];
        if (name !== undefined && !found.has(name)) found.set(name, file);
      }
    }
  }

  return found;
}
