import { describe, expect, it } from "vitest";

import {
  canRefresh,
  registrationUrl,
  registryCode,
  registryFor,
  splitRegistration,
} from "../src/domain/registries.js";

/**
 * Whose number is it (spec §5.2).
 *
 * The evidence for every case below is a real page. The Chianina page for ZNT
 * MONTEGO BAY prints his sire as `MA364424`; the Maine-Anjou page for the same
 * bull prints the same sire as `364424`. That is one bull with one AMAA number
 * printed two ways, and it is the whole reason this exists.
 */
describe("splitRegistration", () => {
  it("files a prefixed number under the registry that issued it", () => {
    // Read off a Chianina page. The `MA` is Chianina saying "not one of ours".
    expect(splitRegistration("MA364424", "Chianina")).toEqual({
      association: "Maine-Anjou",
      regNumber: "364424",
      foreignTo: "Chianina",
    });
  });

  it("gives the same answer whichever page the number arrived on", () => {
    // The point of the exercise: both of these are AMAA 364424, so the bull is
    // matched with certainty instead of being saved twice.
    const fromChianina = splitRegistration("MA364424", "Chianina");
    const fromMaine = splitRegistration("364424", "Maine-Anjou");

    expect(fromChianina.association).toBe(fromMaine.association);
    expect(fromChianina.regNumber).toBe(fromMaine.regNumber);
  });

  it("strips the registry's own prefix off its own page", () => {
    expect(splitRegistration("MA364424", "Maine-Anjou")).toEqual({
      association: "Maine-Anjou",
      regNumber: "364424",
    });
  });

  it("sends an Angus number to the Angus association, not to Digital Beef", () => {
    expect(splitRegistration("AN13054003", "Maine-Anjou")).toEqual({
      association: "Angus",
      regNumber: "13054003",
      foreignTo: "Maine-Anjou",
    });
  });

  it("leaves a code that is a register rather than an association alone", () => {
    // `AR` on a Shorthorn page is a register inside the ASA herdbook — the same
    // code appears in its `Shorthorn %: AR50` field. Treating it as another
    // association would file a Shorthorn cow under a breed society that does
    // not exist.
    expect(splitRegistration("*AR30478", "Shorthorn")).toEqual({
      association: "Shorthorn",
      regNumber: "*AR30478",
    });
  });

  it("leaves Shorthorn's own leading flags on a plain number", () => {
    expect(splitRegistration("*s4219133", "Shorthorn")).toEqual({
      association: "Shorthorn",
      regNumber: "*s4219133",
    });
  });

  it("does not read a name as a registry code", () => {
    expect(splitRegistration("CMAC TYSON ET", "Chianina")).toEqual({
      association: "Chianina",
      regNumber: "CMAC TYSON ET",
    });
  });
});

describe("registrationUrl", () => {
  it("builds the Angus lookup off the bare number", () => {
    expect(registrationUrl("Angus", "13054003")).toBe(
      "https://www.angus.org/find-an-animal?aid=13054003",
    );
  });

  it("still builds the three Digital Beef addresses", () => {
    expect(registrationUrl("Maine-Anjou", "402303")).toContain("maine-anjou.digitalbeef.com");
    expect(registrationUrl("Chianina", "359968")).toContain("chianina.digitalbeef.com");
    expect(registrationUrl("Shorthorn", "4219133")).toContain("shorthorn.digitalbeef.com");
  });

  it("has nothing to offer for a registry it does not know", () => {
    expect(registrationUrl("other", "12345")).toBeUndefined();
  });

  it("follows the number, not the registry the record is filed under", () => {
    // A record holding `ASA / MA364424` is a Maine-Anjou animal that was read
    // off a Shorthorn page. Asking shorthorn.digitalbeef.com for `MA364424`
    // gets nothing at all — which is what a refresh that "did nothing" was.
    expect(registrationUrl("Shorthorn", "MA364424")).toContain("maine-anjou.digitalbeef.com");
    expect(registrationUrl("Shorthorn", "MA364424")).toContain("animal_registration=364424");
    expect(registrationUrl("Maine-Anjou", "AN13054003")).toBe(
      "https://www.angus.org/find-an-animal?aid=13054003",
    );
  });

  it("works between any two breeds, in either direction", () => {
    // The rule is not about one registry: a number tagged with another breed's
    // code belongs to that breed, and it is that registry's page that gets
    // fetched — the one it was printed on has nothing under that number.
    expect(registrationUrl("Maine-Anjou", "SH4219133")).toContain("shorthorn.digitalbeef.com");
    expect(registrationUrl("Shorthorn", "CA359968")).toContain("chianina.digitalbeef.com");
    expect(registrationUrl("Chianina", "MA402303")).toContain("maine-anjou.digitalbeef.com");
  });

  it("leaves a Shorthorn number filed under Shorthorn alone", () => {
    // `AR` is a register inside the ASA herdbook, not another association.
    expect(registrationUrl("Shorthorn", "*AR30478")).toContain("shorthorn.digitalbeef.com");
  });
});

