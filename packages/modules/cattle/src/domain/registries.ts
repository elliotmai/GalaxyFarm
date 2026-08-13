/**
 * Whose number is this? (spec §5.2)
 *
 * A pedigree prints other registries' animals, and it says which registry each
 * number came from by putting a code in front of it. ZNT MONTEGO BAY's sire is
 * printed `364424` on his Maine-Anjou page and `MA364424` on his Chianina one:
 * the same bull, the same AMAA number, and the `MA` is the Chianina site saying
 * "this is a Maine-Anjou number, not one of ours".
 *
 * Reading that prefix matters for two separate reasons.
 *
 * **It stops the same animal being filed twice.** Import a bull's Maine-Anjou
 * page and his Chianina page and his sire arrives once as `364424` and once as
 * `MA364424`. Compared as written those are different animals, so the importer
 * makes two of him, each holding half his descendants. Split the prefix off and
 * both are AMAA 364424 — one bull, merged with certainty rather than by a
 * guess about names.
 *
 * **It points at the right website.** `AN13054003` on a Maine-Anjou pedigree is
 * an American Angus number, and there is nothing at that number on any Digital
 * Beef site. It is at angus.org, and this is the only thing that knows so.
 *
 * ## Nothing here is guessed
 *
 * A code is in this table only where a real page shows what it means. `AR` is
 * the counterexample and the reason for the rule: a Shorthorn page prints
 * `*AR30478` and `Shorthorn %: AR50`, and `AR` there is a register *inside* the
 * ASA herdbook, not another association. Treating it as one would have filed a
 * Shorthorn cow under a breed society that does not exist. Codes that are not
 * listed are left attached to the number, exactly as printed.
 *
 * The rule generalises in both directions and is applied that way: a number on
 * any breed's page tagged with another breed's code belongs to that other
 * breed, and it is that registry's page that gets fetched — not the one it was
 * printed on, which has nothing filed under that number at all.
 */

import type { Association } from "./cattle-profile.js";

export interface Registry {
  /** The short code this app files registrations under. */
  readonly code: string;
  /** What it is called, spelled out for a screen. */
  readonly name: string;
  /**
   * The prefix a *foreign* page puts in front of one of its numbers.
   *
   * Absent on a registry that is never printed with one.
   */
  readonly prefix?: string | undefined;
  /** The animal's own page, when the address can be built from the number. */
  readonly urlFor?: ((registration: string) => string) | undefined;
  /**
   * Whether this app can read that page.
   *
   * False for a registry whose site is known but whose page layout has never
   * been seen here. A link somebody can click is worth having; a parser
   * written against an imagined page is not, and this codebase has already
   * paid for that mistake once.
   */
  readonly readable: boolean;
}

const digitalBeef = (host: string, registration: string): string =>
  `https://${host}/modules.php?op=modload&name=_animal&file=_animal&animal_registration=${encodeURIComponent(registration)}`;

/**
 * The registries this farm's papers name.
 *
 * The three Digital Beef ones carry prefixes because they print each other's
 * animals. Angus is here because an AMAA pedigree cites Angus numbers and the
 * association publishes a lookup by number.
 */
export const REGISTRIES: readonly Registry[] = [
  {
    code: "AMAA",
    name: "American Maine-Anjou Association",
    prefix: "MA",
    urlFor: (registration) => digitalBeef("maine-anjou.digitalbeef.com", registration),
    readable: true,
  },
  {
    code: "ACA",
    name: "American Chianina Association",
    prefix: "CA",
    urlFor: (registration) => digitalBeef("chianina.digitalbeef.com", registration),
    readable: true,
  },
  {
    code: "ASA",
    name: "American Shorthorn Association",
    prefix: "SH",
    urlFor: (registration) => digitalBeef("shorthorn.digitalbeef.com", registration),
    readable: true,
  },
  {
    code: "AAA",
    name: "American Angus Association",
    prefix: "AN",
    urlFor: (registration) =>
      `https://www.angus.org/find-an-animal?aid=${encodeURIComponent(registration)}`,
    // Not Digital Beef — a different application with a different page, read
    // by `parseAngusPage` against a real saved page from the site.
    readable: true,
  },
];

