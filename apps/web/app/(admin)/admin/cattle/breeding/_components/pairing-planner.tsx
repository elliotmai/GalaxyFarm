"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Callout, Card, EmptyState, Meter, Pill, Section, Select, Tile } from "@galaxy-farm/ui";
import { displayName, type Animal, type Ulid } from "@galaxy-farm/core";
import {
  DEFECT_NAMES,
  HOUSE_RULE_DEFECTS,
  expectedComposition,
  matingAllowed,
  matingDefectRisk,
  predictColour,
  relatedness,
  relatednessVerdict,
  RELATEDNESS_GENERATIONS,
  writeExtension,
  writeRoan,
  type CattleProfile,
  type ExternalAnimal,
  type ParentRef,
} from "@galaxy-farm/module-cattle";

import { animalHref } from "@/lib/animal-slug";
import { usePedigreeSource } from "@/lib/pedigree-source";
import { useRecords } from "@/lib/local/use-records";

/**
 * Before you pull the straw (spec §5.2).
 *
 * Four questions get asked at the moment somebody picks a bull, and this
 * screen answers all four at once because asked separately they get asked
 * three times and skipped the fourth:
 *
 * 1. **What will the calf be?** Each parent contributes half its own breeding.
 * 2. **What colour?** Both loci together — roan takes the colour Extension
 *    gave it, so black through roan is a blue roan.
 * 3. **Are they too close?** Wright's coefficient over four generations, with
 *    the shared ancestors named rather than counted.
 * 4. **Can this pairing carry a defect?** TH, PHA and DS, against the house
 *    rule that no carrier belongs on this place at all.
 *
 * Nothing here writes anything. It is a look before a decision, and the
 * decision is recorded on the form below it.
 */

function percent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

