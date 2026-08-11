/**
 * WCAG 2.1 contrast, computed rather than eyeballed (spec §8).
 *
 * Every colour pair the design system puts together is asserted against these
 * in `tests/contrast.test.ts`. Two problems turned up the first time it ran, and
 * neither was visible by looking: the light theme's sage failed AA as body text
 * at 3.99, and no single ink colour passes on all five safety chips — white
 * fails on the yellow-greens, black fails on the dark green and the red.
 *
 * The formulas are from WCAG 2.1 §1.4.3 and are not approximations.
 */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** WCAG AA for body text. */
export const AA_TEXT = 4.5;
/** WCAG AA for text at 18pt, or 14pt bold. */
export const AA_LARGE_TEXT = 3;
/** WCAG 2.1 §1.4.11 — icons, chips, and other meaningful non-text marks. */
export const AA_NON_TEXT = 3;

export function parseHex(hex: string): Rgb {
  const cleaned = hex.replace("#", "");
  const expanded =
    cleaned.length === 3
      ? cleaned
          .split("")
          .map((c) => c + c)
          .join("")
      : cleaned;

  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    throw new Error(`Not a hex colour: "${hex}"`);
  }

  return {
    r: parseInt(expanded.slice(0, 2), 16),
    g: parseInt(expanded.slice(2, 4), 16),
    b: parseInt(expanded.slice(4, 6), 16),
  };
}

/** Relative luminance, WCAG 2.1 §1.4.3. */
export function relativeLuminance(colour: string | Rgb): number {
  const { r, g, b } = typeof colour === "string" ? parseHex(colour) : colour;

  const channel = (value: number): number => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
  };

  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio between two colours, 1 (identical) to 21 (black on white). */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

export function meetsContrast(
  foreground: string,
  background: string,
  minimum: number = AA_TEXT,
): boolean {
  return contrastRatio(foreground, background) >= minimum;
}

/**
 * Whichever of two inks reads better on a background.
 *
 * Used for the safety chips, where the five colours span from a dark green to
 * a mid yellow and no single ink survives all of them.
 */
export function readableInk(background: string, inks: readonly [string, string]): string {
  const [first, second] = inks;
  return contrastRatio(first, background) >= contrastRatio(second, background) ? first : second;
}

/**
 * HSL saturation, 0 (gray) to 1 (fully saturated).
 *
 * Here because §8 makes a claim contrast cannot express: the sage used for calm
 * states must not read as safety-scale green. The two are near-identical in
 * hue by design — what separates them is that sage is deliberately
 * gray-leaning. That is a saturation difference, so that is what gets measured.
 */
export function saturation(colour: string): number {
  const { r, g, b } = parseHex(colour);
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  if (max === min) return 0;

  const lightness = (max + min) / 2;
  return lightness > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}
