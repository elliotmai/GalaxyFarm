import { BREED_CODES, parseComposition, parseShorthornPercent, type FieldReader } from "./page.js";
import type { DigitalBeefBreed } from "./digital-beef-breed.js";

/**
 * Shorthorn — the American Shorthorn Association (spec §5.2).
 *
 * **The percentage field is a register code and a number.** `SH100`, `AR50`,
 * `AR25`, `0`. Reading the letters as a breed was a real bug: an `AR50` animal
 * came out as "50% AR", a breed that does not exist, instead of half
 * Shorthorn. The field is labelled *Shorthorn %*, so whatever prefix it
 * carries, the number is the Shorthorn share — and the prefix is the register
 * the animal sits in, which is this template's way of stating a class.
 *
 * The code is kept verbatim rather than expanded. `AR` also turns up in front
 * of registration numbers on this site — `*AR30478` — which is exactly why it
 * must not be mistaken for another association's tag the way `MA` and `AN`
 * are: it is a register *inside* the ASA herdbook.
 *
 * **Numbers carry leading flags.** One cow is `*s4219133` on her own page,
 * `*x4157771` in a pedigree, and `4219133` in the URL that reached her. The
 * `*` and the lowercase letters are the registry's note on how the entry is
 * recorded. They are kept as printed, because the number on the screen should
 * match the paper in the drawer — and stripped for comparison, because
 * otherwise she is three different cows.
 *
 * **An ancestor gets a second line**: `Roan, 09/22/1955, LEWIS W. THIEMAN` —
 * colour, date of birth, breeder. On a pedigree that reaches back to 1955 that
 * is the only record of those coats that exists anywhere, and it is half of
 * what the coat-colour prediction needs.
 */

export const SHORTHORN: DigitalBeefBreed = {
  association: "ASA",
  breed: "Shorthorn",
  host: "shorthorn.digitalbeef.com",
  /** `reg  [ tattoo ]  name`, then the colour-and-date line under it. */
  pedigreeLayout: "reg-tattoo-name",

  tattooOf(field: FieldReader): string | undefined {
    return field(["Tattoo", "Tattoo - LE", "Left Ear", "LE"]);
  },

  papersOf(field: FieldReader) {
    const makeup = field(["Genetic Makeup", "Breed Composition"]);
    const composition = makeup === undefined ? [] : parseComposition(makeup);
    if (composition.length > 0) return { composition };

    const share = field(["Shorthorn %"]);
    const stated = share === undefined ? undefined : parseShorthornPercent(share);
    if (stated === undefined) return { composition: [] };

    return {
      // Zero is a real answer, and it is not a share of anything.
      composition:
        stated.percent === 0
          ? []
          : [{ breed: BREED_CODES.shorthorn as string, percent: stated.percent }],
      ...(stated.register === undefined ? {} : { classification: stated.register }),
    };
  },
};
