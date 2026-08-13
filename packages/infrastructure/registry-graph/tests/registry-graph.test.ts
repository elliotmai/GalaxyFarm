import { describe, expect, it, vi } from "vitest";

import { graphAssociation, neo4jRegistryGraph, ourAssociation } from "../src/index.js";

/**
 * The Neo4j adapter, against recorded answers (spec §4.1, §5.2).
 *
 * No network and no database. The Query API returns a fixed shape — a list of
 * field names and a list of row values — so a recorded response is a faithful
 * stand-in, and the thing worth testing is the translation either side of it:
 * the graph's vocabulary in, this app's vocabulary out.
 */

const reply = (fields: string[], values: unknown[][]) => ({
  ok: true,
  status: 200,
  json: async () => ({ data: { fields, values } }),
  text: async () => "",
});

const ANIMAL_FIELDS = [
  "animal",
  "association",
  "regNumber",
  "registrations",
  "composition",
  "defects",
  "sire",
  "dam",
];

const montegoBay = [
  {
    uid: "USAM20090619Z001",
    name: "ZNT MONTEGO BAY 901W",
    sex: "M",
    dob: "2009-06-19",
    tattoo: "ZNT901W",
    color: "Black",
    horn_status: "Polled",
  },
  "MAINE",
  "402303",
  [
    { association: "MAINE", regNumber: "402303" },
    { association: "CHIA", regNumber: "359968" },
  ],
  [
    { breed: "MA", percent: 79.57 },
    { breed: "AN", percent: 14.41 },
  ],
  [
    { defect: "TH", status: "F" },
    { defect: "PHA", status: "C" },
  ],
  { association: "CHIA", regNumber: "MA364424" },
  { association: "MAINE", regNumber: "378987" },
];

const graphFor = (fetch: typeof globalThis.fetch) =>
  neo4jRegistryGraph({
    url: "neo4j+s://instance.databases.neo4j.io",
    username: "user",
    password: "secret",
    database: "instance",
    fetch,
  });

describe("the two vocabularies", () => {
  it("translates the graph's abbreviations to the breeds this app files under", () => {
    // The graph abbreviates; this app names a registry by its breed, because
    // association initials collide — `ASA` is Shorthorn here and Simmental
    // elsewhere — and a breed does not.
    expect(ourAssociation("MAINE")).toBe("Maine-Anjou");
    expect(ourAssociation("CHIA")).toBe("Chianina");
    expect(ourAssociation("SHORT")).toBe("Shorthorn");
    expect(ourAssociation("ANGUS")).toBe("Angus");
  });

  it("translates back on the way in", () => {
    expect(graphAssociation("Maine-Anjou")).toBe("MAINE");
    expect(graphAssociation("Shorthorn")).toBe("SHORT");
  });

  it("translates a filter carrying a record's old initials", () => {
    // A record written before the rename can still be the thing somebody
    // searches from, and it would otherwise reach the graph as a literal `ASA`
    // and match nothing at all.
    expect(graphAssociation("ASA")).toBe("SHORT");
    expect(graphAssociation("AAA")).toBe("ANGUS");
  });

  it("passes an unrecognised code straight through", () => {
    // A registry neither side knows about should not become a silent blank.
    expect(ourAssociation("HERF")).toBe("HERF");
    expect(graphAssociation("HERF")).toBe("HERF");
  });
});

describe("the address", () => {
  it("takes a Bolt connection string and asks the HTTP query API", async () => {
    // Nobody pasting a connection string out of the Aura console should have
    // to know that `neo4j+s://` is Bolt and the query API is plain HTTPS.
    const fetch = vi.fn().mockResolvedValue(reply(["total"], [[0]]));
    await graphFor(fetch as never).search({ text: "x" });

    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://instance.databases.neo4j.io/db/instance/query/v2",
    );
  });

  it("sends the credentials it was handed, and reads none from anywhere else", async () => {
    const fetch = vi.fn().mockResolvedValue(reply(["total"], [[0]]));
    await graphFor(fetch as never).search({});

    const headers = (fetch.mock.calls[0]?.[1] as { headers: Record<string, string> }).headers;
    expect(headers["authorization"]).toBe(`Basic ${btoa("user:secret")}`);
  });
});

