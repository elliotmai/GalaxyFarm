import { safetyScale } from "@galaxy-farm/config/tailwind";
import type { SafetyLevel } from "@galaxy-farm/core";

/**
 * The five-level handling scale (spec §5.1, §8).
 *
 * **The number is never optional.** This badge is read off a photograph texted
 * to a housesitter, off a sheet printed and taped inside the barn door, and by
 * people who do not distinguish red from green — and it is the thing standing
 * between someone and an animal that will hurt them. Colour alone carries none
 * of that. The number always renders; the colour is the fast path for people
 * who can use it.
 *
 * The ink colour comes from the scale rather than the theme, because the chip
 * is the same colour on both surfaces and its text has to be legible against
 * the chip, not against the page behind it. No single ink works on all five —
 * see `tests/contrast.test.ts`.
 */

export type SafetyBadgeSize = "compact" | "default" | "kiosk";

export interface SafetyBadgeProps {
  readonly level: SafetyLevel;
  /**
   * Show the written meaning next to the number. Off in a dense table where
   * the column header already says what it is; on wherever the badge appears
   * alone, which is most places a stranger meets it.
   */
  readonly showLabel?: boolean;
  readonly size?: SafetyBadgeSize;
  /** Set when the level shown is raised by an occupant rather than the zone's own. */
  readonly raisedBy?: string;
  readonly className?: string;
}

const SIZES: Record<SafetyBadgeSize, { readonly box: string; readonly text: string }> = {
  compact: { box: "20px", text: "12px" },
  default: { box: "28px", text: "15px" },
  // Read from across a pen, by someone who is not going to walk closer first.
  kiosk: { box: "44px", text: "24px" },
};

export function SafetyBadge({
  level,
  showLabel = false,
  size = "default",
  raisedBy,
  className,
}: SafetyBadgeProps) {
  const step = safetyScale[level];
  const { box, text } = SIZES[size];

  // Screen readers get the meaning, not "3" — which on its own says nothing.
  const description = raisedBy
    ? `Safety level ${level}, ${step.label}. Raised by ${raisedBy}.`
    : `Safety level ${level}, ${step.label}`;

  return (
    <span
      className={className}
      data-safety-level={level}
      style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: box,
          height: box,
          borderRadius: "6px",
          backgroundColor: step.color,
          color: step.ink,
          fontSize: text,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
          // The ring, not the fill, is what makes the chip perceivable.
          //
          // Level 2's yellow-green sits at 2.30 against the linen canvas —
          // under the 3:1 WCAG 2.1 §1.4.11 asks of a meaningful mark. Darkening
          // it enough to pass would take the amber at level 3 to brown and cost
          // the scale its traffic-light read, which is the thing people
          // actually use. So the boundary carries the requirement instead: the
          // theme's border token is a measured 3:1 against both canvas and
          // panel, and the number inside is legible against the fill.
          boxShadow: "inset 0 0 0 1px var(--gf-border, #7f8b96)",
        }}
      >
        {level}
      </span>
      {showLabel ? (
        <span aria-hidden="true" style={{ fontSize: text }}>
          {step.label}
        </span>
      ) : null}
      <span
        style={{
          position: "absolute",
          width: "1px",
          height: "1px",
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          clipPath: "inset(50%)",
          whiteSpace: "nowrap",
        }}
      >
        {description}
      </span>
    </span>
  );
}
