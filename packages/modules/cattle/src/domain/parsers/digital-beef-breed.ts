import type { FieldReader } from "./page.js";

/**
 * What one association's Digital Beef template does differently.
 *
 * Three associations, one application, three templates — and the differences
 * are not cosmetic. Rather than a parser full of conditionals asking "is this
 * the Shorthorn one", each breed states its own facts in its own file and the
 * engine reads them. Adding a fourth association is then a new file, not a
 * fourth branch in six functions.
 *
 * The two hooks are the two places the templates genuinely disagree about
 * *meaning* rather than spelling. Everything else — labels, layouts, defect
 * flags — the engine handles by trying every form it has ever seen, because a
 * reader that insists on one spelling breaks the day a template is edited and
 * a reader that accepts several does not.
 */
export interface DigitalBeefBreed {
  /** The code this app files registrations under. */
  readonly association: string;
  /** The breed, spelled out. */
  readonly breed: string;
  readonly host: string;
  /**
   * How this template lays a pedigree line out.
   *
   * Documentation rather than instruction: the entry parser works out which
   * form it is looking at from where the tattoo bracket falls, which survives
   * a template that changes its mind. Recorded here because it is the first
   * thing anybody debugging a bad pedigree wants to know.
   */
  readonly pedigreeLayout: "reg-tattoo-name" | "reg-name-tattoo";

  /**
   * The animal's tattoo, however this template chooses to record one.
   *
   * No two of the three agree. Chianina splits it into a herd prefix and a
   * left-ear number; Maine-Anjou prints a left and a right ear and leaves one
   * blank; Shorthorn prints one field.
   */
  tattooOf(field: FieldReader): string | undefined;

  /**
   * The breed makeup and the class the papers state.
   *
   * The single most divergent read on the page. Chianina prints a full
   * multi-breed makeup, Shorthorn prints one number with a register code
   * glued to the front of it, and Maine-Anjou prints no makeup at all and a
   * classification instead.
   */
  papersOf(field: FieldReader): {
    readonly composition: readonly { breed: string; percent: number }[];
    readonly classification?: string | undefined;
  };
}
