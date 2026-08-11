import { describe, expect, it } from "vitest";

import { HALTER_COLORS } from "../src/halter/halter-swatch.js";
import { chipInk, safetyScale, themes } from "@galaxy-farm/config/tailwind";
import {
  AA_NON_TEXT,
  AA_TEXT,
  contrastRatio,
  parseHex,
  readableInk,
  relativeLuminance,
  saturation,
} from "../src/tokens/contrast.js";

/**
 * Contrast, checked rather than assumed (spec §8, and the acceptance criterion
 * on #3 that says exactly that).
 *
 * Two things failed the first time this ran, and neither was visible by
 * looking. The light theme's sage came out at 3.99 as body text — under AA, and
 * it is the colour used for calm states, which is most of the page. And no
 * single ink passes on all five safety chips: white fails on the yellow-greens
 * at 1.97, near-black fails on the dark green and the red. Both are fixed in
 * `@galaxy-farm/config/tailwind`; these tests are what keep them fixed.
 */

describe("the contrast maths itself", () => {
  it("agrees with the WCAG reference values", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    // Mid gray — the sRGB transfer curve is why this is not 0.5.
    expect(relativeLuminance("#808080")).toBeCloseTo(0.2159, 3);
  });

  it("is symmetric, because contrast has no direction", () => {
    expect(contrastRatio("#35569E", "#F8F5EC")).toBeCloseTo(
      contrastRatio("#F8F5EC", "#35569E"),
      10,
    );
  });

  it("reads shorthand and rejects what is not a colour", () => {
    expect(parseHex("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex("24243A")).toEqual({ r: 36, g: 36, b: 58 });
    expect(() => parseHex("#hotpink")).toThrow(/hex colour/);
  });
});

describe("theme tokens", () => {
  for (const [name, theme] of Object.entries(themes)) {
    describe(name, () => {
      for (const ground of ["canvas", "panel"] as const) {
        it(`carries text and muted text at AA on ${ground}`, () => {
          for (const ink of ["text", "muted"] as const) {
            const ratio = contrastRatio(theme[ink], theme[ground]);
            expect(ratio, `${ink} on ${ground} is ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(
              AA_TEXT,
            );
          }
        });

        it(`carries action, identity, calm, and danger at AA on ${ground}`, () => {
          // These are used as text — a link, a status word, a validation
          // message. Sage is the one that failed here, at 3.99.
          for (const ink of ["action", "identity", "calm", "danger"] as const) {
            const ratio = contrastRatio(theme[ink], theme[ground]);
            expect(ratio, `${ink} on ${ground} is ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(
              AA_TEXT,
            );
          }
        });

        it(`outlines controls visibly on ${ground}`, () => {
          // WCAG 2.1 §1.4.11: a border that tells you where a control is, is
          // information rather than decoration.
          const ratio = contrastRatio(theme.border, theme[ground]);
          expect(ratio, `border on ${ground} is ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(
            AA_NON_TEXT,
          );
        });
      }

      it("puts legible ink on a filled action button", () => {
        expect(contrastRatio(theme.actionInk, theme.action)).toBeGreaterThanOrEqual(AA_TEXT);
      });

      it("keeps sage clear of safety green, so calm never reads as safe", () => {
        // §8 is explicit that these must not be confused, and the two are
        // near-identical in hue by design — 106° against 123°. What separates
        // them is that sage is deliberately gray-leaning, so saturation is
        // what gets measured. Let them converge and the page starts making a
        // claim about handling that it does not mean.
        expect(saturation(theme.calm)).toBeLessThan(saturation(safetyScale[1].color) / 2);
      });
    });
  }
});

describe("the safety scale", () => {
  const levels = [1, 2, 3, 4, 5] as const;

  it("puts a readable number on every chip", () => {
    // The number is the part that has to survive. Colour is the fast path for
    // people who can use it; the number is what everyone else reads.
    for (const level of levels) {
      const step = safetyScale[level];
      const ratio = contrastRatio(step.ink, step.color);
      expect(ratio, `level ${level} ink on chip is ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(
        AA_TEXT,
      );
    }
  });

  it("has no single ink that would have worked — which is why ink is per level", () => {
    // Documenting the finding rather than just its fix. If this ever stops
    // being true the per-level ink can be simplified away.
    const allWhite = levels.every((l) => contrastRatio(chipInk.light, safetyScale[l].color) >= 4.5);
    const allDark = levels.every((l) => contrastRatio(chipInk.dark, safetyScale[l].color) >= 4.5);

    expect(allWhite).toBe(false);
    expect(allDark).toBe(false);
  });

  it("picks each level's ink the way readableInk would", () => {
    for (const level of levels) {
      const step = safetyScale[level];
      expect(readableInk(step.color, [chipInk.light, chipInk.dark])).toBe(step.ink);
    }
  });

  it("cannot rely on the fill alone to be perceivable, so the chip is ringed", () => {
    // §1.4.11 asks 3:1 of a meaningful non-text mark. Level 2's yellow-green
    // manages 2.30 against the linen canvas, and darkening it enough to pass
    // would take level 3's amber to brown — costing the scale the
    // traffic-light read that is the whole point of the colour. The boundary
    // carries the requirement instead: SafetyBadge rings every chip in the
    // theme's border token, which is a measured 3:1 on both grounds.
    const weak = levels.filter(
      (level) =>
        contrastRatio(safetyScale[level].color, themes["bluebonnet-linen"].canvas) < AA_NON_TEXT,
    );
    expect(weak.length, "if every fill now passes, the ring can be reconsidered").toBeGreaterThan(
      0,
    );

    for (const [name, theme] of Object.entries(themes)) {
      const ratio = contrastRatio(theme.border, theme.canvas);
      expect(ratio, `${name} ring on canvas is ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(
        AA_NON_TEXT,
      );
    }
  });

  it("stays distinguishable step to step", () => {
    // Adjacent levels that look alike make the scale decorative. This is a
    // weaker bar than AA on purpose — 3 and 4 are amber and orange by design.
    for (let i = 0; i < levels.length - 1; i += 1) {
      const a = safetyScale[levels[i]!].color;
      const b = safetyScale[levels[i + 1]!].color;
      expect(contrastRatio(a, b), `levels ${i + 1} and ${i + 2} look alike`).toBeGreaterThan(1.2);
    }
  });
});

describe("halter colours", () => {
  it("gives every stock colour a name, because two dark ones look alike", () => {
    for (const halter of HALTER_COLORS) {
      expect(halter.name.length).toBeGreaterThan(0);
      expect(() => parseHex(halter.color)).not.toThrow();
    }
  });

  it("relies on the ring for the ones that vanish into a panel", () => {
    // Black on midnight and white on linen are the cases the swatch's ring
    // exists for. Asserting they really are invisible without it keeps the
    // ring from being removed as decoration.
    const black = HALTER_COLORS.find((h) => h.name === "Black")!;
    const white = HALTER_COLORS.find((h) => h.name === "White")!;

    expect(contrastRatio(black.color, themes["midnight-nebula"].panel)).toBeLessThan(AA_NON_TEXT);
    expect(contrastRatio(white.color, themes["bluebonnet-linen"].panel)).toBeLessThan(AA_NON_TEXT);

    for (const theme of Object.values(themes)) {
      expect(contrastRatio(theme.border, theme.panel)).toBeGreaterThanOrEqual(AA_NON_TEXT);
    }
  });
});
