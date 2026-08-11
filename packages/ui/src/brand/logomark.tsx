/**
 * Rocking Double Star, as a component (spec §8).
 *
 * The same drawing as the two SVG files beside this one, inlined so it can
 * take its colours from the surface's theme tokens rather than from literals.
 * An `<img>` cannot do that — it would need a third file the day a token
 * changes, and the two would drift.
 *
 * The geometry is not to be adjusted. The calf's size and distance from the
 * cow were the whole design question, and the rocker is what holds the pair
 * together as one mark below about 24px.
 */

export type LogomarkSize = "small" | "default" | "large";

export interface LogomarkProps {
  readonly size?: LogomarkSize;
  /**
   * Set on a page that already says the farm's name in text — the mark is
   * then decoration and repeating the name announces it twice.
   */
  readonly decorative?: boolean;
  readonly className?: string;
}

const PIXELS: Record<LogomarkSize, number> = { small: 24, default: 40, large: 96 };

/** The five-pointed star, drawn once and placed twice. */
const STAR =
  "50,16 57.94,39.08 82.34,39.49 62.84,54.17 69.99,77.51 " +
  "50,63.5 30.01,77.51 37.16,54.17 17.66,39.49 42.06,39.08";

export function Logomark({ size = "default", decorative = false, className }: LogomarkProps) {
  const pixels = PIXELS[size];

  return (
    <svg
      viewBox="0 0 100 100"
      width={pixels}
      height={pixels}
      className={className}
      {...(decorative
        ? { "aria-hidden": true as const, role: "presentation" }
        : { role: "img" as const, "aria-label": "Galaxy Farm" })}
    >
      {/* The rocker takes the surface's action colour; the stars take identity. */}
      <path
        d="M12 78 Q50 98 88 78"
        fill="none"
        stroke="var(--gf-identity)"
        strokeWidth={8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polygon
        points={STAR}
        fill="var(--gf-text)"
        stroke="var(--gf-text)"
        strokeWidth={5}
        strokeLinejoin="round"
        transform="translate(40 42) scale(0.7059) translate(-50 -50)"
      />
      <polygon
        points={STAR}
        fill="var(--gf-text)"
        stroke="var(--gf-text)"
        strokeWidth={5}
        strokeLinejoin="round"
        transform="translate(72 62) scale(0.3676) translate(-50 -50)"
      />
    </svg>
  );
}

export interface WordmarkProps {
  readonly farmName: string;
  readonly size?: LogomarkSize;
  readonly className?: string;
}

/**
 * The mark beside the name.
 *
 * The name is a prop because it is a BrandingConfig value (§5.1) — never a
 * string literal in a component. The mark is decorative here: the text next to
 * it already says what it says.
 */
export function Wordmark({ farmName, size = "default", className }: WordmarkProps) {
  return (
    <span className={["inline-flex items-center gap-2", className ?? ""].filter(Boolean).join(" ")}>
      <Logomark size={size} decorative />
      <span className="font-heading font-semibold text-ink">{farmName}</span>
    </span>
  );
}