const BY_CODE = new Map(REGISTRIES.map((registry) => [registry.code, registry]));

export function registryFor(code: string): Registry | undefined {
  return BY_CODE.get(code.trim().toUpperCase());
}

export interface SplitRegistration {
  /** The registry that issued it — the page's own, unless a prefix says otherwise. */
  readonly association: string;
  /** The number without the registry's tag on the front. */
  readonly regNumber: string;
  /** Set when the number was printed on some *other* registry's page. */
  readonly foreignTo?: string | undefined;
}

/**
 * Work out which registry a number printed on a page belongs to.
 *
 * `onPage` is the association whose page it was read from, and it is the
 * answer unless a prefix contradicts it. A prefix naming the page's own
 * registry is stripped anyway — `MA364424` on a Maine-Anjou page is still
 * plain 364424 — because the number has to be stored the same way whichever
 * page it arrived on, or the matching that this exists to fix does not happen.
 */
export function splitRegistration(value: string, onPage: string): SplitRegistration {
  const trimmed = value.trim();
  // The leading flags Shorthorn writes — `*s4219133` — are not part of the
  // number and not a registry code either. Kept off the front so a prefix
  // behind one is still found.
  const bare = trimmed.replace(/^[*\s]+/, "");

  const found = /^([A-Z]{2})(\d[\dA-Za-z-]*)$/.exec(bare);
  const registry =
    found === null ? undefined : REGISTRIES.find((entry) => entry.prefix === found[1]);

  if (found === null || registry === undefined) {
    return { association: onPage, regNumber: trimmed };
  }

  const regNumber = found[2] as string;
  return registry.code === onPage
    ? { association: onPage, regNumber }
    : { association: registry.code, regNumber, foreignTo: onPage };
}

/**
 * The animal's page on whichever registry issued the number.
 *
 * The number decides, not the registry it happens to be filed under here. A
 * record holding `ASA / MA364424` is a Maine-Anjou animal that was read off a
 * Shorthorn page, and asking shorthorn.digitalbeef.com for `MA364424` gets
 * nothing at all — which is what a refresh that "did nothing" looked like.
 */
export function registrationUrl(code: string, registration: string): string | undefined {
  const issued = splitRegistration(registration, code);
  const registry = registryFor(issued.association);
  if (registry?.urlFor === undefined) return undefined;
  return registry.urlFor(issued.regNumber);
}

/**
 * Where a number should really be filed, and where it is filed now.
 *
 * Handed to a screen so it can say "this one is recorded under Shorthorn but
 * the number is Maine-Anjou's" rather than silently doing something else than
 * what is on the row.
 */
export function resolveRegistration(
  code: string,
  registration: string,
): SplitRegistration & { url?: string | undefined } {
  const issued = splitRegistration(registration, code);
  const url = registrationUrl(code, registration);
  return { ...issued, ...(url === undefined ? {} : { url }) };
}

/**
 * Registries whose pages this app can actually read.
 *
 * The refresh offers these. The rest get a link and an explanation, which is
 * the honest answer and better than a spinner that never finds anything.
 */
export const READABLE_REGISTRIES: readonly string[] = REGISTRIES.filter(
  (registry) => registry.readable,
).map((registry) => registry.code);

/**
 * Whether a registration can be refreshed, or only linked to.
 *
 * Takes the number as well as the code, because the number can overrule it: a
 * record filed under Shorthorn whose number is `MA364424` is refreshed against
 * Maine-Anjou, and a record filed under a registry with no reader at all can
 * still be refreshable if its number names one that has.
 */
export function canRefresh(code: string, registration?: string): boolean {
  const issued =
    registration === undefined ? code : splitRegistration(registration, code).association;
  return registryFor(issued)?.readable === true;
}

/** The Digital Beef associations, for a dropdown that has to offer a choice. */
export const isAssociation = (code: string): code is Association =>
  code === "AMAA" || code === "ACA" || code === "ASA" || code === "other";
