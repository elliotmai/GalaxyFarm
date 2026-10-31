import { describe, expect, it } from "vitest";

import { REGISTRIES, registryFor } from "../src/domain/registries.js";

describe("registry short names", () => {
  it("names each association by its short name", () => {
    expect(REGISTRIES.map((registry) => [registry.code, registry.shortName])).toEqual([
      ["Maine-Anjou", "MAINE"],
      ["Chianina", "CHI"],
      ["Shorthorn", "SHORT"],
      ["Angus", "ANGUS"],
      ["Simmental", "SIMM"],
    ]);
  });

  it("resolves a short name to its registry, in any case", () => {
    expect(registryFor("MAINE")?.code).toBe("Maine-Anjou");
    expect(registryFor("chi")?.code).toBe("Chianina");
    expect(registryFor("Short")?.code).toBe("Shorthorn");
    expect(registryFor("angus")?.code).toBe("Angus");
    expect(registryFor("SIMM")?.code).toBe("Simmental");
  });

  it("still resolves the old codes, so records written before the rename read the same", () => {
    expect(registryFor("AMAA")?.code).toBe("Maine-Anjou");
    expect(registryFor("ACA")?.code).toBe("Chianina");
    expect(registryFor("ASA")?.code).toBe("Shorthorn");
    expect(registryFor("AAA")?.code).toBe("Angus");
  });

  it("does not link or read a Simmental page, since no address is known for it", () => {
    const simmental = registryFor("SIMM");
    expect(simmental?.readable).toBe(false);
    expect(simmental?.urlFor).toBeUndefined();
  });
});
