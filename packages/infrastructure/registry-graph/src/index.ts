import {
  MAX_CATALOGUE_GENERATIONS,
  registryCode,
  type RegistryAnimal,
  type RegistryGraph,
  type RegistryQuery,
} from "@galaxy-farm/module-cattle";

/**
 * The crawled association graph, in Neo4j (spec §4.1, §5.2).
 *
 * The crawler builds one `(:Animal)` per real animal, deduplicated across
 * registries on its International ID, with a `(:Registration)` per association
 * hanging off it. That shape is why this is a graph and not a table: the same
 * bull appears in a Maine-Anjou pedigree and a Chianina one under different
 * numbers, and collapsing him onto one node is the thing that makes "walk five
 * generations up" a single query instead of thirty round trips.
 *
 * ## Over HTTP rather than the Bolt driver
 *
 * Aura serves a Query API over HTTPS, so this is `fetch` and nothing else — no
 * driver dependency, no connection pool to manage inside a serverless
 * function, and a `fetch` that can be handed in, which is what lets every
 * query below be tested against recorded responses with no network and no
 * database. The Resend adapter is built the same way for the same reasons.
 *
 * ## Credentials
 *
 * Passed in, never read from the environment here. The composition root owns
 * that (§4.1), and an adapter that reaches for `process.env` is one that
 * cannot be tested twice with two different instances.
 *
 * ## The two names for one registry
 *
 * The graph abbreviates associations — `MAINE`, `CHIA`, `SHORT`, `ANGUS` — and
 * this app names them by their breed, because association initials collide
 * (`ASA` is Shorthorn here and Simmental elsewhere) and a breed does not.
 * Translating at the boundary keeps one vocabulary in the field and one in the
 * crawler, so neither has to be rebuilt to suit the other.
 *
 * The crawler's own abbreviations are not immune to the same collision, which
 * is the reason this map is written out by hand rather than derived: `SHORT`
 * means the American Shorthorn Association *in this graph*, and that is a fact
 * about the crawl, not something to infer from a string.
 */

/** Graph code → the breed this app files that registry's numbers under. */
const TO_OURS: Record<string, string> = {
  MAINE: "Maine-Anjou",
  CHIA: "Chianina",
  SHORT: "Shorthorn",
  ANGUS: "Angus",
};

const TO_GRAPH: Record<string, string> = Object.fromEntries(
  Object.entries(TO_OURS).map(([graph, ours]) => [ours, graph]),
);

/**
 * Ours → the graph's. Anything unrecognised is passed through untranslated.
 *
 * Through `registryCode` first, so a filter carrying a registration's stored
 * spelling still translates when that record predates the rename.
 */
export const graphAssociation = (code: string): string =>
  TO_GRAPH[registryCode(code)] ?? code;
export const ourAssociation = (code: string): string => TO_OURS[code] ?? code;