describe("reading an animal", () => {
  it("turns a row into the shape the rest of the app already speaks", async () => {
    const fetch = vi.fn().mockResolvedValue(reply(ANIMAL_FIELDS, [montegoBay]));

    const found = await graphFor(fetch as never).get("Maine-Anjou", "402303");

    expect(found).toMatchObject({
      association: "Maine-Anjou",
      regNumber: "402303",
      name: "ZNT MONTEGO BAY 901W",
      sex: "male",
      tattoo: "ZNT901W",
      colour: "Black",
      hornStatus: "Polled",
    });
    expect(found?.dob?.toISOString().slice(0, 10)).toBe("2009-06-19");
  });

  it("carries every registry the animal is papered in, in our codes", async () => {
    const fetch = vi.fn().mockResolvedValue(reply(ANIMAL_FIELDS, [montegoBay]));

    const found = await graphFor(fetch as never).get("Maine-Anjou", "402303");

    expect(found?.registrations).toEqual([
      { association: "Maine-Anjou", regNumber: "402303" },
      { association: "Chianina", regNumber: "359968" },
    ]);
  });

  it("names the parents by registration rather than by a graph id", async () => {
    // Everything downstream identifies an outside animal by association and
    // number. A uid would have to be translated somewhere, and here is the
    // only place that knows how.
    const fetch = vi.fn().mockResolvedValue(reply(ANIMAL_FIELDS, [montegoBay]));

    const found = await graphFor(fetch as never).get("Maine-Anjou", "402303");

    expect(found?.sire).toEqual({ association: "Chianina", regNumber: "MA364424" });
    expect(found?.dam).toEqual({ association: "Maine-Anjou", regNumber: "378987" });
  });

  it("reads F as free and C as a carrier", async () => {
    const fetch = vi.fn().mockResolvedValue(reply(ANIMAL_FIELDS, [montegoBay]));

    const found = await graphFor(fetch as never).get("Maine-Anjou", "402303");

    expect(found?.geneticTests).toEqual([
      expect.objectContaining({ defect: "TH", status: "free" }),
      expect.objectContaining({ defect: "PHA", status: "carrier" }),
    ]);
  });

  it("never rounds an unrecognised defect code down to free", async () => {
    // The same rule the page parsers follow. On a place whose house rule is
    // that no carrier comes onto it, a code nobody recognised must not read
    // as "fine".
    const row = [...montegoBay];
    row[5] = [{ defect: "TH", status: "?" }];
    const fetch = vi.fn().mockResolvedValue(reply(ANIMAL_FIELDS, [row]));

    const found = await graphFor(fetch as never).get("Maine-Anjou", "402303");

    expect(found?.geneticTests?.[0]?.status).toBe("suspect");
  });

  it("says nothing for a number the graph does not hold", async () => {
    const fetch = vi.fn().mockResolvedValue(reply(ANIMAL_FIELDS, []));

    expect(await graphFor(fetch as never).get("Maine-Anjou", "000000")).toBeUndefined();
  });
});

