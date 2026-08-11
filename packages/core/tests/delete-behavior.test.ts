import { describe, expect, it } from "vitest";

import {
  assessDeleteImpact,
  relationshipKey,
  requiredTier,
  type Dependent,
  type RelationshipDeclaration,
} from "../src/crud/delete-behavior.js";
import { encodeUlid } from "../src/types/ids.js";

const dependent = (label: string): Dependent => ({
  entity: "ZoneAssignment",
  id: encodeUlid(1, () => 0.5),
  label,
});

const rel = (
  onDelete: RelationshipDeclaration["onDelete"],
  field = "zoneId",
): RelationshipDeclaration => ({
  from: "ZoneAssignment",
  to: "Zone",
  field,
  onDelete,
  rationale: "test",
});

describe("delete impact — spec §4.5", () => {
  it("allows a delete with no dependents", () => {
    const impact = assessDeleteImpact([rel("restrict")], new Map());

    expect(impact.allowed).toBe(true);
    expect(impact.blockedBy).toEqual([]);
  });

  it("blocks on restrict and names what is in the way", () => {
    // The dialog has to say "4 animals are currently assigned to it", which it
    // can only do because this computed the list.
    const impact = assessDeleteImpact(
      [rel("restrict")],
      new Map([[relationshipKey(rel("restrict")), [dependent("Dolly"), dependent("Maisie")]]]),
    );

    expect(impact.allowed).toBe(false);
    expect(impact.blockedBy.map((d) => d.label)).toEqual(["Dolly", "Maisie"]);
  });

  it("lists cascades without blocking", () => {
    const impact = assessDeleteImpact(
      [rel("cascade")],
      new Map([[relationshipKey(rel("cascade")), [dependent("weight record")]]]),
    );

    expect(impact.allowed).toBe(true);
    expect(impact.cascades).toHaveLength(1);
  });

  it("lists detaches without blocking", () => {
    const impact = assessDeleteImpact(
      [rel("detach")],
      new Map([[relationshipKey(rel("detach")), [dependent("photo")]]]),
    );

    expect(impact.allowed).toBe(true);
    expect(impact.detaches).toHaveLength(1);
  });

  it("combines behaviours across several relationships", () => {
    const restrict = rel("restrict", "a");
    const cascade = rel("cascade", "b");
    const detach = rel("detach", "c");

    const impact = assessDeleteImpact(
      [restrict, cascade, detach],
      new Map([
        [relationshipKey(restrict), [dependent("blocker")]],
        [relationshipKey(cascade), [dependent("child")]],
        [relationshipKey(detach), [dependent("loose")]],
      ]),
    );

    expect(impact.allowed).toBe(false);
    expect(impact.blockedBy).toHaveLength(1);
    expect(impact.cascades).toHaveLength(1);
    expect(impact.detaches).toHaveLength(1);
  });
});

describe("confirmation tier — spec §4.5", () => {
  const empty = { allowed: true, blockedBy: [], cascades: [], detaches: [] };

  it("is Standard for an ordinary record with nothing hanging off it", () => {
    expect(requiredTier({ impact: empty, isAggregateRoot: false, onKiosk: false })).toBe(
      "standard",
    );
  });

  it("is Typed for an aggregate root, whatever else is true", () => {
    // An animal with history, a zone, a contact — always type the name.
    expect(requiredTier({ impact: empty, isAggregateRoot: true, onKiosk: false })).toBe("typed");
  });

  it("escalates to Elevated when dependents exist", () => {
    const impact = { ...empty, cascades: [dependent("child")] };

    expect(requiredTier({ impact, isAggregateRoot: false, onKiosk: false })).toBe("elevated");
  });

  it("escalates on a kiosk, where a stray glove is the failure mode", () => {
    expect(requiredTier({ impact: empty, isAggregateRoot: false, onKiosk: true })).toBe("elevated");
  });

  it("escalates for a bulk delete", () => {
    expect(
      requiredTier({ impact: empty, isAggregateRoot: false, onKiosk: false, bulkCount: 12 }),
    ).toBe("elevated");
    expect(
      requiredTier({ impact: empty, isAggregateRoot: false, onKiosk: false, bulkCount: 1 }),
    ).toBe("standard");
  });

  it("never lets a bulk delete be Standard", () => {
    const tier = requiredTier({
      impact: empty,
      isAggregateRoot: false,
      onKiosk: false,
      bulkCount: 2,
    });

    expect(tier).not.toBe("standard");
  });
});
