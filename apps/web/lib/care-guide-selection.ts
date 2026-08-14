import type { Contact } from "@galaxy-farm/core";
import type { CareGuide, GuideSectionKind } from "@galaxy-farm/module-housesitting";

/**
 * Pure care-guide selection (spec §5.10) — deliberately its own file, with no
 * import that ever touches Postgres.
 *
 * `sitter-store.ts` needs these too and re-exports them, but it also imports
 * `@galaxy-farm/infra-db`'s `postgres` client at module scope for `sitterView`
 * and `tickChore`. That is fine for a server component or a server action —
 * neither reaches the browser — but the kiosk's Housesitter Mode board is a
 * `"use client"` component, and importing anything at all from a file that
 * pulls in `postgres` drags `net`/`tls`/`fs` into the client bundle with it,
 * which is a webpack build failure, not a runtime one: `pnpm build` never
 * gets far enough to say "this only runs on the device." These three
 * functions have no business anywhere near that import graph, so they live
 * here instead, and the kiosk board imports this file directly rather than
 * `sitter-store.ts`.
 */

/**
 * Which contacts reach the guide.
 *
 * §5.1 says the emergency-tagged subset auto-populates it, and §5.10 asks for
 * vet info beside it. Everything else in the CRM — what a buyer is like to
 * deal with, what the hauler charges — is not care information and does not
 * travel.
 */
export function visibleToSitter(contact: Pick<Contact, "tags">): boolean {
  return contact.tags.includes("emergency") || contact.tags.includes("vet");
}

/**
 * Which guide is shown.
 *
 * The oldest live one, so adding a second guide for a longer trip does not
 * silently move whoever is already reading the first. A retired guide is
 * never served: switching one off is how somebody takes it out of use.
 */
export function guideForSitter(guides: readonly CareGuide[]): CareGuide | undefined {
  return [...guides]
    .filter((guide) => guide.active)
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())[0];
}

/**
 * Is this auto-section on the guide the owner published?
 *
 * A guide with no record at all is treated as including nothing, so a reader
 * arriving before anybody wrote one sees an honest "nothing here yet" rather
 * than a document assembled by default that nobody has read.
 */
export function guideIncludes(guide: CareGuide | undefined, kind: GuideSectionKind): boolean {
  return guide !== undefined && guide.includes.includes(kind);
}
