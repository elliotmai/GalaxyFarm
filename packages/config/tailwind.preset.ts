/**
 * Shared Tailwind preset — the "Midnight Nebula / Bluebonnet Linen" design
 * language locked in spec §8.
 *
 * One brand, two modes sharing the same hue anchors. Theme is a property of the
 * surface, not a user preference: `/admin` and `/kiosk` render Midnight Nebula,
 * everything customer-facing renders Bluebonnet Linen. The neutrals mirror each
 * other — admin's starlight text is the customer's linen canvas.
 *
 * Components never name a theme. They use the semantic colours below, which
 * resolve through CSS custom properties set by `data-theme` on the route-group
 * layout (`packages/ui/src/tokens/theme.css`). A component that branched on the
 * theme would need to be revisited every time a surface moved, and one that
 * hard-coded `midnight.*` would be wrong the first time it appeared on the
 * customer portal.
 */

export const palette = {
  linen: {
    canvas: "#F8F5EC",
    panel: "#FFFFFF",
    text: "#24243A",
    action: "#35569E",
    identity: "#5F45B0",
    // Darkened from #67805F, which came out at 3.99 against the linen canvas —
    // under AA for body text. Same hue and saturation, so it stays the
    // gray-leaning sage that must not be mistaken for safety-scale green.
    calm: "#5B7154",
  },
  midnight: {
    canvas: "#0E1026",
    panel: "#191C3C",
    text: "#F2EFE6",
    action: "#8CA3E8",
    identity: "#9D85E8",
    calm: "#A3BC9C",
  },
  /** Held in reserve for wins — show results, milestones. Currently unused. */
  brass: "#C9A24B",
} as const;

/**
 * Ink colours for a coloured chip.
 *
 * Fixed rather than theme-derived: a safety chip is the same colour on both
 * surfaces, so its text has to be legible against the chip and not against the
 * page behind it.
 */
export const chipInk = { light: "#FFFFFF", dark: "#14141F" } as const;

/**
 * The five-level handling scale (spec §5.1). Deliberately saturated and always
 * paired with its number, so it never competes with the gray-leaning sage used
 * for calm states — and so it survives being photographed, printed, or read by
 * someone who does not distinguish red from green.
 *
 * `ink` is per level because no single choice works: white fails AA on levels
 * 2, 3 and 4, and near-black fails on 1 and 5. Measured, not guessed — see
 * `packages/ui/tests/contrast.test.ts`.
 */
export const safetyScale = {
  1: { label: "Safe for anyone", color: "#2E7D32", ink: chipInk.light },
  2: { label: "Safe with basic caution", color: "#7CB342", ink: chipInk.dark },
  3: { label: "Confident handlers only", color: "#F9A825", ink: chipInk.dark },
  4: { label: "Owners only", color: "#EF6C00", ink: chipInk.dark },
  5: { label: "Do not handle", color: "#C62828", ink: chipInk.light },
} as const;

/**
 * The two themes, as the semantic tokens components actually use.
 *
 * This object is the source of truth. `packages/ui/src/tokens/theme.css` sets
 * the same values as CSS custom properties — that file is what ships, this one
 * is what the contrast tests read, and a test asserts they still agree.
 *
 * Every value here was checked rather than chosen by eye. `border` is a
 * measured 3:1 against both `canvas` and `panel` because it outlines controls,
 * which WCAG 2.1 §1.4.11 treats as information rather than decoration; `muted`
 * is text and clears 4.5.
 */
export const themes = {
  "midnight-nebula": {
    canvas: palette.midnight.canvas,
    panel: palette.midnight.panel,
    // A step above panel, for anything sitting *on* a panel — a table head, a
    // selected row, a nested well. §8 locks canvas and panel and says nothing
    // about a third; without one, every surface on this theme is one of two
    // near-identical values and the screen reads as flat dark-on-dark.
    raised: "#242A52",
    text: palette.midnight.text,
    muted: "#B4B2C8",
    border: "#7C80A6",
    action: palette.midnight.action,
    actionInk: chipInk.dark,
    identity: palette.midnight.identity,
    calm: palette.midnight.calm,
    danger: "#F08A84",
  },
  "bluebonnet-linen": {
    canvas: palette.linen.canvas,
    panel: palette.linen.panel,
    raised: "#F1EEE4",
    text: palette.linen.text,
    muted: "#565669",
    border: "#888897",
    action: palette.linen.action,
    actionInk: chipInk.light,
    identity: palette.linen.identity,
    calm: palette.linen.calm,
    danger: "#B3261E",
  },
} as const;

export type ThemeName = keyof typeof themes;
export type DensityName = keyof typeof density;

export const fontFamily = {
  heading: ["Zilla Slab", "Georgia", "serif"],
  body: ["Inter", "system-ui", "sans-serif"],
} as const;

/**
 * Density is a layout, not a font scale (spec §8).
 *
 * Kiosk targets are 64px because they are pressed with a gloved hand, in
 * winter, by someone who is not looking closely — well past the 44px the
 * platform guidelines ask for. Mobile is one-thumb logging; desktop is
 * data-dense tables with side panels.
 */
export const density = {
  desktop: { control: "36px", touchTarget: "36px", textSize: "15px", gap: "12px", radius: "6px" },
  mobile: { control: "44px", touchTarget: "44px", textSize: "16px", gap: "14px", radius: "10px" },
  kiosk: { control: "64px", touchTarget: "64px", textSize: "20px", gap: "20px", radius: "14px" },
} as const;

/** Semantic colours, resolved at runtime from the surface's `data-theme`. */
const semanticColors = {
  canvas: "var(--gf-canvas)",
  panel: "var(--gf-panel)",
  raised: "var(--gf-raised)",
  text: "var(--gf-text)",
  muted: "var(--gf-muted)",
  border: "var(--gf-border)",
  action: "var(--gf-action)",
  "action-ink": "var(--gf-action-ink)",
  identity: "var(--gf-identity)",
  calm: "var(--gf-calm)",
  danger: "var(--gf-danger)",
  brass: palette.brass,
};

const preset = {
  theme: {
    extend: {
      colors: {
        ...semanticColors,
        // The raw ramps stay available for the few places that legitimately
        // need one specific theme — the brand assets, and the theme file that
        // defines the variables above.
        linen: palette.linen,
        midnight: palette.midnight,
        safety: Object.fromEntries(Object.entries(safetyScale).map(([k, v]) => [k, v.color])),
      },
      fontFamily,
      fontSize: {
        // `--gf-text` is the text *colour*; the size is its own variable.
        density: "var(--gf-text-size)",
      },
      spacing: {
        control: "var(--gf-control)",
        density: "var(--gf-gap)",
      },
      borderRadius: {
        density: "var(--gf-radius)",
      },
      minHeight: {
        target: "var(--gf-touch-target)",
      },
      minWidth: {
        target: "var(--gf-touch-target)",
      },
      fontVariantNumeric: {
        // Tabular figures wherever numbers carry meaning: weights, tags,
        // straw counts, egg totals.
        tabular: "tabular-nums",
      },
    },
  },
};

export default preset;
