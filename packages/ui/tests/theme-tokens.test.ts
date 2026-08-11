import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { density, themes } from "@galaxy-farm/config/tailwind";

/**
 * The CSS that ships and the TypeScript the tests read, kept in step.
 *
 * `theme.css` is what the browser sees; `themes` in the preset is what the
 * contrast suite checks. A value changed in one and not the other passes every
 * test and ships a badge nobody can read, so the two are compared directly.
 */

// Read from the repo root rather than through import.meta.url: everything
// under packages/ui runs in jsdom, where import.meta.url is an http URL and
// readFileSync refuses it.
const CSS = readFileSync(join(process.cwd(), "packages/ui/src/tokens/theme.css"), "utf8");

/** Custom properties declared inside one selector block. */
function variablesIn(selector: string): Record<string, string> {
  const block = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(CSS);
  if (block === null) throw new Error(`No block for ${selector} in theme.css`);

  const variables: Record<string, string> = {};
  for (const [, name, value] of block[1]!.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    variables[name!] = value!.trim();
  }
  return variables;
}

/** `actionInk` in TypeScript is `--gf-action-ink` in CSS. */
const cssName = (token: string) => `gf-${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

describe("theme.css matches the preset", () => {
  for (const [name, theme] of Object.entries(themes)) {
    it(`declares every ${name} token, with the same value`, () => {
      const declared = variablesIn(`[data-theme="${name}"]`);

      for (const [token, value] of Object.entries(theme)) {
        const variable = cssName(token);
        expect(declared[variable], `--${variable} is missing`).toBeDefined();
        expect(declared[variable]?.toLowerCase(), `--${variable} disagrees with the preset`).toBe(
          value.toLowerCase(),
        );
      }
    });

    it(`declares nothing extra for ${name}`, () => {
      // A stray variable is a token nothing tests and nothing else sets.
      const expected = new Set(Object.keys(theme).map(cssName));
      for (const variable of Object.keys(variablesIn(`[data-theme="${name}"]`))) {
        expect(expected.has(variable), `--${variable} is not in the preset`).toBe(true);
      }
    });
  }

  for (const [name, values] of Object.entries(density)) {
    it(`declares the ${name} density, with the same measurements`, () => {
      const declared = variablesIn(`[data-density="${name}"]`);

      for (const [token, value] of Object.entries(values)) {
        expect(declared[cssName(token)], `--${cssName(token)} disagrees`).toBe(value);
      }
    });
  }
});

describe("density follows the viewport unless a surface fixes it", () => {
  /** The `[data-theme]:not([data-density])` block, optionally inside a media query. */
  function fallbackVariables(insideMediaQuery: boolean): Record<string, string> {
    const blocks = [...CSS.matchAll(/\[data-theme\]:not\(\[data-density\]\)\s*\{([^}]*)\}/g)].map(
      (match) => match[1]!,
    );
    // The media-query copy is the second occurrence; source order is the
    // contract here, mobile-first as the CSS is written.
    const block = blocks[insideMediaQuery ? 1 : 0];
    if (block === undefined) throw new Error("No responsive density fallback in theme.css");

    const variables: Record<string, string> = {};
    for (const [, name, value] of block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
      variables[name!] = value!.trim();
    }
    return variables;
  }

  it("gives a phone the mobile measurements, without an attribute", () => {
    // The tokens are spelled out twice — here and in `[data-density="mobile"]`
    // — because CSS cannot alias a block. This is what keeps the copies equal.
    const fallback = fallbackVariables(false);
    for (const [token, value] of Object.entries(density.mobile)) {
      expect(fallback[cssName(token)], `mobile fallback ${token}`).toBe(value);
    }
  });

  it("gives a wider screen the desktop measurements", () => {
    const fallback = fallbackVariables(true);
    for (const [token, value] of Object.entries(density.desktop)) {
      expect(fallback[cssName(token)], `desktop fallback ${token}`).toBe(value);
    }
  });

  it("is mobile-first, so the smallest screen needs no media query", () => {
    const mobileAt = CSS.indexOf("[data-theme]:not([data-density])");
    const mediaAt = CSS.indexOf("@media (min-width: 48rem)");
    expect(mobileAt).toBeLessThan(mediaAt);
  });
});

describe("what the tokens promise", () => {
  it("gives the kiosk a target big enough for a gloved hand", () => {
    // Platform guidelines ask 44px. A barn in February is not a phone in a
    // living room, and someone carrying a bucket is not looking closely.
    expect(Number.parseInt(density.kiosk.touchTarget, 10)).toBeGreaterThanOrEqual(64);
  });

  it("never drops a touch target below the platform minimum on mobile", () => {
    expect(Number.parseInt(density.mobile.touchTarget, 10)).toBeGreaterThanOrEqual(44);
  });

  it("gets bigger with every density step, never smaller", () => {
    const steps = [density.desktop, density.mobile, density.kiosk];
    for (let i = 0; i < steps.length - 1; i += 1) {
      expect(Number.parseInt(steps[i + 1]!.touchTarget, 10)).toBeGreaterThan(
        Number.parseInt(steps[i]!.touchTarget, 10),
      );
      expect(Number.parseInt(steps[i + 1]!.textSize, 10)).toBeGreaterThan(
        Number.parseInt(steps[i]!.textSize, 10),
      );
    }
  });

  it("paints its own ground, so a surface never borrows a colour", () => {
    expect(CSS).toMatch(/\[data-theme\]\s*\{[^}]*background-color:\s*var\(--gf-canvas\)/);
    expect(CSS).toMatch(/\[data-theme\]\s*\{[^}]*color:\s*var\(--gf-text\)/);
  });

  it("honours a reduced-motion preference", () => {
    expect(CSS).toContain("prefers-reduced-motion: reduce");
  });
});
