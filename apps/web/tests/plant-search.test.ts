import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CACHE_TTL_MS,
  builtInMatches,
  clearPlantSearchCache,
  mergeMatches,
  parseGbif,
  searchGbif,
  searchPlants,
  type Fetcher,
} from "@/lib/plant-search";

/**
 * Plant search (§5.5) against a recorded GBIF answer.
 *
 * Recorded rather than live: CI cannot be assumed to reach api.gbif.org, and a
 * test that passes only when somebody else's server is up is a test that gets
 * skipped. `fixtures/gbif-okra.json` is a trimmed real response for "okra".
 */

const OKRA = JSON.parse(
  readFileSync(join(__dirname, "fixtures/gbif-okra.json"), "utf8"),
) as unknown;

function answering(body: unknown, status = 200): Fetcher & ReturnType<typeof vi.fn> {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as never;
}

beforeEach(() => clearPlantSearchCache());

describe("parseGbif", () => {
  it("puts the species whose common name is the query first, with its family", () => {
    const matches = parseGbif(OKRA, "okra");
    expect(matches[0]).toMatchObject({
      commonName: "Okra",
      scientificName: "Abelmoschus esculentus",
      family: "Malvaceae",
      source: "gbif",
    });
  });

  it("names a species by the English name nearest the query", () => {
    const wild = parseGbif(OKRA, "okra").find((m) => m.scientificName === "Malachra alceifolia");
    expect(wild?.commonName).toBe("Wild okra");
  });

  it("falls back to the scientific name when there is no English one", () => {
    const hairy = parseGbif(OKRA, "okra").find((m) => m.scientificName === "Abelmoschus crinitus");
    expect(hairy?.commonName).toBe("Abelmoschus crinitus");
  });

  it("tolerates a body that is not a search answer", () => {
    expect(parseGbif(null, "okra")).toEqual([]);
    expect(parseGbif({ results: "nope" }, "okra")).toEqual([]);
  });
});

describe("mergeMatches", () => {
  it("leads with the built-in table and drops GBIF's copy of the same species", () => {
    const merged = mergeMatches(builtInMatches("okra"), parseGbif(OKRA, "okra"));
    expect(merged[0]).toMatchObject({ commonName: "Okra", source: "built-in" });
    expect(merged.filter((m) => m.scientificName === "Abelmoschus esculentus")).toHaveLength(1);
    expect(merged.length).toBeLessThanOrEqual(10);
  });
});

describe("searchGbif", () => {
  it("asks for accepted plant species in the backbone", async () => {
    const fetcher = answering(OKRA);
    await searchGbif("okra", fetcher);
    const url = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(url.host).toBe("api.gbif.org");
    expect(url.searchParams.get("q")).toBe("okra");
    expect(url.searchParams.get("rank")).toBe("SPECIES");
    expect(url.searchParams.get("highertaxonKey")).toBe("6");
    expect(url.searchParams.get("status")).toBe("ACCEPTED");
  });

  it("answers a repeated question from the cache until it goes stale", async () => {
    const fetcher = answering(OKRA);
    await searchGbif("okra", fetcher, 1_000);
    await searchGbif("Okra ", fetcher, 2_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await searchGbif("okra", fetcher, 1_000 + CACHE_TTL_MS + 1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("searchPlants", () => {
  it("fails soft to the built-in table when GBIF is unreachable", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const answer = await searchPlants("tomato", fetcher);
    expect(answer.online).toBe(false);
    expect(answer.results[0]).toMatchObject({ commonName: "Tomato", family: "Solanaceae" });
    warn.mockRestore();
  });

  it("treats a GBIF error status as offline, not as no plants", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const answer = await searchPlants("okra", answering({}, 503));
    expect(answer.online).toBe(false);
    expect(answer.results[0]?.commonName).toBe("Okra");
    warn.mockRestore();
  });

  it("merges both sources when GBIF answers", async () => {
    const answer = await searchPlants("okra", answering(OKRA));
    expect(answer.online).toBe(true);
    expect(answer.results.map((m) => m.source)).toContain("gbif");
  });
});

const session = vi.hoisted(() => ({ signedIn: false }));
vi.mock("@/lib/auth", () => ({
  currentActor: async () =>
    session.signedIn
      ? { id: "01ARZ3NDEKTSV4RRFFQ69G5FA1", propertyId: "01ARZ3NDEKTSV4RRFFQ69G5FP1" }
      : undefined,
}));

describe("GET /api/plants/search", () => {
  it("refuses a request with no session", async () => {
    session.signedIn = false;
    const { GET } = await import("@/app/api/plants/search/route");
    const response = await GET(new Request("http://farm.test/api/plants/search?q=okra"));
    expect(response.status).toBe(401);
  });

  it("answers a too-short query with nothing, without asking GBIF", async () => {
    session.signedIn = true;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { GET } = await import("@/app/api/plants/search/route");
    const response = await GET(new Request("http://farm.test/api/plants/search?q=o"));
    expect(await response.json()).toEqual({ results: [], online: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("answers from GBIF through the server, cached privately", async () => {
    session.signedIn = true;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(JSON.stringify(OKRA)));
    const { GET } = await import("@/app/api/plants/search/route");
    const response = await GET(new Request("http://farm.test/api/plants/search?q=okra"));
    const body = (await response.json()) as { results: { commonName: string }[]; online: boolean };
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(body.online).toBe(true);
    expect(body.results[0]?.commonName).toBe("Okra");
    fetchSpy.mockRestore();
  });
});
