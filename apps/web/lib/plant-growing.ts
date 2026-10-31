import { growingFor, isEmptyGrowing, type GrowingFacts } from "@galaxy-farm/module-garden";

/**
 * How a picked plant is grown, for the crop and variety forms (spec §5.5).
 *
 * The plant search answers *what* a plant is (name, scientific name, family);
 * this answers how to grow it. In order:
 *
 * 1. **The built-in table** (`growingFor` in the garden module), for every
 *    crop the family table knows. Offline and instant; the browser reads it
 *    directly and never asks here for those.
 * 2. **Growstuff** (`growstuff.org`, open data, keyless), for the rest — the
 *    herb, the flower for the bees. Searched on the scientific name and the
 *    common name, and a candidate is taken only when its own scientific name
 *    is the one picked, so "borage" never comes back as rosemary because the
 *    search ranked a herb garden's neighbours together.
 *
 * Server-side only, behind `/api/plants/growing`, cached for everybody, and
 * never an error on a form: no answer is `{}` and the fields stay as typed.
 */

const GROWSTUFF = "https://www.growstuff.org";
/** A form is waiting on this. */
const TIMEOUT_MS = 4000;
/**
 * Fewer days than this is a crowd figure gone wrong (comfrey "2 days"), not a
 * crop: the quickest thing in the built-in table, radish, takes 25.
 */
const MIN_DAYS = 14;
/** Candidates fetched in full per lookup — each is one request. */
const MAX_CANDIDATES = 3;

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_LIMIT = 500;

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

interface GrowstuffCrop {
  readonly name?: string;
  readonly slug?: string;
  readonly perennial?: boolean | null;
  readonly median_days_to_first_harvest?: number | null;
  readonly row_spacing?: number | null;
  readonly sowing_method?: string | null;
  readonly sun_requirements?: string | null;
  readonly scientific_names?: ReadonlyArray<{ name?: string }> | null;
}