describe("searching", () => {
  it("reports the whole count alongside the page", async () => {
    // A search that silently truncates is one that lies about what is out
    // there — "25 results" out of four thousand sends somebody away.
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(reply(["total"], [[4102]]))
      .mockResolvedValueOnce(reply(ANIMAL_FIELDS, [montegoBay]));

    const result = await graphFor(fetch as never).search({ text: "montego" });

    expect(result.total).toBe(4102);
    expect(result.found).toHaveLength(1);
  });

  it("puts the query in parameters, never in the Cypher", async () => {
    // A statement assembled by pasting a search box into a string is how that
    // box becomes a way to run anything at all.
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(reply(["total"], [[0]]))
      .mockResolvedValueOnce(reply(ANIMAL_FIELDS, []));

    await graphFor(fetch as never).search({ text: "'; MATCH (n) DETACH DELETE n //" });

    for (const call of fetch.mock.calls) {
      const body = JSON.parse((call[1] as { body: string }).body) as {
        statement: string;
        parameters: Record<string, unknown>;
      };
      expect(body.statement).not.toContain("DETACH DELETE");
      expect(body.parameters["text"]).toContain("detach delete");
    }
  });

  it("asks in the graph's vocabulary and its own spelling of sex", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(reply(["total"], [[0]]))
      .mockResolvedValueOnce(reply(ANIMAL_FIELDS, []));

    await graphFor(fetch as never).search({ association: "Shorthorn", sex: "male" });

    const body = JSON.parse((fetch.mock.calls[0]?.[1] as { body: string }).body) as {
      parameters: Record<string, unknown>;
    };
    expect(body.parameters["association"]).toBe("SHORT");
    expect(body.parameters["sex"]).toBe("M");
  });

  it("treats an empty query as no filter rather than as an empty string", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(reply(["total"], [[0]]))
      .mockResolvedValueOnce(reply(ANIMAL_FIELDS, []));

    await graphFor(fetch as never).search({ text: "   ", association: "" });

    const body = JSON.parse((fetch.mock.calls[0]?.[1] as { body: string }).body) as {
      parameters: Record<string, unknown>;
    };
    expect(body.parameters["text"]).toBeNull();
    expect(body.parameters["association"]).toBeNull();
  });

  it("will not hand over more than a page however large a limit is asked for", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(reply(["total"], [[0]]))
      .mockResolvedValueOnce(reply(ANIMAL_FIELDS, []));

    await graphFor(fetch as never).search({ limit: 100_000 });

    const body = JSON.parse((fetch.mock.calls[1]?.[1] as { body: string }).body) as {
      parameters: Record<string, unknown>;
    };
    expect(body.parameters["limit"]).toBe(200);
  });
});

describe("walking a pedigree", () => {
  it("names each slot the way a breeder says it", async () => {
    // The path is walked from the ancestor down to the subject, so the steps
    // come out reversed — `[SIRE_OF, DAM_OF]` is the dam's sire.
    const fetch = vi
      .fn()
      .mockResolvedValue(
        reply(
          [...ANIMAL_FIELDS, "steps", "generation"],
          [[...montegoBay, ["SIRE_OF", "DAM_OF"], 2]],
        ),
      );

    const found = await graphFor(fetch as never).pedigree("Maine-Anjou", "402303", 5);

    expect(found[0]?.position).toBe("dam's sire");
    expect(found[0]?.generation).toBe(2);
  });

  it("never walks further than the catalogue is asked to", async () => {
    // A mistyped registration can make an animal its own grandsire, and an
    // unbounded walk on that never returns.
    const fetch = vi.fn().mockResolvedValue(reply([...ANIMAL_FIELDS, "steps", "generation"], []));

    await graphFor(fetch as never).pedigree("Maine-Anjou", "402303", 99);

    const body = JSON.parse((fetch.mock.calls[0]?.[1] as { body: string }).body) as {
      statement: string;
    };
    expect(body.statement).toContain("*1..5");
  });
});

describe("when the graph will not answer", () => {
  it("surfaces the reason rather than a bare status", async () => {
    // Most failures here are a wrong database name or an expired password,
    // and a bare 401 sends somebody looking in the wrong place.
    const fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Neo.ClientError.Security.Unauthorized",
      json: async () => ({}),
    });

    await expect(graphFor(fetch as never).get("Maine-Anjou", "1")).rejects.toThrow(
      /401.*Unauthorized/s,
    );
  });

  it("reports an error the query itself returned", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ errors: [{ message: "Database does not exist" }] }),
      text: async () => "",
    });

    await expect(graphFor(fetch as never).get("Maine-Anjou", "1")).rejects.toThrow(
      "Database does not exist",
    );
  });
});
