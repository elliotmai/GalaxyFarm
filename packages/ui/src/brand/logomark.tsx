/**
 * Flying Double M Connected, as a component (spec §8).
 *
 * The same drawing as the two SVG files beside this one, inlined so it can
 * take its colour from the surface's theme tokens rather than from a literal.
 * An `<img>` cannot do that — it would need a third file the day a token
 * changes, and the two would drift.
 *
 * The geometry is not to be adjusted. Two things in it are load-bearing:
 *
 * The M's share their middle leg. That is what makes the pair one mark rather
 * than two letters standing near each other, and it is why the leg is drawn
 * straight up — the right leg of a splayed M leans the opposite way to the
 * left leg of the next one, so a splayed pair cannot merge.
 *
 * Each crest turns outward, against the way the outer leg splays. Drawn
 * rising the same way the leg already goes, crest and leg read as one long
 * stroke and the M loses one.
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

/** The connected pair, in the 100x100 viewBox: down, up, valley, up, down. */
const PAIR = "M22 77.89 L27.6 33.09 L38.8 54.37 L50 33.09 L61.2 54.37 L72.4 33.09 L78 77.89";

/** The shared middle leg, which the pair hangs from. */
const LEG = "M50 33.09 L50 77.89";

/** A crest on each outer shoulder: out, over, and down. */
const CRESTS = "M27.6 33.09 Q18.64 17.41 11.92 24.13 M72.4 33.09 Q81.36 17.41 88.08 24.13";

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
      {/*
        One colour, one width. A brand is a burn: the iron does not change
        weight partway through a mark, and there is no second element here to
        give a second colour to. Identity carries it on both surfaces.
      */}
      <g
        fill="none"
        stroke="var(--gf-identity)"
        strokeWidth={7.84}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={PAIR} />
        <path d={LEG} />
        <path d={CRESTS} />
      </g>
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
