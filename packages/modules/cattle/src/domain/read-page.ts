import { parseAngusPage, parseAngusUrl } from "./angus.js";
import { parseDigitalBeefPage, parseDigitalBeefUrl, type ImportedAnimal } from "./digital-beef.js";

/**
 * One door onto every association this app can read (spec §5.2).
 *
 * There are two readers — Digital Beef serves three associations from one
 * application, Angus is its own — and four screens that need to not care which
 * one a URL belongs to. Without this each of them grows the same two-branch
 * conditional, and the day a fifth registry arrives one of them is missed. The
 * screen asks "read this page"; which parser answers is not its business.
 */

export interface PageRef {
  readonly url: string;
  readonly host: string;
  readonly association: string;
  readonly registration: string;
}

/** Work out which association an address belongs to, or say why not. */
export function parseAnimalUrl(
  input: string,
): { ok: true; ref: PageRef } | { ok: false; reason: string } {
  const angus = parseAngusUrl(input);
  if (angus.ok) {
    return {
      ok: true,
      ref: { ...angus.ref, host: new URL(angus.ref.url).hostname },
    };
  }

  const digitalBeef = parseDigitalBeefUrl(input);
  if (digitalBeef.ok) return { ok: true, ref: digitalBeef.ref };

  // Digital Beef's refusal is the more useful of the two: it names the three
  // sites this farm registers with. The Angus one only says "that is not
  // angus.org", which is no help to somebody who pasted a Hereford page.
  return digitalBeef;
}

/** Read a page with whichever parser its association calls for. */
export function parseAnimalPage(html: string, ref: PageRef): ImportedAnimal {
  return ref.association === "AAA"
    ? parseAngusPage(html, { registration: ref.registration, url: ref.url })
    : parseDigitalBeefPage(html, ref as never);
}