export interface RegistryGraphOptions {
  /** `neo4j+s://x.databases.neo4j.io` or the https form. Either is accepted. */
  readonly url: string;
  readonly username: string;
  readonly password: string;
  /** Aura names the database after the instance; it is not always `neo4j`. */
  readonly database: string;
  readonly fetch?: typeof globalThis.fetch;
  /** Long enough for a five-generation walk, short enough not to hang a page. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** A page of results. Enough to choose from, small enough to read. */
const DEFAULT_LIMIT = 25;

/**
 * `neo4j+s://host` is a Bolt address; the Query API is plain HTTPS on the same
 * host. Accepting either means nobody has to know that to paste a connection
 * string in.
 */
function queryEndpoint(url: string, database: string): string {
  const host = url.trim().replace(/^(neo4j(\+s|\+ssc)?|bolt(\+s|\+ssc)?):\/\//, "");
  const bare = host.replace(/\/+$/, "").replace(/:\d+$/, "");
  return `https://${bare}/db/${encodeURIComponent(database)}/query/v2`;
}

interface QueryResult {
  readonly data?: { fields: string[]; values: unknown[][] };
  readonly errors?: { message: string; code?: string }[];
}

/** One row, as a record keyed by the names the query returned. */
type Row = Record<string, unknown>;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** The graph stores `M`/`F`; every screen here says male and female. */
const asSex = (value: unknown): "male" | "female" | undefined => {
  const found = asString(value)?.toUpperCase();
  return found === "M" ? "male" : found === "F" ? "female" : undefined;
};

/**
 * `F` is free, `C` is a carrier.
 *
 * Anything else lands as `suspect` rather than being dropped or rounded down —
 * the same rule the page parsers follow, and for the same reason: on a place
 * whose house rule is that no carrier comes onto it, a code nobody recognised
 * must never read as "fine".
 */
const asDefectStatus = (value: unknown): "free" | "carrier" | "suspect" => {
  const found = asString(value)?.toUpperCase();
  return found === "F" ? "free" : found === "C" ? "carrier" : "suspect";
};

function toAnimal(row: Row): RegistryAnimal | undefined {
  const animal = row["animal"] as Record<string, unknown> | undefined;
  const association = asString(row["association"]);
  const regNumber = asString(row["regNumber"]);
  if (animal === undefined || association === undefined || regNumber === undefined)
    return undefined;

  const registrations = ((row["registrations"] as Row[] | undefined) ?? [])
    .map((entry) => ({
      association: ourAssociation(asString(entry["association"]) ?? ""),
      regNumber: asString(entry["regNumber"]) ?? "",
    }))
    .filter((entry) => entry.association !== "" && entry.regNumber !== "");

  const breedComposition = ((row["composition"] as Row[] | undefined) ?? [])
    .map((entry) => ({
      breed: asString(entry["breed"]) ?? "",
      percent: asNumber(entry["percent"]) ?? 0,
    }))
    .filter((entry) => entry.breed !== "");

  const geneticTests = ((row["defects"] as Row[] | undefined) ?? [])
    .map((entry) => ({
      defect: asString(entry["defect"]) ?? "",
      status: asDefectStatus(entry["status"]),
      notes: "From the association crawl",
    }))
    .filter((entry) => entry.defect !== "");

  const parent = (key: string) => {
    const found = row[key] as Row | undefined;
    if (found === undefined) return undefined;
    const parentAssociation = asString(found["association"]);
    const parentReg = asString(found["regNumber"]);
    if (parentAssociation === undefined || parentReg === undefined) return undefined;
    return { association: ourAssociation(parentAssociation), regNumber: parentReg };
  };

  const dob = asString(animal["dob"]);

  return {
    association: ourAssociation(association),
    regNumber,
    name: asString(animal["name"]) ?? `${ourAssociation(association)} ${regNumber}`,
    ...(registrations.length === 0 ? {} : { registrations }),
    ...(asString(animal["tattoo"]) === undefined ? {} : { tattoo: asString(animal["tattoo"]) }),
    ...(asSex(animal["sex"]) === undefined ? {} : { sex: asSex(animal["sex"]) }),
    ...(dob === undefined || Number.isNaN(new Date(dob).getTime()) ? {} : { dob: new Date(dob) }),
    ...(asString(animal["color"]) === undefined ? {} : { colour: asString(animal["color"]) }),
    ...(asString(animal["horn_status"]) === undefined
      ? {}
      : { hornStatus: asString(animal["horn_status"]) }),
    ...(breedComposition.length === 0 ? {} : { breedComposition }),
    ...(geneticTests.length === 0 ? {} : { geneticTests }),
    ...(parent("sire") === undefined ? {} : { sire: parent("sire") }),
    ...(parent("dam") === undefined ? {} : { dam: parent("dam") }),
  } as RegistryAnimal;
}

/**
 * Everything about one animal, gathered in a single query.
 *
 * Written once and shared by all three calls, because a search that returned
 * less than a lookup would mean the row somebody clicked changed shape under
 * them.
 */
const RETURN_ANIMAL = `
  a { .* } AS animal,
  reg.association AS association,
  reg.regNumber AS regNumber,
  [(a)-[:HAS_REGISTRATION]->(other:Registration) |
    { association: other.association, regNumber: other.regNumber }] AS registrations,
  [(a)-[c:HAS_COMPOSITION]->(b:Breed) | { breed: b.code, percent: c.percent }] AS composition,
  [(a)-[t:TESTED]->(x:Defect) | { defect: x.code, status: t.status }] AS defects,
  head([(s:Animal)-[:SIRE_OF]->(a) |
    head([(s)-[:HAS_REGISTRATION]->(sr:Registration) |
      { association: sr.association, regNumber: sr.regNumber }])]) AS sire,
  head([(d:Animal)-[:DAM_OF]->(a) |
    head([(d)-[:HAS_REGISTRATION]->(dr:Registration) |
      { association: dr.association, regNumber: dr.regNumber }])]) AS dam`;

export function neo4jRegistryGraph(options: RegistryGraphOptions): RegistryGraph {
  const doFetch = options.fetch ?? globalThis.fetch;
  const endpoint = queryEndpoint(options.url, options.database);
  const authorization = `Basic ${btoa(`${options.username}:${options.password}`)}`;

  async function run(statement: string, parameters: Record<string, unknown>): Promise<Row[]> {
    const response = await doFetch(endpoint, {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ statement, parameters }),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });

    if (!response.ok) {
      // The body carries Neo4j's own reason, which is worth surfacing: most
      // failures here are a wrong database name or an expired password, and a
      // bare 401 sends somebody looking in the wrong place.
      const detail = await response.text().catch(() => "");
      throw new Error(`The registry graph answered ${response.status}: ${detail.slice(0, 400)}`);
    }

    const payload = (await response.json()) as QueryResult;
    if (payload.errors !== undefined && payload.errors.length > 0) {
      throw new Error(payload.errors.map((error) => error.message).join("; "));
    }

    const fields = payload.data?.fields ?? [];
    return (payload.data?.values ?? []).map((values) =>
      Object.fromEntries(fields.map((field, at) => [field, values[at]])),
    );
  }

