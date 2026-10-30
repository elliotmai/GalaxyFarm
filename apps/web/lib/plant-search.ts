import { normaliseFamily, searchGardenCrops } from "@galaxy-farm/module-garden";

/**
 * Plant search for the crop and variety forms (spec §5.5).
 *
 * Two sources, in this order:
 *
 * 1. **The built-in garden table** (`GARDEN_CROPS` in the garden module). It
 *    answers "tomato" with *Solanum lycopersicum* every time, offline, which
 *    the open taxonomy cannot promise — GBIF ranks the tomato fern above the
 *    tomato, because to a taxonomist both are just names containing "tomato".
 * 2. **GBIF's species API** (`api.gbif.org/v1/species/search`), free and
 *    keyless, for everything the table has never heard of: a herb, a cover
 *    crop, a flower somebody grows for the bees. Restricted to accepted
 *    species in the plant kingdom of the GBIF backbone, so viruses named after
 *    tomatoes stay out of the list, then re-ranked so a common name that *is*
 *    the query beats one that merely contains it.
 *
 * Server-side only, behind `/api/plants/search`. The browser never calls GBIF:
 * the answers are cached here for everybody on the property, the request is
 * session-checked like every other route, and a GBIF outage degrades to the
 * built-in answers rather than to an error on a form.
 */

export interface PlantMatch {
  /** The name a gardener uses: "Tomato", "Sweet Basil". */
  readonly commonName: string;
  /** "Solanum lycopersicum" — no authorship, which nobody wants on a seed list. */
  readonly scientificName: string;
  readonly family?: string;
  readonly source: "built-in" | "gbif";
  /** GBIF's species key, for a match that came from there. */
  readonly key?: number;
}

export interface PlantSearchAnswer {
  readonly results: readonly PlantMatch[];
  /** False when GBIF could not be reached: the results are the table's only. */
  readonly online: boolean;
}

/** The GBIF backbone taxonomy — one curated tree, not every checklist ever uploaded. */
const GBIF_BACKBONE = "d7dddbf4-2cf0-4f39-9b2a-bb099caae36c";
/** Plantae in the backbone. */
const PLANTAE = 6;
const GBIF_SEARCH = "https://api.gbif.org/v1/species/search";

/** How long a GBIF answer is reused. A species list does not move in a day. */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_LIMIT = 500;
/** A form is waiting on this; past this the table's answers are enough. */
const GBIF_TIMEOUT_MS = 4000;

export const MAX_RESULTS = 10;

interface GbifResult {
  readonly key?: number;
  readonly canonicalName?: string;
  readonly scientificName?: string;
  readonly family?: string;
  readonly vernacularNames?: ReadonlyArray<{ vernacularName?: string; language?: string }>;
}

function fold(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** "garden tomato" → "Garden tomato". GBIF's vernaculars come in every case. */
function sentenceCase(value: string): string {
  const trimmed = value.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * GBIF's answer, as matches, best first.
 *
 * Exported for the test, which feeds it a recorded response — the container
 * that runs CI cannot be assumed to reach api.gbif.org.
 */
export function parseGbif(body: unknown, query: string): PlantMatch[] {
  const results = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];

  const q = fold(query);
  const scored: Array<{ match: PlantMatch; score: number; index: number }> = [];

  (results as GbifResult[]).forEach((result, index) => {
    const scientificName = result.canonicalName ?? result.scientificName;
    if (scientificName === undefined || scientificName.trim() === "") return;

    const english = (result.vernacularNames ?? [])
      .filter((entry) => entry.language === "eng" && (entry.vernacularName ?? "").trim() !== "")
      .map((entry) => entry.vernacularName as string);

    // The English name closest to what was typed is the one to show: "Okra",
    // not "lady's-fingers", for somebody who typed okra.
    const exact = english.find((name) => fold(name) === q);
    const prefix = english.find((name) => fold(name).startsWith(q));
    const containing = english.find((name) => fold(name).includes(q));
    const commonName = exact ?? prefix ?? containing ?? english[0];

    const score =
      exact !== undefined || fold(scientificName) === q
        ? 3
        : prefix !== undefined || fold(scientificName).startsWith(q)
          ? 2
          : containing !== undefined
            ? 1
            : 0;

    const family = normaliseFamily(result.family);
    scored.push({
      match: {
        commonName: sentenceCase(commonName ?? scientificName),
        scientificName,
        ...(family === undefined ? {} : { family }),
        source: "gbif",
        ...(result.key === undefined ? {} : { key: result.key }),
      },
      score,
      index,
    });
  });

  // Stable on GBIF's own order within a score, which is its relevance.
  return scored
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.match);
}

