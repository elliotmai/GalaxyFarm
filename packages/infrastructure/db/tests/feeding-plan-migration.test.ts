import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Migration 0042 converts every old-shape feeding plan rather than dropping it.
 *
 * Old plans were aimed at an animal, a zone or the whole place. This builds a
 * database one migration back, writes one plan of each kind against animals,
 * a pen and a coop, runs 0042, and reads back what each became — because a
 * feeding plan that converts wrongly is a run-out date that is wrong without
 * anybody being told.
 */

const DIR = join(process.cwd(), "packages/infrastructure/db/migrations");
const FILES = readdirSync(DIR)
  .filter((file) => file.endsWith(".sql"))
  .sort();
const TARGET = FILES.findIndex((file) => file.startsWith("0042_"));

async function apply(pg: PGlite, files: readonly string[]): Promise<void> {
  for (const file of files) {
    for (const statement of readFileSync(join(DIR, file), "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s !== "")) {
      await pg.exec(statement);
    }
  }
}

const P = "01HQ00000000000000000000P0";
const id = (n: number) => `01HQ0000000000000000000${String(n).padStart(3, "0")}`;

interface Row {
  id: string;
  species: string;
  animal_ids: string[];
  flock_ids: string[];
  portion: string;
  place_zone_id: string | null;
  active: boolean;
}

describe("0042 — feeding plans own their animals", () => {
  const pg = new PGlite();
  let plans: Map<string, Row>;

  beforeAll(async () => {
    await apply(pg, FILES.slice(0, TARGET));

    const animal = (n: number, species: string, status = "active") =>
      pg.query(
        `INSERT INTO animals (id, property_id, created_at, updated_at, species, name, sex,
           dob_is_estimate, status, ownership, safety_level)
         VALUES ($1, $2, now(), now(), $3, $1, 'female', false, $4, 'own', 1)`,
        [id(n), P, species, status],
      );
    await animal(1, "cattle");
    await animal(2, "cattle");
    await animal(3, "cattle");
    await animal(4, "cattle", "sold");
    await animal(5, "cat");
    await animal(6, "cat");
    await animal(7, "horse");
    await animal(8, "dog");

    // Cows 1 and 2 and the dog are in the pen; the dog must not join its plan.
    for (const [n, animalId] of [
      [20, 1],
      [21, 2],
      [22, 8],
    ] as const) {
      await pg.query(
        `INSERT INTO zone_assignments (id, property_id, created_at, updated_at, animal_id,
           zone_id, period_from, slot)
         VALUES ($1, $2, now(), now(), $3, $4, now(), 'outside')`,
        [id(n), P, id(animalId), id(90)],
      );
    }

    await pg.query(
      `INSERT INTO flocks (id, property_id, created_at, updated_at, name, species, zone_id,
         opening_count, active)
       VALUES ($1, $2, now(), now(), 'Layers', 'chicken', $3, 12, true)`,
      [id(30), P, id(91)],
    );

    const plan = (n: number, target: string, targetId: string, also: string[], portion: string) =>
      pg.query(
        `INSERT INTO feeding_plans (id, property_id, created_at, updated_at, name, target,
           target_id, also_feeds, portion, lines, active)
         VALUES ($1, $2, now() - interval '1 day', now() - interval '1 day', $1, $3, $4, $5,
           $6, '[]', true)`,
        [id(n), P, target, targetId, also, portion],
      );
    await plan(40, "animal", id(5), [id(6)], "shared"); // two cats, one bowl
    await plan(41, "zone", id(90), [], "per_head"); // the pen
    await plan(42, "zone", id(91), [], "per_head"); // the coop
    await plan(43, "group", P, [], "per_head"); // the whole place
    await plan(44, "zone", id(99), [], "per_head"); // a pen nobody is in

    await apply(pg, [FILES[TARGET]!]);

    const result = await pg.query<Row>(
      `SELECT id, species, animal_ids, flock_ids, portion, place_zone_id, active
       FROM feeding_plans`,
    );
    plans = new Map(result.rows.map((row) => [row.id, row]));
  }, 120_000);

  it("keeps an animal plan's animal and its company, and a shared bowl stays one", () => {
    const cats = plans.get(id(40))!;
    expect(cats.species).toBe("cat");
    expect(cats.animal_ids).toEqual([id(5), id(6)]);
    expect(cats.portion).toBe("total");
  });

  it("turns a pen plan into the livestock in the pen, fed there, without the dog", () => {
    const pen = plans.get(id(41))!;
    expect(pen.species).toBe("cattle");
    expect([...pen.animal_ids].sort()).toEqual([id(1), id(2)]);
    expect(pen.place_zone_id).toBe(id(90));
    expect(pen.portion).toBe("each");
  });

  it("turns a coop plan into its flocks", () => {
    const coop = plans.get(id(42))!;
    expect(coop.species).toBe("chicken");
    expect(coop.flock_ids).toEqual([id(30)]);
    expect(coop.active).toBe(true);
  });

  it("turns a whole-place plan into the commonest livestock, on the farm only", () => {
    const herd = plans.get(id(43))!;
    expect(herd.species).toBe("cattle");
    // The sold cow and the horse are not on it; the herd is.
    expect(herd.animal_ids).toEqual([id(1), id(2), id(3)]);
  });

  it("switches off a converted plan nobody is left on, rather than losing it", () => {
    const empty = plans.get(id(44))!;
    expect(empty.active).toBe(false);
    expect(empty.animal_ids).toEqual([]);
  });

  it("drops the old columns, so nothing can read the old shape", async () => {
    const columns = await pg.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'feeding_plans'`,
    );
    const names = columns.rows.map((row) => row.column_name);
    expect(names).not.toContain("target");
    expect(names).not.toContain("also_feeds");
    expect(names).toContain("animal_ids");
  });
});
