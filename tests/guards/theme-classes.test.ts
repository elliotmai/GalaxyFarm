import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every colour a component names has to be one the theme declares (spec §8).
 *
 * The bug this exists for shipped and was reported: `bg-surface` and
 * `bg-raised` are not colours this theme has. Tailwind does not error on an
 * unknown utility — it emits nothing — so the class silently did nothing and
 * the elements rendered **transparent**. The dropdown list was see-through
 * with the page text showing through it, and so were the stat tiles.
 *
 * That is the worst shape a styling mistake can take: it does not fail, it
 * does not warn, and it looks like a design decision. Nothing in typecheck,
 * lint or the test suite could have caught it, because at no point is the name
 * of a colour checked against anything.
 *
 * So it is checked here. The palette is read from the app's `@theme inline`
 * block — the one place the CSS variables become Tailwind colour names — and
 * any colour-shaped utility naming something else fails the build.
 */

const ROOT = process.cwd();

/** The colour names Tailwind knows about, straight from `@theme inline`. */
function declaredColours(): Set<string> {
  const css = readFileSync(join(ROOT, "apps/web/app/globals.css"), "utf8");
  const names = new Set<string>();
  for (const [, name] of css.matchAll(/--color-([a-z0-9-]+)\s*:/g)) names.add(name as string);
  return names;
}

/**
 * Utilities that share a prefix with a colour but are not one.
 *
 * Listed rather than pattern-matched: `text-sm` is a size and `text-danger` is
 * a colour, and only a list knows which is which. A new one added here is a
 * deliberate act, which is the point — the alternative is a clever pattern
 * that also lets `bg-surface` through.
 */
const NOT_COLOURS = new Set([
  "text-xs",
  "text-sm",
  "text-base",
  "text-lg",
  "text-xl",
  "text-2xl",
  "text-3xl",
  "text-4xl",
  "text-5xl",
  "text-6xl",
  "text-left",
  "text-right",
  "text-center",
  "text-justify",
  "text-balance",
  "text-pretty",
  "text-wrap",
  "text-nowrap",
  "text-density",
  "text-ellipsis",
  "border-0",
  "border-2",
  "border-4",
  "border-t",
  "border-b",
  "border-l",
  "border-r",
  "border-x",
  "border-y",
  "border-t-0",
  "border-b-0",
  "border-t-2",
  "border-b-2",
  "border-l-2",
  "border-r-2",
  "border-solid",
  "border-dashed",
  "border-dotted",
  "border-none",
  // The same five line styles, on the underline rather than the box. Missing
  // from this list, `decoration-dotted` reads as a request for a colour called
  // "dotted" and the guard fails on a class Tailwind emits perfectly well.
  "decoration-solid",
  "decoration-double",
  "decoration-dotted",
  "decoration-dashed",
  "decoration-wavy",
  "decoration-none",
  "decoration-0",
  "decoration-1",
  "decoration-2",
  "decoration-4",
  "decoration-8",
  "border-collapse",
  "border-separate",
  "border-spacing-0",
  "outline-none",
  "outline-0",
  "outline-1",
  "outline-2",
  "ring-0",
  "ring-1",
  "ring-2",
  "ring-4",
  "ring-inset",
  "shadow-sm",
  "shadow-md",
  "shadow-lg",
  "shadow-xl",
  "shadow-2xl",
  "shadow-none",
  "shadow-inner",
  "divide-x",
  "divide-y",
  "fill-none",
  "stroke-0",
  "stroke-1",
  "stroke-2",
  "bg-clip-text",
  "bg-cover",
  "bg-contain",
  "bg-center",
  "bg-no-repeat",
  "bg-fixed",
  "bg-none",
]);

/** Colours every theme has, whatever it declares. */
const UNIVERSAL = new Set(["transparent", "current", "inherit", "black", "white"]);

const PREFIXES = [
  "bg",
  "text",
  "border",
  "ring",
  "outline",
  "fill",
  "stroke",
  "decoration",
  "divide",
  "shadow",
  "from",
  "via",
  "to",
  "accent",
  "caret",
  "placeholder",
];

function sources(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      sources(path, found);
      continue;
    }
    if (/\.tsx$/.test(entry)) found.push(path);
  }
  return found;
}

/**
 * Colour-shaped classes in a file, with variants and opacity stripped.
 *
 * Scoped to what is inside a quoted string, because prose in a doc comment
 * contains things like "to-do" that are not classes, and a false failure in a
 * guard is how a guard gets deleted.
 */
export function colourClasses(source: string): string[] {
  const found: string[] = [];

  for (const [, quoted] of source.matchAll(/["'`]([^"'`\n]*)["'`]/g)) {
    for (const raw of (quoted as string).split(/\s+/)) {
      // `hover:`, `sm:`, `focus-visible:`, `[&>label]:` and `/60`.
      const token = raw.replace(/^(?:[^:\s]*:)*/, "").replace(/\/\d+$/, "");
      const prefix = PREFIXES.find((candidate) => token.startsWith(`${candidate}-`));
      if (prefix === undefined) continue;
      if (NOT_COLOURS.has(token)) continue;
      // `outline-offset-2`, `ring-offset-[-2px]` — a distance, not a colour.
      if (/^(?:outline|ring)-offset-/.test(token)) continue;

      const colour = token.slice(prefix.length + 1);
      // Arbitrary values and CSS variables are somebody being explicit.
      if (colour.startsWith("[") || colour.startsWith("(")) continue;
      found.push(colour);
    }
  }

  return found;
}

describe("§8 — a colour named by a component is one the theme declares", () => {
  it("finds no utility naming a colour that does not exist", () => {
    const palette = declaredColours();
    const files = [
      ...sources(join(ROOT, "packages/ui/src")),
      ...sources(join(ROOT, "apps/web/app")),
    ];

    const strays: string[] = [];
    for (const file of files) {
      for (const colour of colourClasses(readFileSync(file, "utf8"))) {
        if (palette.has(colour) || UNIVERSAL.has(colour)) continue;
        strays.push(`${file.slice(ROOT.length + 1)} — no colour called "${colour}"`);
      }
    }

    // Tailwind emits nothing for an unknown utility, so the element renders
    // transparent and the page shows through it. It looks like a decision.
    expect([...new Set(strays)]).toEqual([]);
  });

  it("reads the palette off the stylesheet rather than a copy of it", () => {
    const palette = declaredColours();

    expect(palette.has("panel")).toBe(true);
    expect(palette.has("ink")).toBe(true);
    expect(palette.has("surface")).toBe(false);
  });

  it("does not mistake a size for a colour", () => {
    expect(colourClasses('className="text-sm border-t shadow-lg"')).toEqual([]);
  });

  it("sees through a variant and an opacity", () => {
    expect(colourClasses('className="hover:bg-panel/60 focus-visible:ring-action"')).toEqual([
      "panel",
      "action",
    ]);
  });

  it("catches the class of mistake it was written for", () => {
    expect(colourClasses('className="bg-surface"')).toEqual(["surface"]);
  });
});
