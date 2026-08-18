import type { GeoPoint } from "@galaxy-farm/core";

import type { GeoBounds } from "./geometry.js";

/**
 * What the spatial editor draws (spec §2, §8).
 *
 * Deliberately generic, exactly as `charts/pedigree.tsx` is. This package may
 * only depend on the kernel (§4.1), so nothing here knows what a pen is, what
 * a bed is, or that either has an owner — a caller flattens whatever it has
 * into these shapes and gets an editor back. That is what makes §2's "the
 * property map and the garden layout designer are the same editor with
 * different palettes" a palette rather than a fork, and it is why the same
 * component can draw a herd on a pasture and tomatoes in a raised bed without
 * being told which it is doing.
 *
 * The rule that survives every mode: **a boundary is lat/lng.** Screen
 * coordinates exist only between projecting for a frame and unprojecting what
 * the user did with it, and are never handed back to a caller.
 */

/**
 * One line of instruction, and where it came from.
 *
 * A merged set is only worth reading if every line still says what it applies
 * to. "Gets a scoop of grain at night" is a different instruction depending on
 * whether it is true of this calf or of everything in Pen B, and the person
 * reading it is standing in a barn with no way to ask. The caller does the
 * merging and the attributing — see §5.1's resolution — and the editor knows
 * only that a line has a source and a body.
 */
export interface SpatialInstruction {
  /** What this came from, in the reader's words: "Dolly", "Pen B", "North". */
  readonly from: string;
  readonly text: string;
}

/** A ring of ground — a pen, a pasture, a bed. */
export interface SpatialShape {
  readonly id: string;
  readonly label: string;
  /**
   * The ring, in real coordinates.
   *
   * Absent is an ordinary state rather than missing data: a pen that exists on
   * the place and has not been traced yet. The editor draws nothing for it and
   * says so, because a shape silently missing from a map reads as a shape that
   * was deleted.
   */
  readonly boundary?: readonly GeoPoint[] | undefined;
  /** Under the name — "part of it only, shut out of the creek". */
  readonly sublabel?: string | undefined;
  /**
   * Where this shape stands on the palette's scale: the safety level in
   * property mode, the rotation guard in garden mode. Out-of-range or absent
   * draws in the palette's plain outline rather than failing.
   */
  readonly rank?: number | undefined;
  /**
   * Ground deliberately out of use — a resting pasture, a bed lying fallow.
   * Drawn dimmed and hatched (§5.1), so it is not mistaken for ground in use.
   */
  readonly resting?: boolean | undefined;
  /** Retired ground. Quieter still, and never a drop target. */
  readonly inactive?: boolean | undefined;
  /** Shown when the shape is chosen. Merged upstream by the caller. */
  readonly instructions?: readonly SpatialInstruction[] | undefined;
  /** Runs across the shape that do not close — temporary fencing, a path. */
  readonly lines?: readonly SpatialLine[] | undefined;
  /**
   * Whether a chip may be dropped here.
   *
   * Defaults to true. Set false for ground nothing lives on — a working
   * facility, an area that holds pens rather than animals — so a drag ends
   * where it started rather than writing a placement nobody meant.
   */
  readonly acceptsChips?: boolean | undefined;
}

/** A line that does not close: a cross-fence, a walkway, an irrigation run. */
export interface SpatialLine {
  readonly id: string;
  readonly label: string;
  readonly points: readonly GeoPoint[];
  /** Drawn dashed. The convention on the hand-sketched map: not there now. */
  readonly dashed?: boolean | undefined;
}

/** Something standing in a shape — an animal, a planting. */
export interface SpatialChip {
  readonly id: string;
  readonly label: string;
  /** The shape it is in. Absent means it is not placed anywhere. */
  readonly shapeId?: string | undefined;
  readonly sublabel?: string | undefined;
  /** The palette's scale again — this animal's own safety level. */
  readonly rank?: number | undefined;
  /**
   * A colour that identifies this one thing rather than grading it: the halter
   * a calf wears, the flower of a variety. Any CSS colour. `accentLabel` is
   * what it is called, and it travels with the colour everywhere the colour
   * goes — two calves in navy and black are the same chip in a dark barn.
   */
  readonly accent?: string | undefined;
  readonly accentLabel?: string | undefined;
  /**
   * Why this one sits where it does on the scale, in one line.
   *
   * "Kicks when cornered" belongs beside the level it explains rather than in
   * among the care instructions: a level with no reason is a number somebody
   * argues with, and a reason filed under "instructions" is a warning read
   * fourth.
   */
  readonly rankNote?: string | undefined;
  readonly instructions?: readonly SpatialInstruction[] | undefined;
}

/**
 * A georeferenced raster to draw the shapes over (spec §8).
 *
 * This is the offline half of the hybrid: online the ground is Google's
 * satellite layer, drawn under the editor as live tiles that are never stored,
 * and offline it is an owned image — a USDA NAIP snapshot of the property,
 * public domain, kept in R2 and cached by the service worker. Both are just
 * ground under the same lat/lng shapes, which is the entire reason the
 * boundaries are stored in coordinates.
 *
 * The bounds are not optional and not derivable. An aerial photograph without
 * its extent is a picture, not a map: nothing about the pixels says which
 * ground they cover, and drawing pens over an image placed by guesswork would
 * be worse than drawing them over nothing.
 */
export interface SpatialImagery {
  readonly url: string;
  readonly bounds: GeoBounds;
  /** Credit line, shown in the corner. NAIP is public domain; say so anyway. */
  readonly attribution?: string | undefined;
}

/**
 * A boundary being traced or adjusted.
 *
 * Held by the caller rather than inside the editor, because what "saving"
 * means belongs to whoever owns the records — the map screen writes a zone,
 * the garden designer will write a bed, and neither wants the other's idea of
 * a commit. The editor reports every change and draws what it is given.
 */
export interface SpatialDraft {
  readonly shapeId: string;
  readonly boundary: readonly GeoPoint[];
}

/** A chip moved from one shape to another. */
export interface SpatialReassignment {
  readonly chipId: string;
  readonly fromShapeId?: string | undefined;
  readonly toShapeId: string;
}
