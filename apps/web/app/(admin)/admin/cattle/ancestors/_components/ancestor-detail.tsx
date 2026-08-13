"use client";

import { useMemo } from "react";

import {
  Button,
  Callout,
  Card,
  Constellation,
  DetailList,
  EmptyState,
  Pill,
  Section,
  Tile,
  type ConstellationNode,
} from "@galaxy-farm/ui";
import { displayName, type Animal, type Ulid } from "@galaxy-farm/core";
import {
  allRegistrations,
  buildPedigree,
  carries,
  DEFECT_NAMES,
  breedsOf,
  describeComposition,
  describeLocus,
  EXTENSION_ALLELES,
  ROAN_ALLELES,
  describeCompositionSource,
  registrationUrl,
  GENETIC_DEFECTS,
  herdRuleVerdict,
  HOUSE_RULE_DEFECTS,
  isKnownFree,
  pedigreeDepth,
  registrationClasses,
  resolveCompositionFor,
  statusOf,
  STATUS_LABELS,
  type CattleProfile,
  type ExternalAnimal,
  type PedigreeNode,
  type PedigreeSource,
  type SexVerdict,
} from "@galaxy-farm/module-cattle";

import { animalHref } from "@/lib/animal-slug";
import { coatFor } from "@/lib/coat";
import { compositionLookup } from "@/lib/composition";

/**
 * Everything known about one ancestor, in one place (spec §5.2).
 *
 * The list is a list: it answers "which one is that" and nothing else. This
 * answers the questions somebody actually opens an ancestor for — what it is,
 * what it tested, what is behind it, and what here came out of it — without
 * needing four screens or an edit form to read a value out of.
 *
 * Written without "she" throughout, and that is not fussiness: half the
 * animals on this screen are bulls. A pedigree is the one place where every
 * record is as likely to be a bull as a cow, and a screen that calls a
 * herd sire "her" reads as one nobody checked.
 *
 * Two things make it worth having rather than a wider table.
 *
 * **It is navigable.** Every parent and every descendant is a link that swaps
 * this view to that animal, with a trail back. Following a line four
 * generations up and then back down to the calf standing in the pen is the
 * whole reason a pedigree is kept, and doing that by scrolling a table and
 * re-searching each name is how nobody ever does it.
 *
 * **It says where each answer came from.** A breed makeup off the papers and
 * one worked out from two parents are different claims; a defect result read
 * off an association's chart and one typed off a hair card are different
 * claims. Both are labelled, because only one of each pair can be quoted to a
 * buyer.
 */

