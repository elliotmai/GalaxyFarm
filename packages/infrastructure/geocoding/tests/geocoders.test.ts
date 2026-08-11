import { describe, expect, it, vi } from "vitest";

import { censusGeocoder, censusUrl } from "../src/census.js";
import { nominatimGeocoder, nominatimUrl, DEFAULT_USER_AGENT } from "../src/nominatim.js";
import { hardinessZone, normalizeZip } from "../src/hardiness.js";
import { firstMatch } from "../src/index.js";

/**
 * Geocoding (spec §5.1).
 *
 * Nobody knows their own latitude. They know their address, so that is the
 * input, and the coordinates fall out of it — which means these adapters are
 * the only thing standing between a typed address and a forecast for the wrong
 * place.
 */

const ADDRESS = { address: "1220 County Road 4651, Rhome TX 76078" };

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const CENSUS_MATCH = {
  result: {
    addressMatches: [
      {
        matchedAddress: "1220 COUNTY ROAD 4651, RHOME, TX, 76078",
        // x is longitude, y is latitude.
        coordinates: { x: -97.4419, y: 33.0512 },
        addressComponents: { zip: "76078", state: "TX" },
        tigerLine: { tigerLineId: "123", side: "L" },
        geographies: { Counties: [{ NAME: "Wise County" }] },
      },
    ],
  },
};

describe("censusUrl", () => {
  it("asks for the current benchmark rather than a pinned one", () => {
    // So the answer moves with the annual TIGER release instead of being
    // frozen to whatever was newest when this was written.
    const url = new URL(censusUrl(ADDRESS));

    expect(url.searchParams.get("benchmark")).toBe("Public_AR_Current");
    expect(url.searchParams.get("vintage")).toBe("Current_Current");
    expect(url.searchParams.get("address")).toBe(ADDRESS.address);
  });
});

describe("censusGeocoder", () => {
  it("reads x as longitude and y as latitude, not the other way round", async () => {
    // The failure this guards: swapped, this farm is in the Indian Ocean, and
    // the symptom is a forecast that is merely wrong rather than an error.
    const fetch = vi.fn().mockResolvedValue(jsonResponse(CENSUS_MATCH));
    const result = await censusGeocoder({ fetch }).geocode(ADDRESS);

    expect(result?.latitude).toBeCloseTo(33.0512, 4);
    expect(result?.longitude).toBeCloseTo(-97.4419, 4);
  });

  it("carries the normalised address back for confirmation", async () => {
    // A rural route matched to the wrong side of a county line gives a wrong
    // forecast that looks entirely plausible. This string is what gives it away.
    const fetch = vi.fn().mockResolvedValue(jsonResponse(CENSUS_MATCH));
    const result = await censusGeocoder({ fetch }).geocode(ADDRESS);

    expect(result?.matchedAddress).toContain("RHOME");
    expect(result?.county).toBe("Wise County");
    expect(result?.postalCode).toBe("76078");
  });

  it("calls a TIGER match interpolated, not exact", async () => {
    // It is a position along a road segment, and on a long rural segment that
    // is a few hundred yards. Fine for weather, not for a pen boundary.
    const fetch = vi.fn().mockResolvedValue(jsonResponse(CENSUS_MATCH));

    expect((await censusGeocoder({ fetch }).geocode(ADDRESS))?.precision).toBe("interpolated");
  });

  it("returns undefined for no match rather than throwing", async () => {
    // A typo is not an outage, and treating it as one sends somebody looking
    // at a status page instead of at what they typed.
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ result: { addressMatches: [] } }));

    expect(await censusGeocoder({ fetch }).geocode(ADDRESS)).toBeUndefined();
  });

  it("throws when the service itself is down", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({}, 503));

    await expect(censusGeocoder({ fetch }).geocode(ADDRESS)).rejects.toThrow(/503/);
  });

  it("does not call out for an empty address", async () => {
    const fetch = vi.fn();

    expect(await censusGeocoder({ fetch }).geocode({ address: "   " })).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("survives a match with no coordinates at all", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ result: { addressMatches: [{ matchedAddress: "x" }] } }));

    expect(await censusGeocoder({ fetch }).geocode(ADDRESS)).toBeUndefined();
  });
});

