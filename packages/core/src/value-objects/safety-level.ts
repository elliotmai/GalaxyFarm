import { z } from "zod";

/**
 * The farm-wide handling scale (spec §5.1).
 *
 * The number is not decoration — it is carried alongside the colour everywhere
 * the scale is rendered, so the information survives being photographed,
 * printed in the housesitter guide, or read by someone who does not distinguish
 * red from green. Treat the colour as the redundant channel, not the primary
 * one.
 */

export const SAFETY_LEVELS = [1, 2, 3, 4, 5] as const;

export type SafetyLevel = (typeof SAFETY_LEVELS)[number];

export const safetyLevelSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

export interface SafetyLevelDefinition {
  readonly level: SafetyLevel;
  /** Default label. Configurable per property (spec §5.1). */
  readonly label: string;
  readonly colorToken: string;
}

export const SAFETY_LEVEL_DEFAULTS: Readonly<Record<SafetyLevel, SafetyLevelDefinition>> = {
  1: { level: 1, label: "Safe for anyone", colorToken: "safety.1" },
  2: { level: 2, label: "Safe with basic caution", colorToken: "safety.2" },
  3: { level: 3, label: "Confident handlers only", colorToken: "safety.3" },
  4: { level: 4, label: "Owners only", colorToken: "safety.4" },
  5: { level: 5, label: "Do not handle", colorToken: "safety.5" },
};

/**
 * A zone's effective level is the worst thing about it: its own hazards, or the
 * most dangerous animal standing in it.
 *
 * This is a derivation, never a stored field (spec §2, "derive, don't
 * duplicate"). Moving the bull into a green pen has to turn that pen red
 * everywhere at once, and it only does that if nothing cached the old answer.
 */
export function effectiveSafetyLevel(
  zoneBaseline: SafetyLevel,
  occupantLevels: readonly SafetyLevel[],
): SafetyLevel {
  return occupantLevels.reduce<SafetyLevel>(
    (worst, level) => (level > worst ? level : worst),
    zoneBaseline,
  );
}

/** Levels 4 and 5 are the ones a helper must not approach unaccompanied. */
export function requiresExperiencedHandler(level: SafetyLevel): boolean {
  return level >= 4;
}

/**
 * Dams are auto-suggested an elevated level from calving until cleared
 * (spec §5.1). Suggested, not forced — a quiet cow stays quiet, and the person
 * who knows that should be able to say so.
 */
export function suggestedLevelAfterCalving(current: SafetyLevel): SafetyLevel {
  return current >= 3 ? current : 3;
}
