import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  candidateSlugs,
  clearPlantGrowingCache,
  parseGrowstuffCrop,
  plantGrowing,
  sameSpecies,
  searchGrowstuff,
  type Fetcher,
} from "@/lib/plant-growing";

/**
 * How a picked plant is grown (§5.5), against recorded Growstuff answers.
 *
 * Recorded, as GBIF's are: CI cannot be assumed to reach growstuff.org.
 * `growstuff-search-borage.json` is the real search for "Borago officinalis"
 * (borage first, then a herb garden's worth of neighbours) and
 * `growstuff-borage.json` the borage record, trimmed.
 */

const read = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8")) as unknown;
const BORAGE = read("growstuff-borage.json");
const SEARCH = read("growstuff-search-borage.json");

/** Answers by URL: the search for either term, then each crop record. */
function growstuff(records: Record<string, unknown>): Fetcher & ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    if (url.includes("/crops/search.json")) return new Response(JSON.stringify(SEARCH));
    const slug = /\/crops\/([^/.]+)\.json/.exec(url)?.[1] ?? "";
    const body = records[slug];
    return body === undefined
      ? new Response("{}", { status: 404 })
      : new Response(JSON.stringify(body));
  }) as never;
}

beforeEach(() => clearPlantGrowingCache());

describe("parseGrowstuffCrop", () => {
  it("reads days, spacing in inches, sun, sowing and lifecycle", () => {
    expect(parseGrowstuffCrop(BORAGE)).toEqual({
      daysToMaturity: 33,
      spacingInches: 12,
      lifecycle: "annual",
      sun: "partial",
      sowing: "direct",
    });
  });

  it("reads the free-text sowing method for the words that matter", () => {
    const sowing = (text: string) => parseGrowstuffCrop({ sowing_method: text }).sowing;
    expect(sowing("Direct seed or transplant seedlings")).toBe("either");
    expect(sowing("Direct seed indoors or outside")).toBe("either");
    expect(sowing("Start indoors 6 weeks before last frost")).toBe("transplant");
    expect(sowing("")).toBeUndefined();
  });

  it("drops a days figure too short to be a crop", () => {
    expect(parseGrowstuffCrop({ median_days_to_first_harvest: 2 })).toEqual({});
  });

  it("leaves out what Growstuff does not know", () => {
    expect(parseGrowstuffCrop({ median_days_to_first_harvest: null, perennial: null })).toEqual({});
  });
});

describe("matching the picked plant", () => {
  it("accepts a record only when its scientific name is the one picked", () => {
    expect(sameSpecies(BORAGE, "Borago officinalis", "Borage")).toBe(true);
    expect(sameSpecies(BORAGE, "Salvia rosmarinus", "Rosemary")).toBe(false);
  });

  it("tries a crop named exactly as picked first, then each search's top answer", () => {
    expect(candidateSlugs([SEARCH], "Borage")).toEqual(["borage"]);
    expect(candidateSlugs([[{ slug: "fig", name: "Common Fig" }], SEARCH], "Borage")).toEqual([
      "borage",
      "fig",
    ]);
  });
});

describe("searchGrowstuff", () => {
  it("finds borage's facts and caches them", async () => {
    const fetcher = growstuff({ borage: BORAGE });
    const facts = await searchGrowstuff("Borage", "Borago officinalis", fetcher);
    expect(facts).toMatchObject({ daysToMaturity: 33, sun: "partial" });
    const calls = fetcher.mock.calls.length;
    await searchGrowstuff("Borage", "Borago officinalis", fetcher);
    expect(fetcher.mock.calls.length).toBe(calls);
  });

  it("returns nothing rather than another plant's facts", async () => {
    const fetcher = growstuff({ borage: BORAGE });
    expect(await searchGrowstuff("Lovage", "Levisticum officinale", fetcher)).toEqual({});
  });
});

describe("plantGrowing", () => {
  it("answers a crop the table knows without asking Growstuff", async () => {
    const fetcher = growstuff({});
    const answer = await plantGrowing("Okra", "Abelmoschus esculentus", fetcher);
    expect(answer).toMatchObject({ source: "built-in", growing: { daysToMaturity: 60 } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("asks Growstuff for the rest", async () => {
    const answer = await plantGrowing(
      "Borage",
      "Borago officinalis",
      growstuff({ borage: BORAGE }),
    );
    expect(answer).toMatchObject({ source: "growstuff", online: true });
  });

  it("degrades to nothing when Growstuff is down", async () => {
    const down = vi.fn(async () => new Response("", { status: 503 })) as never;
    expect(await plantGrowing("Borage", "Borago officinalis", down)).toEqual({
      growing: {},
      source: "none",
      online: false,
    });
  });
});

const session = vi.hoisted(() => ({ signedIn: false }));
vi.mock("@/lib/auth", () => ({
  currentActor: async () =>
    session.signedIn
      ? { id: "01ARZ3NDEKTSV4RRFFQ69G5FA1", propertyId: "01ARZ3NDEKTSV4RRFFQ69G5FP1" }
      : undefined,
}));

describe("GET /api/plants/growing", () => {
  it("refuses a request with no session", async () => {
    session.signedIn = false;
    const { GET } = await import("@/app/api/plants/growing/route");
    const response = await GET(new Request("http://farm.test/api/plants/growing?name=Borage"));
    expect(response.status).toBe(401);
  });

  it("answers a known crop from the table, privately cached", async () => {
    session.signedIn = true;
    const { GET } = await import("@/app/api/plants/growing/route");
    const response = await GET(
      new Request(
        "http://farm.test/api/plants/growing?name=Tomato&scientific=Solanum%20lycopersicum",
      ),
    );
    expect(response.headers.get("cache-control")).toContain("private");
    expect(await response.json()).toMatchObject({
      source: "built-in",
      growing: { daysToMaturity: 75, season: "warm" },
    });
  });
});