export function AncestorDetail({
  animal,
  outsiders,
  animals,
  profiles,
  source,
  sexes,
  onOpen,
  onEdit,
  onRefresh,
  onMerge,
  onDelete,
}: {
  readonly animal: ExternalAnimal;
  readonly outsiders: readonly ExternalAnimal[];
  readonly animals: readonly Animal[];
  readonly profiles: readonly CattleProfile[];
  readonly source: PedigreeSource;
  readonly sexes: ReadonlyMap<Ulid, SexVerdict>;
  readonly onOpen: (next: ExternalAnimal) => void;
  readonly onEdit: () => void;
  readonly onRefresh: () => void;
  readonly onMerge: () => void;
  readonly onDelete: () => void;
}) {
  const papers = allRegistrations(animal);
  const verdict = sexes.get(animal.id);

  const breeding = useMemo(
    () =>
      resolveCompositionFor(
        { kind: "external", id: animal.id },
        compositionLookup(profiles, outsiders),
      ),
    [animal.id, profiles, outsiders],
  );

  const tree = useMemo(
    () => buildPedigree({ kind: "external", id: animal.id }, source, 4),
    [animal.id, source],
  );
  const depth = pedigreeDepth(tree);

  /** Everything on file that names this animal as a parent. */
  const descendants = useMemo(() => {
    const named = new Map(animals.map((entry) => [entry.id, entry]));
    const found: { key: string; label: string; role: string; href?: string }[] = [];

    for (const profile of profiles) {
      for (const [ref, role] of [
        [profile.sire, "sire"],
        [profile.dam, "dam"],
      ] as const) {
        if (ref?.kind !== "external" || ref.id !== animal.id) continue;
        const theirs = named.get(profile.animalId);
        found.push({
          key: `${profile.id}-${role}`,
          label: theirs === undefined ? "an animal here" : displayName(theirs),
          role,
          ...(theirs === undefined ? {} : { href: animalHref(theirs) }),
        });
      }
    }
    for (const other of outsiders) {
      for (const [ref, role] of [
        [other.sire, "sire"],
        [other.dam, "dam"],
      ] as const) {
        if (ref?.kind !== "external" || ref.id !== animal.id) continue;
        found.push({ key: `${other.id}-${role}`, label: other.name, role });
      }
    }
    return found;
  }, [animal.id, animals, profiles, outsiders]);

  const parentOf = (which: "sire" | "dam") => {
    const ref = animal[which];
    if (ref?.kind !== "external") return undefined;
    return outsiders.find((entry) => entry.id === ref.id);
  };

  const tests = animal.geneticTests ?? [];
  const house = herdRuleVerdict(tests);
  // The class the papers state wins over anything worked out from a
  // percentage — the registry decided it, and an animal upgraded years ago can
  // hold a class its current makeup would not earn.
  const eligibility = registrationClasses(breeding.composition, animal.classification);
  const breeds = breedsOf({ ...animal, breedComposition: breeding.composition });
  const coat = useMemo(
    () => coatFor({ kind: "external", id: animal.id }, { profiles, outsiders }),
    [animal.id, profiles, outsiders],
  );

  return (
    <div className="flex flex-col gap-density">
      <div className="flex flex-wrap items-center gap-2">
        {verdict?.sex === undefined ? (
          <Pill>not yet placed</Pill>
        ) : (
          <Pill tone={verdict.inferred ? "neutral" : "calm"}>
            {verdict.sex === "male" ? "bull" : "cow"}
            {verdict.inferred ? " · from the pedigree" : ""}
          </Pill>
        )}
        {papers.map((entry) => {
          const url = registrationUrl(entry.association, entry.regNumber);
          return url === undefined ? (
            <Pill key={`${entry.association}-${entry.regNumber}`} tone="identity">
              {entry.association} {entry.regNumber}
            </Pill>
          ) : (
            <a
              key={`${entry.association}-${entry.regNumber}`}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-edge underline-offset-4 hover:decoration-action"
            >
              <Pill tone="identity">
                {entry.association} {entry.regNumber} ↗
              </Pill>
            </a>
          );
        })}
        {animal.status === undefined ? null : <Pill>{animal.status}</Pill>}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Papers"
          value={papers.length}
          hint={papers.length > 1 ? "Registered twice" : undefined}
          tone="identity"
        />
        <Tile label="Pedigree" value={depth} hint="generations on file" />
        <Tile label="Descendants" value={descendants.length} />
        <Tile
          label="House rule"
          value={house.clean ? "clean" : house.carried.length > 0 ? "carrier" : "untested"}
          tone={house.clean ? "calm" : house.carried.length > 0 ? "danger" : "neutral"}
          emphasis={house.carried.length > 0}
        />
      </div>

      {house.carried.length === 0 ? null : (
        <Callout tone="danger" title={`Carries ${house.carried.join(", ")}`}>
          The rule on this place is that no carrier comes onto it. Anything out of this animal is at
          least a coin toss to carry it too, and any pairing that puts another carrier on the other
          side is a quarter affected.
        </Callout>
      )}

      <Section title="What it is" description="Off the papers, or worked out from what is.">
        <DetailList
          columns={3}
          items={[
            { label: "Name", value: animal.name },
            {
              // What it is, in words. Derived from the makeup when nobody has
              // typed one, so the row is not blank on an animal whose papers
              // say exactly what it is.
              label: "Breed",
              value: breeds.length === 0 ? undefined : breeds.join(" · "),
            },
            { label: "Tattoo", value: animal.tattoo },
            { label: "Color", value: animal.colour },
            {
              // Worked out, not stored. A red ancestor is `e/e` whether or not
              // anybody ever tested one, and that is exactly the fact a calf's
              // colour prediction three generations down needs.
              label: "Coat genotype",
              value:
                coat === undefined
                  ? undefined
                  : [
                      describeLocus(coat.extension, EXTENSION_ALLELES),
                      describeLocus(coat.roan, ROAN_ALLELES),
                    ].join(" · "),
              wide: true,
            },
            { label: "DOB", value: animal.dob?.toLocaleDateString() },
            { label: "Horns", value: animal.hornStatus },
            { label: "Class on the papers", value: animal.classification },
            {
              label: "Their inbreeding figure",
              value: animal.coi === undefined ? undefined : `${animal.coi}%`,
            },
            { label: "How it was got", value: animal.serviceType },
            { label: "Disposed", value: animal.disposedOn?.toLocaleDateString() },
            {
              label: "Breed makeup",
              value:
                breeding.composition.length === 0
                  ? undefined
                  : describeComposition(breeding.composition),
              wide: true,
            },
            {
              label: "Where that comes from",
              value: describeCompositionSource(breeding),
              wide: true,
            },
            {
              // A makeup is a number; what it *buys* at the registry is the
              // thing that decides whether a calf can be papered, and that is
              // most of what a makeup is worth.
              label: "Could be registered as",
              value:
                eligibility.classes.length === 0
                  ? undefined
                  : eligibility.classes.map((entry) => entry.name).join(" · "),
              wide: true,
            },
            { label: "Notes", value: animal.notes, wide: true },
          ]}
        />

        {eligibility.classes.length === 0 && eligibility.unknownRules === undefined ? null : (
          <Card>
            <div className="flex flex-col gap-2">
              {eligibility.classes.map((entry) => (
                <div key={`${entry.association}-${entry.name}`} className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <Pill tone="identity">{entry.association}</Pill>
                    <span className="text-density font-medium text-ink">{entry.name}</span>
                  </span>
                  <span className="text-sm text-muted">{entry.because}</span>
                  {entry.alsoRequires === undefined ? null : (
                    // Colour, poll and registered parentage are conditions no
                    // percentage can answer. Listed rather than assumed, so
                    // nobody quotes a class the animal does not hold.
                    <ul className="flex flex-col gap-0.5 text-sm text-muted">
                      {entry.alsoRequires.map((condition) => (
                        <li key={condition}>· also needs: {condition}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
              {eligibility.unknownRules === undefined ? null : (
                <p className="text-sm text-muted">{eligibility.unknownRules}</p>
              )}
            </div>
          </Card>
        )}
      </Section>

      <Section
        title="Genetics"
        description="Every defect, listed whether or not there is a result — an absent row reads as clear, and that is how a carrier gets bought."
      >
        <Card>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {GENETIC_DEFECTS.map((defect) => {
              const status = statusOf(tests, defect);
              const record = tests.find((test) => test.defect === defect);
              const covered = HOUSE_RULE_DEFECTS.includes(defect);

              return (
                <div
                  key={defect}
                  className="flex items-start justify-between gap-3 border-t border-edge pt-2 first:border-t-0 first:pt-0 sm:[&:nth-child(2)]:border-t-0 sm:[&:nth-child(2)]:pt-0"
                >
                  <span className="flex flex-col">
                    <span className="text-density text-ink">
                      {defect}
                      {covered ? " ·" : ""}
                    </span>
                    <span className="text-sm text-muted">{DEFECT_NAMES[defect]}</span>
                    {record?.notes === undefined ? null : (
                      <span className="text-sm text-muted">{record.notes}</span>
                    )}
                  </span>
                  <Pill
                    tone={carries(status) ? "danger" : isKnownFree(status) ? "calm" : "neutral"}
                    dot={carries(status)}
                  >
                    {STATUS_LABELS[status]}
                  </Pill>
                </div>
              );
            })}
          </div>
        </Card>
      </Section>

      <Section title="Pedigree" description="Click any of them to follow the line up.">
        <div className="flex flex-wrap gap-2">
          {(["sire", "dam"] as const).map((which) => {
            const parent = parentOf(which);
            return (
              <span key={which} className="flex items-center gap-2">
                <span className="text-sm text-muted">{which}</span>
                {parent === undefined ? (
                  <Pill>not recorded</Pill>
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpen(parent)}
                    className="text-density text-action underline underline-offset-4"
                  >
                    {parent.name}
                  </button>
                )}
              </span>
            );
          })}
        </div>

        {tree === undefined || depth === 0 ? (
          <EmptyState
            title="No pedigree yet"
            detail="Set its sire and dam and everything above them follows from the ancestors already on file. Importing the association page fills in four generations at once."
          />
        ) : (
          <Constellation
            root={toConstellation(tree)}
            generations={Math.min(depth, 4)}
            caption="Filled stars are ours, hollow ones are on paper only."
          />
        )}
      </Section>

      <Section title="Progeny" description="Everything on file that names this animal as a parent.">
        {descendants.length === 0 ? (
          <EmptyState
            title="Nothing points at it"
            detail="No pedigree names this animal, which also means it can be deleted without breaking anything."
          />
        ) : (
          <Card>
            <div className="flex flex-wrap gap-2">
              {descendants.map((entry) => {
                const other = outsiders.find((candidate) => candidate.name === entry.label);
                return entry.href !== undefined ? (
                  <a
                    key={entry.key}
                    href={entry.href}
                    className="text-density text-action underline underline-offset-4"
                  >
                    {entry.label} <span className="text-muted">· {entry.role}</span>
                  </a>
                ) : other === undefined ? (
                  <Pill key={entry.key}>
                    {entry.label} · {entry.role}
                  </Pill>
                ) : (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => onOpen(other)}
                    className="text-density text-action underline underline-offset-4"
                  >
                    {entry.label} <span className="text-muted">· {entry.role}</span>
                  </button>
                );
              })}
            </div>
          </Card>
        )}
      </Section>

      <div className="flex flex-wrap gap-2 border-t border-edge pt-density">
        <Button onClick={onEdit}>Edit</Button>
        {papers.length === 0 ? null : (
          <Button variant="ghost" onClick={onRefresh}>
            Check against the association
          </Button>
        )}
        <Button variant="ghost" onClick={onMerge}>
          Merge another record in
        </Button>
        <Button variant="ghost" onClick={onDelete}>
          Delete
        </Button>
      </div>
    </div>
  );
}

/** The module's tree, flattened into the shape the chart draws. */
function toConstellation(node: PedigreeNode): ConstellationNode {
  return {
    id: `${node.ref.kind}:${node.ref.id}`,
    label: node.name,
    ...(node.regNumber === undefined ? {} : { sublabel: node.regNumber }),
    outside: node.ref.kind === "external",
    repeated: false,
    ...(node.sire === undefined ? {} : { sire: toConstellation(node.sire) }),
    ...(node.dam === undefined ? {} : { dam: toConstellation(node.dam) }),
  };
}