/** The table's answers, in the same shape. */
export function builtInMatches(query: string): PlantMatch[] {
  return searchGardenCrops(query).map((crop) => ({
    commonName: crop.name,
    scientificName: crop.scientificName,
    family: crop.family,
    source: "built-in" as const,
  }));
}

/**
 * Built-in first, then GBIF, one row per species.
 *
 * A species the table already answered is not repeated from GBIF. The table's
 * own rows are never folded together, though: kale, cabbage and broccoli are
 * all *Brassica oleracea* and are three different crops in a garden.
 */
export function mergeMatches(
  builtIn: readonly PlantMatch[],
  remote: readonly PlantMatch[],
): PlantMatch[] {
  const seen = new Set(builtIn.map((match) => fold(match.scientificName)));
  const merged = [...builtIn];
  for (const match of remote) {
    const key = fold(match.scientificName);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(match);
  }
  return merged.slice(0, MAX_RESULTS);
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

interface CacheEntry {
  readonly at: number;
  readonly results: readonly PlantMatch[];
}

/**
 * One cache per server process, shared by everybody on the property.
 *
 * Insertion-ordered, so trimming from the front drops the oldest question
 * first. Only GBIF's answers are cached: the table is in memory already.
 */
const cache = new Map<string, CacheEntry>();

export function clearPlantSearchCache(): void {
  // crud-guard: allow-unconfirmed — an in-memory cache of GBIF answers, nothing persisted
  cache.clear();
}

export async function searchGbif(
  query: string,
  fetcher: Fetcher = fetch,
  now: number = Date.now(),
): Promise<PlantMatch[]> {
  const key = fold(query);
  const hit = cache.get(key);
  if (hit !== undefined && now - hit.at < CACHE_TTL_MS) return [...hit.results];

  const url = new URL(GBIF_SEARCH);
  url.searchParams.set("q", query.trim());
  url.searchParams.set("rank", "SPECIES");
  url.searchParams.set("status", "ACCEPTED");
  url.searchParams.set("highertaxonKey", String(PLANTAE));
  url.searchParams.set("datasetKey", GBIF_BACKBONE);
  url.searchParams.set("limit", "20");

  const response = await fetcher(url.toString(), {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(GBIF_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`GBIF answered ${response.status}`);

  const results = parseGbif(await response.json(), query);
  // crud-guard: allow-unconfirmed — re-inserting moves the key to the back of the cache
  cache.delete(key);
  cache.set(key, { at: now, results });
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    // crud-guard: allow-unconfirmed — evicting the oldest cached answer, nothing persisted
    cache.delete(oldest);
  }
  return results;
}

/**
 * The whole answer for the route.
 *
 * Never throws: GBIF failing is `online: false` and the table's answers, which
 * is the form still working by hand with a head start.
 */
export async function searchPlants(
  query: string,
  fetcher: Fetcher = fetch,
): Promise<PlantSearchAnswer> {
  const builtIn = builtInMatches(query);
  try {
    const remote = await searchGbif(query, fetcher);
    return { results: mergeMatches(builtIn, remote), online: true };
  } catch (error) {
    console.warn("Plant search fell back to the built-in table", error);
    return { results: builtIn.slice(0, MAX_RESULTS), online: false };
  }
}