export function PairingPlanner({
  animals,
  propertyId,
}: {
  readonly animals: readonly Animal[];
  readonly propertyId: Ulid;
}) {
  const query = { propertyId };
  const { records: profiles } = useRecords<CattleProfile>("cattleProfiles", query);
  const { records: outsiders } = useRecords<ExternalAnimal>("externalAnimals", query);
  const source = usePedigreeSource({ animals, profiles, outsiders });

  const [sireKey, setSireKey] = useState("");
  const [damId, setDamId] = useState("");

  const profileByAnimal = useMemo(
    () => new Map(profiles.map((profile) => [profile.animalId, profile])),
    [profiles],
  );

  const parse = (value: string): ParentRef | undefined => {
    if (value === "") return undefined;
    const [kind, id] = value.split(":");
    return kind === "animal" || kind === "external" ? { kind, id: id as Ulid } : undefined;
  };

  const sireRef = parse(sireKey);
  const damRef = damId === "" ? undefined : ({ kind: "animal", id: damId as Ulid } as ParentRef);

  const sireAnimal =
    sireRef?.kind === "animal" ? animals.find((a) => a.id === sireRef.id) : undefined;
  const damAnimal = animals.find((animal) => animal.id === damId);

  // A sire out of the tank is an external animal with a profile of its own on
  // the ancestors screen; a bull in the pasture has a cattle profile. Both
  // resolve to the same two things — breeding and genetics — or to nothing.
  const sireProfile = sireRef?.kind === "animal" ? profileByAnimal.get(sireRef.id) : undefined;
  const damProfile = damRef === undefined ? undefined : profileByAnimal.get(damRef.id);

  const chosen = sireRef !== undefined && damRef !== undefined;

  const composition =
    sireProfile === undefined || damProfile === undefined
      ? []
      : expectedComposition(sireProfile.breedComposition, damProfile.breedComposition);

  const colour =
    sireProfile?.coatGenotype === undefined || damProfile?.coatGenotype === undefined
      ? undefined
      : predictColour(sireProfile.coatGenotype, damProfile.coatGenotype);

  const kinship =
    sireRef === undefined || damRef === undefined
      ? undefined
      : relatedness(sireRef, damRef, source, RELATEDNESS_GENERATIONS);
  const verdict =
    kinship === undefined ? undefined : relatednessVerdict(kinship.inbreedingCoefficient);

  const defects =
    sireProfile === undefined || damProfile === undefined
      ? undefined
      : matingAllowed(sireProfile.geneticTests, damProfile.geneticTests);
  const risks =
    sireProfile === undefined || damProfile === undefined
      ? []
      : matingDefectRisk(sireProfile.geneticTests, damProfile.geneticTests);

  const sireOptions = [
    ...animals
      .filter((animal) => animal.sex === "male" && animal.status === "active")
      .map((animal) => ({ value: `animal:${animal.id}`, label: `${displayName(animal)} (ours)` })),
    ...[...outsiders]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => ({ value: `external:${entry.id}`, label: entry.name })),
  ];

  return (
    <div className="flex flex-col gap-density">
      <Section
        title="Try a pairing"
        description="Nothing here is saved. It is the look you take before you pull the straw."
      >
        <div className="grid grid-cols-1 gap-density sm:grid-cols-2">
          <Select
            label="Sire"
            value={sireKey}
            placeholder="Choose a bull"
            options={sireOptions}
            onChange={(event) => setSireKey(event.target.value)}
          />
          <Select
            label="Dam"
            value={damId}
            placeholder="Choose a cow"
            options={animals
              .filter((animal) => animal.sex === "female" && animal.status === "active")
              .map((animal) => ({ value: animal.id, label: displayName(animal) }))}
            onChange={(event) => setDamId(event.target.value)}
          />
        </div>
      </Section>

      {!chosen ? (
        <EmptyState
          title="Pick a sire and a dam"
          detail="You will get the calf's breeding, the colours it can be, how close the two are, and what defects the pairing could carry."
        />
      ) : (
        <>
          {/*
            The refusals lead. A carrier pairing and a parent-offspring pairing
            are not findings to scroll past — they are the answer, and the rest
            of the page is detail about a mating that should not happen.
          */}
          {defects !== undefined && !defects.allowed ? (
            <Callout
              tone="danger"
              title={`This pairing carries ${defects.carried.map((defect) => defect).join(" and ")}`}
            >
              {defects.carried.map((defect) => `${DEFECT_NAMES[defect]} (${defect})`).join(", ")}.
              No carrier belongs on this place — that is the rule, and it is stricter than the
              genetics require on purpose.
            </Callout>
          ) : null}

          {verdict !== undefined && (verdict.level === "refuse" || verdict.level === "caution") ? (
            <Callout
              tone={verdict.level === "refuse" ? "danger" : "action"}
              title="These two are close"
            >
              {verdict.summary}
            </Callout>
          ) : null}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile
              label="Inbreeding"
              value={
                kinship === undefined ? "—" : `${(kinship.inbreedingCoefficient * 100).toFixed(1)}%`
              }
              tone={
                verdict?.level === "refuse" || verdict?.level === "caution"
                  ? "danger"
                  : verdict?.level === "note"
                    ? "action"
                    : "calm"
              }
              emphasis={verdict?.level === "refuse"}
              hint={`Over ${RELATEDNESS_GENERATIONS} generations`}
            />
            <Tile
              label="Shared ancestors"
              value={kinship?.common.length ?? 0}
              tone={(kinship?.common.length ?? 0) > 0 ? "identity" : "calm"}
            />
            <Tile
              label="Defect risk"
              value={defects === undefined ? "—" : defects.allowed ? "none" : "carrier"}
              tone={defects?.allowed === false ? "danger" : "calm"}
              emphasis={defects?.allowed === false}
            />
            <Tile
              label="Untested for"
              value={defects?.untested.length ?? HOUSE_RULE_DEFECTS.length}
              tone={(defects?.untested.length ?? 1) > 0 ? "action" : "calm"}
              hint={
                (defects?.untested.length ?? 1) > 0
                  ? defects?.untested.join(", ")
                  : "All three on file"
              }
            />
          </div>

          <Section
            title="The calf's breeding"
            description="Each parent contributes half of its own."
          >
            {composition.length === 0 ? (
              <EmptyState
                title="Not enough on file"
                detail="Both parents need a breed composition before the calf's can be worked out. Add one on each animal's profile."
              />
            ) : (
              <Card>
                <div className="flex flex-col gap-3">
                  {composition.map((share) => (
                    <div key={share.breed} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-density text-ink">{share.breed}</span>
                        <Pill tone="identity">{share.percent}%</Pill>
                      </div>
                      <Meter value={share.percent / 100} tone="identity" />
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </Section>

          <Section
            title="What colour"
            description="Both loci together. Roan has no colour of its own — it takes the one Extension gave it, so black through roan is a blue roan."
          >
            {colour === undefined || colour.outcomes.length === 0 ? (
              <EmptyState
                title="No colour genotype on file"
                detail="Both parents need their Extension and roan alleles recorded before a calf's colour can be predicted. A coat you can see is not enough — a black cow can be ED/ED or ED/e, and out of a red bull those two throw different calves."
              />
            ) : (
              <div className="flex flex-col gap-density">
                <Card>
                  <div className="flex flex-col gap-3">
                    {colour.outcomes.map((outcome) => (
                      <div key={outcome.label} className="flex flex-col gap-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-density text-ink">
                            {outcome.label}
                            {outcome.carriesRed === true ? (
                              <span className="ml-2 text-sm text-muted">carries red</span>
                            ) : null}
                          </span>
                          <span className="flex items-center gap-2">
                            <Pill tone="action">{percent(outcome.chance)}</Pill>
                          </span>
                        </div>
                        <Meter value={outcome.chance} tone="action" />
                        <p className="text-sm text-muted">{outcome.genotypes.join(" · ")}</p>
                      </div>
                    ))}
                  </div>
                </Card>

                {/*
                  The squares themselves. A breeder reads four boxes and checks
                  them; a bar chart of percentages has to be taken on trust.
                */}
                <div className="grid grid-cols-1 gap-density md:grid-cols-2">
                  {colour.extensionSquare === undefined ? null : (
                    <PunnettTable
                      title="Extension — black or red"
                      square={colour.extensionSquare.map((row) =>
                        row.map((cell) => writeExtension(cell.genotype)),
                      )}
                      sire={sireProfile?.coatGenotype?.extension ?? []}
                      dam={damProfile?.coatGenotype?.extension ?? []}
                    />
                  )}
                  {colour.roanSquare === undefined ? null : (
                    <PunnettTable
                      title="Roan — solid, roan or white"
                      square={colour.roanSquare.map((row) =>
                        row.map((cell) => writeRoan(cell.genotype)),
                      )}
                      sire={sireProfile?.coatGenotype?.roan ?? []}
                      dam={damProfile?.coatGenotype?.roan ?? []}
                    />
                  )}
                </div>

                <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted">
                  {colour.caveats.map((caveat) => (
                    <li key={caveat}>{caveat}</li>
                  ))}
                </ul>
              </div>
            )}
          </Section>

          <Section
            title="How close they are"
            description={`Wright's coefficient over ${RELATEDNESS_GENERATIONS} generations, counting every route through each shared ancestor rather than the shortest.`}
          >
            {kinship === undefined ? null : kinship.pedigreeIncomplete &&
              kinship.common.length === 0 ? (
              <Callout tone="action" title="Not enough pedigree to say">
                One or both of these animals has no parents recorded, so "no common ancestors" here
                is silence rather than a clean bill. Set their sire and dam first.
              </Callout>
            ) : kinship.common.length === 0 ? (
              <Card>
                <p className="text-density text-ink">{verdict?.summary}</p>
              </Card>
            ) : (
              <Card>
                <div className="flex flex-col gap-3">
                  <p className="text-density text-ink">{verdict?.summary}</p>
                  {kinship.common.map((ancestor) => (
                    <div
                      key={`${ancestor.ref.kind}:${ancestor.ref.id}`}
                      className="flex flex-wrap items-center justify-between gap-2 border-t border-edge pt-3"
                    >
                      <span className="text-density text-ink">
                        {ancestor.name}
                        {ancestor.regNumber === undefined ? null : (
                          <span className="ml-2 text-sm text-muted">{ancestor.regNumber}</span>
                        )}
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        <Pill>
                          {ancestor.viaSire === 0
                            ? "is the sire"
                            : `${ancestor.viaSire} up the sire`}
                        </Pill>
                        <Pill>
                          {ancestor.viaDam === 0 ? "is the dam" : `${ancestor.viaDam} up the dam`}
                        </Pill>
                        <Pill tone="identity">
                          {(ancestor.contribution * 100).toFixed(1)}% of it
                        </Pill>
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </Section>

          <Section
            title="Defects"
            description="TH, PHA and DS are simple recessives, and a carrier is a healthy animal you cannot pick out of a pen."
          >
            {sireProfile === undefined || damProfile === undefined ? (
              <EmptyState
                title="No test results on file"
                detail="Record hair-card results on each animal's profile. Nothing recorded is not the same as free — the whole risk here is an untested animal out of a carrier line."
              />
            ) : risks.length === 0 ? (
              <Card>
                <p className="text-density text-calm">
                  Both animals are free of everything on file. Nothing to flag.
                </p>
              </Card>
            ) : (
              <Card>
                <div className="flex flex-col gap-3">
                  {risks.map((risk) => (
                    <div key={risk.defect} className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-density text-ink">
                          {risk.defect}
                          <span className="ml-2 text-sm text-muted">
                            {DEFECT_NAMES[risk.defect]}
                          </span>
                        </span>
                        <span className="flex flex-wrap gap-2">
                          <Pill tone={risk.sire === "free" ? "calm" : "danger"}>
                            sire {risk.sire.replace(/_/g, " ")}
                          </Pill>
                          <Pill tone={risk.dam === "free" ? "calm" : "danger"}>
                            dam {risk.dam.replace(/_/g, " ")}
                          </Pill>
                        </span>
                      </div>
                      {risk.affectedChance > 0 ? (
                        <p className="text-sm text-danger">
                          {percent(risk.affectedChance)} of calves affected,{" "}
                          {percent(risk.carrierChance)} carrying it.
                        </p>
                      ) : risk.uncertain ? (
                        <p className="text-sm text-muted">
                          Untested on one side. That is not a clean result — it is no result.
                        </p>
                      ) : (
                        <p className="text-sm text-muted">
                          No affected calves, {percent(risk.carrierChance)} carriers.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </Section>

          <p className="text-sm text-muted">
            {sireAnimal === undefined ? null : (
              <>
                <Link href={animalHref(sireAnimal)} className="text-action underline">
                  {displayName(sireAnimal)}
                </Link>
                {" · "}
              </>
            )}
            {damAnimal === undefined ? null : (
              <Link href={animalHref(damAnimal)} className="text-action underline">
                {displayName(damAnimal)}
              </Link>
            )}
          </p>
        </>
      )}
    </div>
  );
}

/** The four boxes, laid out the way a breeder draws them. */
function PunnettTable({
  title,
  square,
  sire,
  dam,
}: {
  readonly title: string;
  readonly square: readonly (readonly string[])[];
  readonly sire: readonly string[];
  readonly dam: readonly string[];
}) {
  return (
    <Card title={title}>
      <table className="w-full border-collapse text-center text-density">
        <caption className="sr-only">{title} Punnett square</caption>
        <thead>
          <tr>
            <th scope="col" className="p-2 text-sm font-normal text-muted">
              sire ↓ dam →
            </th>
            {dam.map((allele, index) => (
              <th key={`${allele}-${index}`} scope="col" className="p-2 text-ink">
                {allele}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {square.map((row, rowIndex) => (
            <tr key={`${sire[rowIndex]}-${rowIndex}`}>
              <th scope="row" className="p-2 text-ink">
                {sire[rowIndex]}
              </th>
              {row.map((genotype, cellIndex) => (
                <td
                  key={`${genotype}-${cellIndex}`}
                  className="rounded-density border border-edge p-2 text-ink"
                >
                  {genotype}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