describe("canRefresh", () => {
  it("is honest about which sites can actually be read", () => {
    // A link worth opening is not the same as a page this app can parse.
    // These four have a reader written against a real saved page; anything
    // else gets a link and an explanation, which beats a spinner that never
    // finds anything.
    expect(canRefresh("Maine-Anjou")).toBe(true);
    expect(canRefresh("Chianina")).toBe(true);
    expect(canRefresh("Shorthorn")).toBe(true);
    expect(canRefresh("Angus")).toBe(true);
    expect(canRefresh("other")).toBe(false);
  });

  it("lets the number overrule the registry it is filed under", () => {
    // Filed under a registry with no reader, but the number names one that
    // has: refreshable, against Maine-Anjou.
    expect(canRefresh("other", "MA364424")).toBe(true);
    expect(canRefresh("other", "12345")).toBe(false);
  });

  it("names the association, so a message can say which site it means", () => {
    expect(registryFor("Angus")?.name).toBe("American Angus Association");
  });
});

/**
 * Registries are named by their breed, not by the association's initials.
 *
 * `ASA` is the American Shorthorn Association on this farm's papers and the
 * American Simmental Association three counties over, and both publish
 * herdbooks with overlapping numbers. Every registry here keeps one breed's
 * book, so the breed names it and cannot collide.
 */
describe("naming a registry", () => {
  it("files under the breed rather than the association's initials", () => {
    expect(registryFor("Shorthorn")?.code).toBe("Shorthorn");
    expect(registryFor("Shorthorn")?.name).toBe("American Shorthorn Association");
  });

  it("still understands a record written under the old initials", () => {
    // These are on file. A reader that stopped recognising them would lose
    // every registration entered before the rename.
    expect(registryCode("AMAA")).toBe("Maine-Anjou");
    expect(registryCode("ACA")).toBe("Chianina");
    expect(registryCode("ASA")).toBe("Shorthorn");
    expect(registryCode("AAA")).toBe("Angus");
  });

  it("does not care how it was typed", () => {
    expect(registryCode(" asa ")).toBe("Shorthorn");
    expect(registryCode("shorthorn")).toBe("Shorthorn");
  });

  it("leaves a registry it has never heard of exactly as it found it", () => {
    // Blanking it would throw away the only thing the record said about where
    // the number came from.
    expect(registryCode("AHA")).toBe("AHA");
    expect(registryCode("other")).toBe("other");
  });

  it("reads a number off an old record's page under the new name", () => {
    // The page's registry arrives spelled `ASA` from a record that has not
    // synced. Compared as written against `Shorthorn`, its own number would
    // look foreign to its own page.
    expect(splitRegistration("SH4219133", "ASA")).toEqual({
      association: "Shorthorn",
      regNumber: "4219133",
    });
  });

  it("finds the right site from an old record's registry", () => {
    expect(registrationUrl("AMAA", "402303")).toContain("maine-anjou.digitalbeef.com");
    expect(canRefresh("AAA", "13054003")).toBe(true);
  });
});
