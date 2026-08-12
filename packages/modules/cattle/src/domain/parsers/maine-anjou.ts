import { parseComposition, type FieldReader } from "./page.js";
import type { DigitalBeefBreed } from "./digital-beef-breed.js";

/**
 * Maine-Anjou — the American Maine-Anjou Association (spec §5.2).
 *
 * **This page prints no breed makeup.** Not a blank one — none. Everything the
 * AMAA has to say about what an animal is made of is in one field,
 * `Classification`, which holds `FB`, `PB`, `3/4`, `5/8` and the rest of the
 * upgrading chart's classes. That is why a dual-registered animal has to be
 * refreshed against *both* its registries: check the Maine-Anjou number alone
 * and the breeding comes back empty, which is what made a whole herd look like
 * it had no makeup on file.
 *
 * The classification is kept exactly as printed and preferred over anything
 * worked out from a percentage. The registry decided it, the upgrading chart
 * takes classes rather than fractions, and an animal upgraded years ago can
 * hold a class its current makeup would not earn on its own. Recomputing it
 * would quietly take that away.
 *
 * **The tattoo is a left ear and a right ear**, one of which is usually blank —
 * an empty cell being the same answer as no cell, and both different from "we
 * could not find where to look".
 *
 * The pedigree cites Chianina numbers with a `CA` tag and Angus numbers with an
 * `AN` one. The Angus ones are not on any Digital Beef site at all; they are at
 * angus.org, which has its own reader.
 */

export const MAINE_ANJOU: DigitalBeefBreed = {
  association: "AMAA",
  breed: "Maine-Anjou",
  host: "maine-anjou.digitalbeef.com",
  /** `reg  [ tattoo ]  name`. */
  pedigreeLayout: "reg-tattoo-name",

  tattooOf(field: FieldReader): string | undefined {
    return field(["Tattoo - LE", "Left Ear", "LE", "Tattoo", "Tattoo - RE", "Right Ear", "RE"]);
  },

  papersOf(field: FieldReader) {
    const classification = field(["Classification"]);
    // Read anyway, for the day the template grows one. Today it never does.
    const makeup = field(["Genetic Makeup", "Breed Composition"]);

    return {
      composition: makeup === undefined ? [] : parseComposition(makeup),
      ...(classification === undefined ? {} : { classification }),
    };
  },
};