  /**
   * The `WHERE` every search shares.
   *
   * Nulls mean "no filter", which keeps one statement rather than assembling
   * Cypher by string concatenation — a query built by pasting user input into
   * a string is how somebody's search box becomes a way to run anything.
   */
  const WHERE = `
    WHERE ($association IS NULL OR reg.association = $association)
      AND ($sex IS NULL OR a.sex = $sex)
      AND ($text IS NULL
           OR toLower(a.name) CONTAINS $text
           OR toLower(coalesce(a.tattoo, '')) CONTAINS $text
           OR toLower(reg.regNumber) CONTAINS $text)`;

  const parametersFor = (query: RegistryQuery) => ({
    association:
      query.association === undefined || query.association === ""
        ? null
        : graphAssociation(query.association),
    sex: query.sex === undefined ? null : query.sex === "male" ? "M" : "F",
    text:
      query.text === undefined || query.text.trim() === "" ? null : query.text.trim().toLowerCase(),
  });

  return {
    async search(query) {
      const parameters = parametersFor(query);
      const limit = Math.max(1, Math.min(query.limit ?? DEFAULT_LIMIT, 200));

      // Counted separately rather than by collecting everything and measuring
      // it: a match on a common name is tens of thousands of animals, and
      // materialising them to learn how many there were is how a search box
      // takes a database down.
      const [counted, page] = await Promise.all([
        run(
          `MATCH (a:Animal)-[:HAS_REGISTRATION]->(reg:Registration) ${WHERE}
           RETURN count(DISTINCT a) AS total`,
          parameters,
        ),
        run(
          `MATCH (a:Animal)-[:HAS_REGISTRATION]->(reg:Registration) ${WHERE}
           WITH a, reg ORDER BY a.name, reg.regNumber
           LIMIT $limit
           RETURN ${RETURN_ANIMAL}`,
          { ...parameters, limit },
        ),
      ]);

      return {
        found: page.map(toAnimal).filter((entry): entry is RegistryAnimal => entry !== undefined),
        total: asNumber(counted[0]?.["total"]) ?? 0,
      };
    },

    async get(association, regNumber) {
      const rows = await run(
        `MATCH (a:Animal)-[:HAS_REGISTRATION]->(reg:Registration
           { association: $association, regNumber: $regNumber })
         RETURN ${RETURN_ANIMAL}`,
        { association: graphAssociation(association), regNumber },
      );
      return rows.length === 0 ? undefined : toAnimal(rows[0] as Row);
    },

    async pedigree(association, regNumber, generations) {
      const depth = Math.max(1, Math.min(generations, MAX_CATALOGUE_GENERATIONS));

      // The one query a graph is genuinely better at. `SIRE_OF|DAM_OF` walked
      // backwards from the subject, bounded — bounded because a mistyped
      // registration can make an animal its own grandsire, and an unbounded
      // walk on that never returns.
      const rows = await run(
        `MATCH (subject:Animal)-[:HAS_REGISTRATION]->(:Registration
           { association: $association, regNumber: $regNumber })
         MATCH path = (a:Animal)-[:SIRE_OF|DAM_OF*1..${depth}]->(subject)
         WITH a, subject, path,
              [rel IN relationships(path) | type(rel)] AS steps
         MATCH (a)-[:HAS_REGISTRATION]->(reg:Registration)
         RETURN ${RETURN_ANIMAL}, steps, length(path) AS generation
         ORDER BY generation, a.name`,
        { association: graphAssociation(association), regNumber },
      );

      return rows
        .map((row) => {
          const animal = toAnimal(row);
          if (animal === undefined) return undefined;
          const steps = (row["steps"] as string[] | undefined) ?? [];
          return {
            ...animal,
            // `[SIRE_OF, DAM_OF]` read from the subject outwards is "the dam's
            // sire" — the path is walked from the ancestor down, so the words
            // come out in the order a breeder says them when reversed.
            position: [...steps]
              .reverse()
              .map((step) => (step === "SIRE_OF" ? "sire" : "dam"))
              .join("'s "),
            generation: asNumber(row["generation"]) ?? steps.length,
          };
        })
        .filter(
          (entry): entry is RegistryAnimal & { position: string; generation: number } =>
            entry !== undefined,
        );
    },
  };
}
