/**
 * Shared Tailwind preset — the "Flying Double M" design language (spec §8, v0.9).
 *
 * Light by default, on every surface. The farm's mark is a brand iron, and the
 * world it comes from is paperwork: registration certificates, sale
 * catalogues, herd ledgers. That is a daylight world, and it is also the right
 * one for the jobs — printing a pedigree, showing a buyer a screen, a kiosk in
 * a sunlit barn. `flying-night` exists for the barn after dark and is a mode,
 * not the default look of a surface.
 *
 * The palette is deliberately narrow. A neutral ground, one accent that is both
 * the brand and every primary action, and two more colours that mean exactly
 * one thing each — confirm and alert. When every surface is tinted, tint stops
 * carrying information; that is what the previous language got wrong.
 *
 * Components never name a theme. They use the semantic colours below, which
 * resolve through CSS custom properties set by `data-theme` on the route-group
 * layout (`packages/ui/src/tokens/theme.css`). A component that branched on the
 * theme would need to be revisited every time a surface moved.
 */

export const palette = {
  /** Ink Navy. One accent, carrying the mark and every primary action. */
  navy: "#1B3A5C",
  /** Its counterpart after dark — lifted until it reads on a near-black ground. */
  navyNight: "#8FB3D9",
  /**
   * Held in reserve for wins — show results, milestones. Still unused, and it
   * cannot carry text: #C9A24B is 2.0:1 on white. It is a fill or a rule.
   */
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
 *
 * The fills are unchanged by the move to a light ground, and three of them do
 * not clear 3:1 against it — the light green, the amber and the orange land at
 * 2.32, 1.82 and 2.85. Darkening them would flatten the green-to-red
 * progression the scale exists for, so the ring `SafetyBadge` already draws
 * carries §1.4.11 instead. `border` is a measured 3:1 on both themes, which is
 * what makes that ring load-bearing rather than decorative.
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
  "flying-day": {
    canvas: "#F5F6F8",
    panel: "#FFFFFF",
    // A step above panel, for anything sitting *on* a panel — a table head, a
    // selected row, a nested well. Without a third surface the screen is one
    // of two near-identical values and reads as flat.
    raised: "#EDEFF3",
    text: "#14171B",
    muted: "#525860",
    // Two edges, not one. `border` bounds a control — an input, a button, a
    // chip — which §1.4.11 treats as information, so it is a measured 3:1
    // against canvas, panel and raised alike. `rule` only separates one group
    // of content from the next, and holding that to 3:1 was what made the old
    // screens read as a grid of outlines: the border was four times more
    // visible than the surface it outlined.
    border: "#7F8B96",
    rule: "#DDE1E6",
    action: palette.navy,
    actionInk: chipInk.light,
    // The same navy as `action`, deliberately. The mark and the primary action
    // are one colour because there is one brand colour; a separate identity
    // hue would be a second accent competing with the first.
    identity: palette.navy,
    calm: "#4E6654",
    danger: "#A8321F",
  },
  "flying-night": {
    canvas: "#0F1419",
    panel: "#171D24",
    raised: "#1F2831",
    text: "#E8EBEF",
    muted: "#9BA5B0",
    border: "#63727B",
    rule: "#2A333D",
    action: palette.navyNight,
    actionInk: "#0F1419",
    identity: palette.navyNight,
    calm: "#A3BCA9",
    danger: "#E8897C",
  },
} as const;

export type ThemeName = keyof typeof themes;
export type DensityName = keyof typeof density;

/**
 * Type is a property of the density, not of the app (spec §8, v0.9).
 *
 * The three surfaces are not one layout at three sizes; each answers a
 * different question, so each gets its own treatment on the one palette.
 *
 * **Desktop** is the herd book: a text serif carries names and figures with the
 * authority a registration certificate has, over a neutral grotesque for
 * controls. **Mobile** drops the serif — a phone is read at arm's length in
 * sunlight and one grotesque at two weights is more legible there than any
 * pairing. **Kiosk** is signage: condensed caps, because a label has to be read
 * from the alley and a condensed face buys the width to do it.
 *
 * These are the *loaded* families. `apps/web/app/layout.tsx` fetches them with
 * `next/font` and points `--font-display-loaded` and friends at them; the
 * fallbacks here are what shows for the one paint before the file arrives.
 */
export const fontFamily = {
  display: ["var(--gf-font-display)"],
  ui: ["var(--gf-font-ui)"],
  numeric: ["var(--gf-font-numeric)"],
  mono: ["var(--gf-font-mono)"],
} as const;

/** What each density sets those four to. */
export const densityFonts = {
  desktop: {
    display: 'var(--font-serif-loaded, "Source Serif 4"), Georgia, serif',
    ui: 'var(--font-sans-loaded, "IBM Plex Sans"), system-ui, sans-serif',
    numeric: 'var(--font-serif-loaded, "Source Serif 4"), Georgia, serif',
  },
  mobile: {
    display: 'var(--font-sans-loaded, "IBM Plex Sans"), system-ui, sans-serif',
    ui: 'var(--font-sans-loaded, "IBM Plex Sans"), system-ui, sans-serif',
    numeric: 'var(--font-sans-loaded, "IBM Plex Sans"), system-ui, sans-serif',
  },
  kiosk: {
    display: 'var(--font-cond-loaded, "Barlow Condensed"), "Arial Narrow", sans-serif',
    ui: 'var(--font-sans-loaded, "IBM Plex Sans"), system-ui, sans-serif',
    numeric: 'var(--font-sans-loaded, "IBM Plex Sans"), system-ui, sans-serif',
  },
} as const;

/** Tag numbers, registration numbers, serials. The same on every surface. */
export const monoFamily = 'var(--font-mono-loaded, "IBM Plex Mono"), ui-monospace, monospace';

/**
 * Density is a layout, not a font scale (spec §8).
 *
 * Kiosk targets are 64px because they are pressed with a gloved hand, in
 * winter, by someone who is not looking closely — well past the 44px the
 * platform guidelines ask for. Mobile is one-thumb logging; desktop is
 * data-dense tables with side panels.
 *
 * Radius travels with the density and with the treatment it carries: a herd
 * book is a document and keeps its corners tight, a phone is a phone, and
 * signage has no radius at all.
 */
export const density = {
  desktop: { control: "36px", touchTarget: "36px", textSize: "15px", gap: "12px", radius: "3px" },
  mobile: { control: "44px", touchTarget: "44px", textSize: "16px", gap: "14px", radius: "10px" },
  kiosk: { control: "64px", touchTarget: "64px", textSize: "20px", gap: "20px", radius: "0px" },
} as const;

/** Semantic colours, resolved at runtime from the surface's `data-theme`. */
const semanticColors = {
  canvas: "var(--gf-canvas)",
  panel: "var(--gf-panel)",
  raised: "var(--gf-raised)",
  text: "var(--gf-text)",
  muted: "var(--gf-muted)",
  border: "var(--gf-border)",
  rule: "var(--gf-rule)",
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
        // The raw values stay available for the few places that legitimately
        // need one specific colour rather than a semantic role.
        navy: palette.navy,
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
