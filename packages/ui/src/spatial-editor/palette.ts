import { safetyScale } from "@galaxy-farm/config/tailwind";
import { SAFETY_LEVELS } from "@galaxy-farm/core";

/**
 * The two skins of one editor (spec §2, §8).
 *
 * §2 is unusually specific about this: "the property map and the garden layout
 * designer are the same SVG editor with different palettes." A palette is
 * therefore everything that differs between the two — the words, the colour
 * scale, whether the ground is a photograph or a blank plan, whether corners
 * snap — and nothing else. If a difference cannot be expressed here it is a
 * sign the editor has learned something about a domain it should not know.
 *
 * The words matter as much as the colours. An editor that says "shape" and
 * "chip" to somebody tracing a pasture is an editor nobody trusts; the same
 * one saying "bed" and "planting" in the garden is the same component reading
 * as if it had been written for the job.
 */

/** Singular and plural, because every sentence the editor writes needs both. */
export interface SpatialNoun {
  readonly one: string;
  readonly many: string;
}

/** One step of a palette's scale. */
export interface SpatialRank {
  readonly color: string;
  /** Legible against `color` — the fill is not the page behind it. */
  readonly ink: string;
  readonly label: string;
}

export interface SpatialPalette {
  readonly id: string;
  readonly shapeNoun: SpatialNoun;
  readonly chipNoun: SpatialNoun;
  /**
   * The scale a `rank` is read off, and what to call it.
   *
   * Keyed by number rather than listed, so a caller passing a rank the palette
   * does not define gets the plain outline instead of an off-by-one colour.
   */
  readonly ranks: Readonly<Record<number, SpatialRank>>;
  readonly rankTitle: string;
  /**
   * What the drawing itself is called.
   *
   * A "map" of a property and a "plan" of a garden, and the editor writes the
   * word in three places somebody reads — the tray of chips it could not place,
   * the message when there is nothing to open on, and the canvas's own name.
   * "Not on the map (2)" over a bed plan is the same kind of wrong as calling a
   * bed a shape: correct about the component, and not about the job.
   */
  readonly surfaceNoun: string;
  /**
   * What a chip's `accent` identifies, said out loud.
   *
   * The colour is drawn for everyone; the word is what a screen reader gets,
   * and it is the only place a chip's accent is legible in a dark barn. It is
   * a halter on a calf and a botanical family on a planting — the same dot,
   * two different facts, which is a palette's business rather than the
   * editor's.
   */
  readonly accentNoun: string;
  /**
   * What is under the shapes.
   *
   * `aerial` means a photograph, and the photograph is the point: a pen filled
   * solid is a pen whose ground nobody can see, so fills stay faint and the
   * outline carries the colour. `plan` means blank paper, where the shapes are
   * all there is and a faint fill would leave the drawing unreadable.
   */
  readonly ground: "aerial" | "plan";
  /**
   * Snap corners to the grid unless told otherwise.
   *
   * Off for a property: a fence line is where somebody put the posts, and
   * rounding a traced corner to the nearest half metre moves the boundary off
   * the fence in the photograph it was traced from. On for a garden, where
   * beds are built to a tape measure and a bed that is 2.98 m is a mistake.
   */
  readonly snapByDefault: boolean;
  /** What ground out of use is called here. */
  readonly restingLabel: string;
}

/** The five handling levels, from the one scale the whole app reads (§5.1). */
const SAFETY_RANKS = Object.fromEntries(
  SAFETY_LEVELS.map((level) => [
    level,
    {
      color: safetyScale[level].color,
      ink: safetyScale[level].ink,
      label: `${level} — ${safetyScale[level].label}`,
    },
  ]),
) as Readonly<Record<number, SpatialRank>>;

/**
 * Pens and pastures over aerial imagery.
 *
 * The scale is the farm-wide safety scale rather than a second set of colours
 * chosen for the map, so a pen that reads level 4 here is the same orange as
 * the badge on the animal that made it one. The number travels with the colour
 * in every label for the reason it always does (§5.1): the colour is the fast
 * path, never the only one.
 */
export const propertyPalette: SpatialPalette = {
  id: "property",
  shapeNoun: { one: "zone", many: "zones" },
  chipNoun: { one: "animal", many: "animals" },
  ranks: SAFETY_RANKS,
  rankTitle: "Safety level",
  surfaceNoun: "map",
  accentNoun: "halter",
  ground: "aerial",
  snapByDefault: false,
  restingLabel: "Resting",
};

/**
 * Beds on a plan — the garden layout designer (#33).
 *
 * Written before the designer existed, and unused until it did, which was the
 * point: a second palette is the only proof that the API is a palette and not
 * a fork. What the garden needed and this could not yet say turned out to be
 * two words — `surfaceNoun` and `accentNoun` — and widening the palette by two
 * strings is exactly the repair §2 asks for. A second component would have been
 * the alternative, and it would have been discovered with the editor already
 * load-bearing.
 *
 * The scale is the rotation guard (§5.5) rather than a hazard — a bed is not
 * dangerous, it is either clear to plant or it is not — which is exactly the
 * kind of difference a palette exists to hold. Step 2 covers everything inside
 * the rotation window that is not last season, because "two seasons back" and
 * "three seasons back" call for the same decision.
 */
export const gardenPalette: SpatialPalette = {
  id: "garden",
  shapeNoun: { one: "bed", many: "beds" },
  chipNoun: { one: "planting", many: "plantings" },
  ranks: {
    1: { color: "#4E6654", ink: "#FFFFFF", label: "1 — Clear to plant" },
    2: { color: "#F9A825", ink: "#1A1A1A", label: "2 — Same family two seasons back" },
    3: { color: "#C62828", ink: "#FFFFFF", label: "3 — Same family last season" },
  },
  rankTitle: "Rotation",
  surfaceNoun: "plan",
  accentNoun: "family",
  ground: "plan",
  snapByDefault: true,
  restingLabel: "Fallow",
};

/**
 * "a zone", "an animal" — the article a palette's noun takes.
 *
 * Small, and worth having: the editor writes its sentences out of nouns it is
 * handed, so a hard-coded "a" reads "a animal" the first time a palette names
 * something beginning with a vowel. Which is the property palette, today.
 */
export function withArticle(noun: string): string {
  return `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
}

/** A rank's step, or undefined for a shape the palette has nothing to say about. */
export function rankOf(palette: SpatialPalette, rank: number | undefined): SpatialRank | undefined {
  if (rank === undefined) return undefined;
  return palette.ranks[rank];
}
