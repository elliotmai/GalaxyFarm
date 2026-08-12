import { BREED_CODES, parseComposition, type FieldReader } from "./page.js";
import type { DigitalBeefBreed } from "./digital-beef-breed.js";

/**
 * Chianina — the American Chianina Association (spec §5.2).
 *
 * Digital Beef serves this association, so the machinery is shared. What is
 * here is what makes an ACA page different from the other two, and every line
 * of it was written after reading a real page.
 *
 * **The tattoo is in two pieces.** The template prints a herd prefix and a
 * left-ear number in separate cells and expects a person to read them
 * together. `ZNT` and `901W` is one tattoo, `ZNT901W`, and taking either cell
 * on its own gives half of it.
 *
 * **There are two breed fields and they do not say the same thing.** A page
 * carries `Genetic Makeup: 3.72% CA | 79.57% MA | 14.41% AN | 2.3% XX` *and*
 * `Chianina %: 3.72`. The makeup wins and has to: the percentage field is only
 * the Chianina share, so preferring it would file a bull who is 80%
 * Maine-Anjou as 3.72% Chianina and nothing else.
 *
 * **`Classification` means something else here.** A Chianina page prints `1CM`
 * where a Maine-Anjou page prints `PB`. It is kept as printed and never fed to
 * the AMAA upgrading chart, which takes Maine-Anjou classes and would read
 * `1CM` as nothing at all — or worse, as something.
 *
 * **The pedigree prints other registries' numbers with a tag on the front.**
 * `MA364424` is a Maine-Anjou number, and the same bull is plain `364424` on
 * his own AMAA page. `splitRegistration` unpicks that; without it the importer
 * saved two of him.
 */

/** `reg  name  [ tattoo ]` — the name sits between the number and the tattoo. */
const PEDIGREE_LAYOUT = "reg-name-tattoo";

export const CHIANINA: DigitalBeefBreed = {
  association: "ACA",
  breed: "Chianina",
  host: "chianina.digitalbeef.com",
  pedigreeLayout: PEDIGREE_LAYOUT,

  tattooOf(field: FieldReader): string | undefined {
    const prefix = field(["Herd Prefix/Tattoo", "Herd Prefix"]);
    const ear = field(["Tattoo - LE", "Left Ear", "LE", "Tattoo"]);
    if (prefix === undefined) return ear;
    if (ear === undefined) return prefix;
    // Joined unless the ear cell already repeats the prefix, which some
    // records do — `ZNT` + `ZNT901W` is `ZNT901W`, not `ZNTZNT901W`.
    return ear.toUpperCase().startsWith(prefix.toUpperCase()) ? ear : `${prefix}${ear}`;
  },

  papersOf(field: FieldReader) {
    const makeup = field(["Genetic Makeup", "Breed Composition"]);
    const share = field(["Chianina %"]);
    const classification = field(["Classification"]);

    const composition = makeup === undefined ? [] : parseComposition(makeup);
    if (composition.length > 0) {
      return {
        composition,
        ...(classification === undefined ? {} : { classification }),
      };
    }

    // No makeup printed — fall back to the single share, which is at least the
    // Chianina half of the answer.
    const percent = share === undefined ? Number.NaN : Number.parseFloat(share);
    return {
      composition:
        Number.isFinite(percent) && percent > 0
          ? [{ breed: BREED_CODES.chianina as string, percent }]
          : [],
      ...(classification === undefined ? {} : { classification }),
    };
  },
};
