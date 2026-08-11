/**
 * Shared Tailwind preset — the "Midnight Nebula / Bluebonnet Linen" design
 * language locked in spec §8.
 *
 * One brand, two modes sharing the same hue anchors. Theme is a property of the
 * surface, not a user preference: `/admin` and `/kiosk` render Midnight Nebula,
 * everything customer-facing renders Bluebonnet Linen. The neutrals mirror each
 * other — admin's starlight text is the customer's linen canvas.
 */

export const palette = {
  linen: {
    canvas: "#F8F5EC",
    panel: "#FFFFFF",
    text: "#24243A",
    action: "#35569E",
    identity: "#5F45B0",
    calm: "#67805F",
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
 * The five-level handling scale (spec §5.1). Deliberately saturated and always
 * paired with its number, so it never competes with the gray-leaning sage used
 * for calm states — and so it survives being photographed, printed, or read by
 * someone who does not distinguish red from green.
 */
export const safetyScale = {
  1: { label: "Safe for anyone", color: "#2E7D32" },
  2: { label: "Safe with basic caution", color: "#7CB342" },
  3: { label: "Confident handlers only", color: "#F9A825" },
  4: { label: "Owners only", color: "#EF6C00" },
  5: { label: "Do not handle", color: "#C62828" },
} as const;

export const fontFamily = {
  heading: ["Zilla Slab", "Georgia", "serif"],
  body: ["Inter", "system-ui", "sans-serif"],
} as const;

const preset = {
  theme: {
    extend: {
      colors: {
        linen: palette.linen,
        midnight: palette.midnight,
        brass: palette.brass,
        safety: Object.fromEntries(Object.entries(safetyScale).map(([k, v]) => [k, v.color])),
      },
      fontFamily,
      fontVariantNumeric: {
        // Tabular figures wherever numbers carry meaning: weights, tags,
        // straw counts, egg totals.
        tabular: "tabular-nums",
      },
    },
  },
};

export default preset;