describe("nominatimGeocoder", () => {
  const match = [
    {
      lat: "33.0512",
      lon: "-97.4419",
      display_name: "1220, County Road 4651, Wise County, Texas, 76078",
      address: { house_number: "1220", postcode: "76078", county: "Wise County", state: "Texas" },
    },
  ];

  it("identifies itself, as the usage policy requires", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse(match));
    await nominatimGeocoder({ fetch }).geocode(ADDRESS);

    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(DEFAULT_USER_AGENT);
  });

  it("parses the string coordinates it reports", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse(match));
    const result = await nominatimGeocoder({ fetch }).geocode(ADDRESS);

    expect(result?.latitude).toBeCloseTo(33.0512, 4);
    expect(result?.longitude).toBeCloseTo(-97.4419, 4);
    expect(result?.precision).toBe("exact");
  });

  it("treats an unparseable coordinate as a miss, not as NaN", async () => {
    // A NaN here would flow all the way to a forecast request and come back as
    // somewhere off the coast of Africa.
    const fetch = vi.fn().mockResolvedValue(jsonResponse([{ lat: "north", lon: "west" }]));

    expect(await nominatimGeocoder({ fetch }).geocode(ADDRESS)).toBeUndefined();
  });

  it("calls a match with no house number approximate", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse([{ lat: "33", lon: "-97", address: { county: "Wise" } }]));

    expect((await nominatimGeocoder({ fetch }).geocode(ADDRESS))?.precision).toBe("approximate");
  });

  it("asks for one result in the detailed format", () => {
    const url = new URL(nominatimUrl(ADDRESS));

    expect(url.searchParams.get("addressdetails")).toBe("1");
    expect(url.searchParams.get("limit")).toBe("1");
  });
});

describe("firstMatch", () => {
  const found = { name: "found", geocode: vi.fn().mockResolvedValue({ latitude: 1 }) };

  it("takes the first answer and does not ask the rest", async () => {
    const second = { name: "second", geocode: vi.fn() };
    await firstMatch(found, second).geocode(ADDRESS);

    expect(second.geocode).not.toHaveBeenCalled();
  });

  it("falls through when a service is unreachable", async () => {
    const down = { name: "down", geocode: vi.fn().mockRejectedValue(new Error("503")) };
    const result = await firstMatch(down, found).geocode(ADDRESS);

    expect(result).toEqual({ latitude: 1 });
  });

  it("tries the next service when the first found nothing", async () => {
    // The Census geocoder is US-only and built on TIGER, so an address it has
    // never heard of is one OSM may well know. What keeps this honest is that
    // each adapter reports its own precision and the screen shows it.
    const nothing = { name: "nothing", geocode: vi.fn().mockResolvedValue(undefined) };
    const second = { name: "second", geocode: vi.fn().mockResolvedValue({ latitude: 9 }) };

    expect(await firstMatch(nothing, second).geocode(ADDRESS)).toEqual({ latitude: 9 });
  });

  it("reports not-found rather than an error when every service was reached", async () => {
    const nothing = { name: "nothing", geocode: vi.fn().mockResolvedValue(undefined) };

    expect(await firstMatch(nothing, nothing).geocode(ADDRESS)).toBeUndefined();
  });

  it("reports not-found when one service errored but another answered cleanly", async () => {
    // Reached-and-found-nothing beats unreachable: somebody should be told to
    // check what they typed, not to come back later.
    const down = { name: "down", geocode: vi.fn().mockRejectedValue(new Error("boom")) };
    const nothing = { name: "nothing", geocode: vi.fn().mockResolvedValue(undefined) };

    expect(await firstMatch(down, nothing).geocode(ADDRESS)).toBeUndefined();
  });

  it("throws when every service was unreachable", async () => {
    // "We could not reach the geocoder" and "that address is not real" call for
    // completely different things from the person at the screen.
    const down = { name: "down", geocode: vi.fn().mockRejectedValue(new Error("boom")) };

    await expect(firstMatch(down, down).geocode(ADDRESS)).rejects.toThrow(/boom/);
  });
});

describe("normalizeZip", () => {
  it("accepts five digits and trims a ZIP+4", () => {
    expect(normalizeZip("76078")).toBe("76078");
    expect(normalizeZip("76078-1234")).toBe("76078");
    expect(normalizeZip(" 76078 ")).toBe("76078");
  });

  it("refuses anything that is not a ZIP", () => {
    expect(normalizeZip("TX")).toBeUndefined();
    expect(normalizeZip("760")).toBeUndefined();
  });
});

describe("hardinessZone", () => {
  it("returns the zone and the range that makes it mean something", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ zone: "8a", temperature_range: "10 to 15 (F)" }));
    const result = await hardinessZone("76078", { fetch });

    expect(result?.zone).toBe("8a");
    expect(result?.temperatureRange).toBe("10 to 15 (F)");
  });

  it("gives up quietly when the mirror is down", async () => {
    // An address that would not save because a hardiness mirror was
    // unreachable would be worse than a blank zone somebody fills in later.
    const fetch = vi.fn().mockRejectedValue(new Error("network"));

    expect(await hardinessZone("76078", { fetch })).toBeUndefined();
  });

  it("does not call out for something that is not a ZIP", async () => {
    const fetch = vi.fn();

    expect(await hardinessZone("Texas", { fetch })).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});
