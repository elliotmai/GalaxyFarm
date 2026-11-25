import { describe, expect, it } from "vitest";

import type { Animal, Ulid, ZoneAssignment } from "@galaxy-farm/core";

import type { CattleProfile } from "../src/domain/cattle-profile.js";
import { calvesAtFoot, withCalvesAtFoot } from "../src/domain/weaning-watch.js";

/**
 * Moving a cow moves her unweaned calf (spec §5.1, §6).
 *
 * The calf runs with the cow raising it until it is weaned, so every move of
 * her is a move of the pair — unless somebody has already put the calf
 * somewhere else.
 */

const TODAY = new Date("2026-08-14T12:00:00Z");
const daysAgo = (days: number): Date => new Date(TODAY.getTime() - days * 86_400_000);

let seq = 0;
const id = (): Ulid => `01ARZ3NDEKTSV4RRFFQ69G5F${String(seq++).padStart(2, "0")}` as Ulid;

const cow = (): Animal =>
  ({
    id: id(),
    species: "cattle",
    name: "Dolly",
    sex: "female",
    status: "active",
    dob: daysAgo(2000),
  }) as Animal;
const calf = (over: Partial<Animal> = {}): Animal =>
  ({
    id: id(),
    species: "cattle",
    name: "Bandit",
    sex: "male",
    status: "active",
    dob: daysAgo(60),
    ...over,
  }) as Animal;

type Profile = Pick<CattleProfile, "animalId" | "weanedOn" | "dam" | "raisedById">;
const out =
  (damId: Ulid, over: Partial<CattleProfile> = {}) =>
  (calfId: Ulid): Profile =>
    ({ animalId: calfId, dam: { kind: "animal", id: damId }, ...over }) as Profile;

const NORTH = id();
const SOUTH = id();
const HOSPITAL = id();
const STALL = id();
const indoorZoneIds = new Set<Ulid>([STALL]);

const at = (animalId: Ulid, zoneId: Ulid): ZoneAssignment =>
  ({
    id: id(),
    propertyId: id(),
    createdAt: daysAgo(10),
    updatedAt: daysAgo(10),
    animalId,
    zoneId,
    slot: zoneId === STALL ? "inside" : "outside",
    periodFrom: daysAgo(10),
  }) as ZoneAssignment;

describe("calvesAtFoot", () => {
  it("finds the unweaned calf standing with her", () => {
    const dolly = cow();
    const bandit = calf();
    const found = calvesAtFoot(dolly.id, {
      animals: [dolly, bandit],
      profiles: [out(dolly.id)(bandit.id)],
      assignments: [at(dolly.id, NORTH), at(bandit.id, NORTH)],
      indoorZoneIds,
      asOf: TODAY,
    });
    expect(found.map((c) => c.calfId)).toEqual([bandit.id]);
  });

  it("leaves a weaned calf where it is", () => {
    const dolly = cow();
    const bandit = calf();
    const found = calvesAtFoot(dolly.id, {
      animals: [dolly, bandit],
      profiles: [out(dolly.id, { weanedOn: daysAgo(1) })(bandit.id)],
      assignments: [at(dolly.id, NORTH), at(bandit.id, NORTH)],
      indoorZoneIds,
      asOf: TODAY,
    });
    expect(found).toEqual([]);
  });

  it("leaves a calf somebody has already put in another pen", () => {
    const dolly = cow();
    const bandit = calf();
    const found = calvesAtFoot(dolly.id, {
      animals: [dolly, bandit],
      profiles: [out(dolly.id)(bandit.id)],
      assignments: [at(dolly.id, NORTH), at(bandit.id, HOSPITAL)],
      indoorZoneIds,
      asOf: TODAY,
    });
    expect(found).toEqual([]);
  });

  it("brings a calf with no outside placement, and ignores inside ones when comparing", () => {
    const dolly = cow();
    const bandit = calf();
    const found = calvesAtFoot(dolly.id, {
      animals: [dolly, bandit],
      profiles: [out(dolly.id)(bandit.id)],
      assignments: [at(dolly.id, NORTH), at(bandit.id, STALL)],
      indoorZoneIds,
      asOf: TODAY,
    });
    expect(found.map((c) => c.calfId)).toEqual([bandit.id]);
  });

  it("follows the recipient who calved it, not the donor on the papers", () => {
    const donor = cow();
    const recipient = cow();
    const et = calf();
    const input = {
      animals: [donor, recipient, et],
      profiles: [out(donor.id)(et.id)],
      calvings: [{ damId: recipient.id, calfAnimalId: et.id }],
      assignments: [at(recipient.id, NORTH), at(et.id, NORTH), at(donor.id, SOUTH)],
      indoorZoneIds,
      asOf: TODAY,
    };
    expect(calvesAtFoot(recipient.id, input).map((c) => c.calfId)).toEqual([et.id]);
    expect(calvesAtFoot(donor.id, input)).toEqual([]);
  });
});

describe("withCalvesAtFoot", () => {
  it("adds calves after the animals asked for, once each", () => {
    const dolly = cow();
    const jenna = cow();
    const bandit = calf();
    const pip = calf();
    const party = withCalvesAtFoot([dolly.id, jenna.id, pip.id], {
      animals: [dolly, jenna, bandit, pip],
      profiles: [out(dolly.id)(bandit.id), out(jenna.id)(pip.id)],
      assignments: [],
      indoorZoneIds,
      asOf: TODAY,
    });
    expect(party).toEqual([
      { animalId: dolly.id },
      { animalId: jenna.id },
      { animalId: pip.id },
      { animalId: bandit.id, withDamId: dolly.id },
    ]);
  });
});