function fold(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Centimetres to the nearest inch — a spacing, not a measurement. */
function inches(cm: number): number {
  return Math.max(1, Math.round(cm / 2.54));
}

/** "Full Sun" / "Partial Sun" / "Shade" → the form's three. */
function sunFrom(text: string | null | undefined): GrowingFacts["sun"] {
  const folded = fold(text ?? undefined);
  if (folded === "") return undefined;
  if (folded.includes("shade") && !folded.includes("partial")) return "shade";
  if (folded.includes("partial") || folded.includes("part ")) return "partial";
  if (folded.includes("full")) return "full";
  return undefined;
}

/**
 * Growstuff's sowing method is free text ("Direct seed outdoors, thin to
 * 45cm…", "Direct seed or transplant seedlings"); read it for the two words
 * that matter.
 */
function sowingFrom(text: string | null | undefined): GrowingFacts["sowing"] {
  const folded = fold(text ?? undefined);
  if (folded === "") return undefined;
  const direct = folded.includes("direct");
  const transplant = folded.includes("transplant") || folded.includes("indoors");
  // "Direct seed indoors or outside" is okra's: either works.
  if (direct && transplant) return "either";
  if (transplant) return "transplant";
  if (direct) return "direct";
  return undefined;
}

/**
 * One Growstuff crop as growing facts. Exported for the test, which feeds it
 * a recorded response.
 */
export function parseGrowstuffCrop(body: unknown): GrowingFacts {
  const crop = (body ?? {}) as GrowstuffCrop;
  const days = crop.median_days_to_first_harvest;
  const spacing = crop.row_spacing;
  const sun = sunFrom(crop.sun_requirements);
  const sowing = sowingFrom(crop.sowing_method);
  return {
    ...(typeof days === "number" && days >= MIN_DAYS ? { daysToMaturity: Math.round(days) } : {}),
    ...(typeof spacing === "number" && spacing > 0 ? { spacingInches: inches(spacing) } : {}),
    ...(typeof crop.perennial === "boolean"
      ? { lifecycle: crop.perennial ? ("perennial" as const) : ("annual" as const) }
      : {}),
    ...(sun === undefined ? {} : { sun }),
    ...(sowing === undefined ? {} : { sowing }),
  };
}

/** Whether a Growstuff crop is the plant that was picked. */
export function sameSpecies(body: unknown, scientificName: string, commonName: string): boolean {
  const crop = (body ?? {}) as GrowstuffCrop;
  const names = (crop.scientific_names ?? []).map((entry) => fold(entry.name));
  const wanted = fold(scientificName);
  if (wanted !== "" && names.length > 0) return names.includes(wanted);
  // No scientific name on either side: only an exact common name will do.
  return wanted === "" && names.length === 0 && fold(crop.name) === fold(commonName);
}

/** Slugs worth fetching, best first, from the search answers. */
export function candidateSlugs(answers: ReadonlyArray<unknown>, commonName: string): string[] {
  const common = fold(commonName);
  const all = answers.flatMap((answer) =>
    Array.isArray(answer) ? (answer as ReadonlyArray<GrowstuffCrop>) : [],
  );
  const slugs: string[] = [];
  const add = (crop: GrowstuffCrop) => {
    if (crop.slug !== undefined && !slugs.includes(crop.slug)) slugs.push(crop.slug);
  };
  // A crop named exactly what was picked first, then each search's own order.
  all.filter((crop) => fold(crop.name) === common).forEach(add);
  for (const answer of answers) {
    if (!Array.isArray(answer)) continue;
    const first = (answer as ReadonlyArray<GrowstuffCrop>)[0];
    if (first !== undefined) add(first);
  }
  return slugs.slice(0, MAX_CANDIDATES);
}

const cache = new Map<string, { readonly at: number; readonly facts: GrowingFacts }>();

export function clearPlantGrowingCache(): void {
  // crud-guard: allow-unconfirmed — an in-memory cache of Growstuff answers, nothing persisted
  cache.clear();
}

async function getJson(url: string, fetcher: Fetcher): Promise<unknown> {
  const response = await fetcher(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Growstuff answered ${response.status}`);
  return response.json();
}

export async function searchGrowstuff(
  commonName: string,
  scientificName: string,
  fetcher: Fetcher = fetch,
  now: number = Date.now(),
): Promise<GrowingFacts> {
  const key = `${fold(scientificName)}|${fold(commonName)}`;
  const hit = cache.get(key);
  if (hit !== undefined && now - hit.at < CACHE_TTL_MS) return hit.facts;

  const terms = [scientificName, commonName].map((term) => term.trim()).filter(Boolean);
  const answers = await Promise.all(
    [...new Set(terms)].map((term) =>
      getJson(`${GROWSTUFF}/crops/search.json?term=${encodeURIComponent(term)}`, fetcher),
    ),
  );

  let facts: GrowingFacts = {};
  for (const slug of candidateSlugs(answers, commonName)) {
    // One record missing (renamed, removed) is that candidate out, not the
    // lookup failed: the search already showed Growstuff is up.
    const body = await getJson(
      `${GROWSTUFF}/crops/${encodeURIComponent(slug)}.json`,
      fetcher,
    ).catch(() => undefined);
    if (body !== undefined && sameSpecies(body, scientificName, commonName)) {
      facts = parseGrowstuffCrop(body);
      break;
    }
  }

  // crud-guard: allow-unconfirmed — re-inserting moves the key to the back of the cache
  cache.delete(key);
  cache.set(key, { at: now, facts });
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    // crud-guard: allow-unconfirmed — evicting the oldest cached answer, nothing persisted
    cache.delete(oldest);
  }
  return facts;
}

export interface PlantGrowingAnswer {
  readonly growing: GrowingFacts;
  readonly source: "built-in" | "growstuff" | "none";
  /** False when Growstuff could not be reached. */
  readonly online: boolean;
}

/** The whole answer for the route. Never throws. */
export async function plantGrowing(
  commonName: string,
  scientificName: string,
  fetcher: Fetcher = fetch,
): Promise<PlantGrowingAnswer> {
  const builtIn = growingFor(commonName);
  if (builtIn !== undefined) return { growing: builtIn, source: "built-in", online: true };
  try {
    const growing = await searchGrowstuff(commonName, scientificName, fetcher);
    return {
      growing,
      source: isEmptyGrowing(growing) ? "none" : "growstuff",
      online: true,
    };
  } catch (error) {
    console.warn("Growing facts unavailable", error);
    return { growing: {}, source: "none", online: false };
  }
}
