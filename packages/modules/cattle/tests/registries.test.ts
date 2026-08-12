import { describe, expect, it } from "vitest";

import {
  canRefresh,
  registrationUrl,
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
    expect(splitRegistration("MA364424", "ACA")).toEqual({
      association: "AMAA",
      regNumber: "364424",
      foreignTo: "ACA",
    });
  });

  it("gives the same answer whichever page the number arrived on", () => {
    // The point of the exercise: both of these are AMAA 364424, so the bull is
    // matched with certainty instead of being saved twice.
    const fromChianina = splitRegistration("MA364424", "ACA");
    const fromMaine = splitRegistration("364424", "AMAA");

    expect(fromChianina.association).toBe(fromMaine.association);
    expect(fromChianina.regNumber).toBe(fromMaine.regNumber);
  });

  it("strips the registry's own prefix off its own page", () => {
    expect(splitRegistration("MA364424", "AMAA")).toEqual({
      association: "AMAA",
      regNumber: "364424",
    });
  });

  it("sends an Angus number to the Angus association, not to Digital Beef", () => {
    expect(splitRegistration("AN13054003", "AMAA")).toEqual({
      association: "AAA",
      regNumber: "13054003",
      foreignTo: "AMAA",
    });
  });

  it("leaves a code that is a register rather than an association alone", () => {
    // `AR` on a Shorthorn page is a register inside the ASA herdbook — the same
    // code appears in its `Shorthorn %: AR50` field. Treating it as another
    // association would file a Shorthorn cow under a breed society that does
    // not exist.
    expect(splitRegistration("*AR30478", "ASA")).toEqual({
      association: "ASA",
      regNumber: "*AR30478",
    });
  });

  it("leaves Shorthorn's own leading flags on a plain number", () => {
    expect(splitRegistration("*s4219133", "ASA")).toEqual({
      association: "ASA",
      regNumber: "*s4219133",
    });
  });

  it("does not read a name as a registry code", () => {
    expect(splitRegistration("CMAC TYSON ET", "ACA")).toEqual({
      association: "ACA",
      regNumber: "CMAC TYSON ET",
    });
  });
});

describe("registrationUrl", () => {
  it("builds the Angus lookup off the bare number", () => {
    expect(registrationUrl("AAA", "13054003")).toBe(
      "https://www.angus.org/find-an-animal?aid=13054003",
    );
  });

  it("still builds the three Digital Beef addresses", () => {
    expect(registrationUrl("AMAA", "402303")).toContain("maine-anjou.digitalbeef.com");
    expect(registrationUrl("ACA", "359968")).toContain("chianina.digitalbeef.com");
    expect(registrationUrl("ASA", "4219133")).toContain("shorthorn.digitalbeef.com");
  });

  it("has nothing to offer for a registry it does not know", () => {
    expect(registrationUrl("other", "12345")).toBeUndefined();
  });

  it("follows the number, not the registry the record is filed under", () => {
    // A record holding `ASA / MA364424` is a Maine-Anjou animal that was read
    // off a Shorthorn page. Asking shorthorn.digitalbeef.com for `MA364424`
    // gets nothing at all — which is what a refresh that "did nothing" was.
    expect(registrationUrl("ASA", "MA364424")).toContain("maine-anjou.digitalbeef.com");
    expect(registrationUrl("ASA", "MA364424")).toContain("animal_registration=364424");
    expect(registrationUrl("AMAA", "AN13054003")).toBe(
      "https://www.angus.org/find-an-animal?aid=13054003",
    );
  });

  it("works between any two breeds, in either direction", () => {
    // The rule is not about one registry: a number tagged with another breed's
    // code belongs to that breed, and it is that registry's page that gets
    // fetched — the one it was printed on has nothing under that number.
    expect(registrationUrl("AMAA", "SH4219133")).toContain("shorthorn.digitalbeef.com");
    expect(registrationUrl("ASA", "CA359968")).toContain("chianina.digitalbeef.com");
    expect(registrationUrl("ACA", "MA402303")).toContain("maine-anjou.digitalbeef.com");
  });

  it("leaves a Shorthorn number filed under Shorthorn alone", () => {
    // `AR` is a register inside the ASA herdbook, not another association.
    expect(registrationUrl("ASA", "*AR30478")).toContain("shorthorn.digitalbeef.com");
  });
});

describe("canRefresh", () => {
  it("is honest about which sites can actually be read", () => {
    // A link worth opening is not the same as a page this app can parse.
    // These four have a reader written against a real saved page; anything
    // else gets a link and an explanation, which beats a spinner that never
    // finds anything.
    expect(canRefresh("AMAA")).toBe(true);
    expect(canRefresh("ACA")).toBe(true);
    expect(canRefresh("ASA")).toBe(true);
    expect(canRefresh("AAA")).toBe(true);
    expect(canRefresh("other")).toBe(false);
  });

  it("lets the number overrule the registry it is filed under", () => {
    // Filed under a registry with no reader, but the number names one that
    // has: refreshable, against Maine-Anjou.
    expect(canRefresh("other", "MA364424")).toBe(true);
    expect(canRefresh("other", "12345")).toBe(false);
  });

  it("names the association, so a message can say which site it means", () => {
    expect(registryFor("AAA")?.name).toBe("American Angus Association");
  });
});
