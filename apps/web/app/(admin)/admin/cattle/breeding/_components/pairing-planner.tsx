"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import {
  Callout,
  Card,
  EmptyState,
  Meter,
  Pill,
  SearchSelect,
  Section,
  Tile,
  type SearchOption,
} from "@galaxy-farm/ui";
import { displayName, type Animal, type Ulid } from "@galaxy-farm/core";
import {
  allRegistrations,
  canBe,
  DEFECT_NAMES,
  HOUSE_RULE_DEFECTS,
  expectedComposition,
  maineClassFor,
  mainePercent,
  maineProgeny,
  inferAncestorSexes,
  resolveCompositionFor,
  matingAllowed,
  matingDefectRisk,
  predictCalfColour,
  predictColour,
  relatedness,
  registrationClasses,
  relatednessVerdict,
  RELATEDNESS_GENERATIONS,
  writeExtension,
  writeRoan,
  type CattleProfile,
  type ExternalAnimal,
  type ParentRef,
} from "@galaxy-farm/module-cattle";

import { animalHref } from "@/lib/animal-slug";
import { compositionLookup } from "@/lib/composition";
import { coatResolver } from "@/lib/coat";
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

  /**
   * What the calf would be.
   *
   * Resolved through the pedigree rather than off one field, so a bull out of
   * the tank — an ancestor record with a makeup off his own papers — counts
   * the same as a bull in the pasture, and an unpapered cow's makeup comes up
   * from her parents.
   */
  const lookup = compositionLookup(profiles, outsiders);
  const sireBreeding = sireRef === undefined ? undefined : resolveCompositionFor(sireRef, lookup);
  const damBreeding = damRef === undefined ? undefined : resolveCompositionFor(damRef, lookup);
  const composition =
    sireBreeding === undefined || damBreeding === undefined
      ? []
      : expectedComposition(sireBreeding.composition, damBreeding.composition);

  /**
   * What the calf could be papered as.
   *
   * Two answers, and they are not the same question. `registrationClasses`
   * reads the calf's makeup against each association's thresholds; the AMAA
   * *upgrading chart* is a lookup on the parents' own classes and is
   * deliberately more generous than halving in places — a Fullblood bull on a
   * 3/8 cow gives 11/16 by arithmetic and registers as 3/4. Where the two
   * disagree, the chart is what papers get issued on.
   */
  const upgrade =
    sireBreeding === undefined || damBreeding === undefined
      ? undefined
      : maineProgeny(
          maineClassFor(mainePercent(sireBreeding.composition)),
          maineClassFor(mainePercent(damBreeding.composition)),
        );
  const eligibility = registrationClasses(composition);

  /**
   * The calf's colour, off what can be *worked out* about the parents.
   *
   * This used to need a hair card on both sides and so said "no colour
   * genotype on file" for every pairing anybody actually made — there is a
   * card for almost nothing here. A red cow is `e/e` whether or not a lab ever
   * said so, and a bull who has thrown a red calf carries red whatever his own
   * page says.
   *
   * The Punnett squares below still want settled pairs, so they appear only
   * where both parents have them; the outcome list does not, and is the part
   * that matters standing at a chute.
   */
  const coats = useMemo(() => coatResolver({ profiles, outsiders }), [profiles, outsiders]);
  const sireCoat = sireRef === undefined ? undefined : coats.of(sireRef);
  const damCoat = damRef === undefined ? undefined : coats.of(damRef);
  const calfColour =
    sireCoat === undefined || damCoat === undefined
      ? undefined
      : predictCalfColour(sireCoat, damCoat);

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

  /**
   * Bulls only.
   *
   * The list used to be every ancestor on file, cows included — and a cow
   * picked as a sire produces a colour prediction, a relatedness figure and a
   * breed makeup that all look perfectly ordinary and are all nonsense.
   */
  const sexes = inferAncestorSexes(outsiders, [...profiles, ...outsiders]);

  const sireOptions: SearchOption[] = [
    ...animals
      .filter((animal) => animal.sex === "male" && animal.status === "active")
      .map((animal) => ({
        value: `animal:${animal.id}`,
        label: displayName(animal),
        ...(animal.tagNumber === undefined ? {} : { detail: animal.tagNumber }),
        group: "Ours",
      })),
    ...[...outsiders]
      .filter((entry) => canBe(sexes.get(entry.id), "male"))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => {
        const papers = allRegistrations(entry)
          .map((registration) => `${registration.association} ${registration.regNumber}`)
          .join(" · ");
        return {
          value: `external:${entry.id}`,
          label: entry.name,
          ...(papers === "" ? {} : { detail: papers }),
          group: sexes.get(entry.id)?.sex === undefined ? "Not yet placed" : "On the papers",
        };
      }),
  ];

  const damOptions: SearchOption[] = animals
    .filter((animal) => animal.sex === "female" && animal.status === "active")
    .map((animal) => ({
      value: animal.id,
      label: displayName(animal),
      ...(animal.tagNumber === undefined ? {} : { detail: animal.tagNumber }),
    }));

  return (
    <div className="flex flex-col gap-density">
      <Section
        title="Try a pairing"
        description="Nothing here is saved. It is the look you take before you pull the straw."
      >
        <div className="grid grid-cols-1 gap-density sm:grid-cols-2">
          <SearchSelect
            label="Sire"
            hint="Bulls only — ours and the ones on the papers. Type any part of a name or a number."
            value={sireKey}
            placeholder="Choose a bull"
            options={sireOptions}
            onChange={setSireKey}
          />
          <SearchSelect
            label="Dam"
            hint="Active cows here."
            value={damId}
            placeholder="Choose a cow"
            options={damOptions}
            onChange={setDamId}
          />
        </div>
      </Section>

      {!chosen ? (
        <EmptyState
          title="Pick a sire and a dam"
          detail="You will get the calf's breeding, the colors it can be, how close the two are, and what defects the pairing could carry."
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

            {composition.length === 0 ? null : (
              <Card title="What it could be papered as">
                <div className="flex flex-col gap-3">
                  {eligibility.classes.map((entry) => (
                    <div key={`${entry.association}-${entry.name}`} className="flex flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <Pill tone="identity">{entry.association}</Pill>
                        <span className="text-density font-medium text-ink">{entry.name}</span>
                      </span>
                      <span className="text-sm text-muted">{entry.because}</span>
                      {entry.alsoRequires === undefined
                        ? null
                        : entry.alsoRequires.map((condition) => (
                            <span key={condition} className="text-sm text-muted">
                              · also needs: {condition}
                            </span>
                          ))}
                    </div>
                  ))}

                  {upgrade === undefined ? null : (
                    <div className="flex flex-col gap-1 border-t border-edge pt-3">
                      <span className="flex flex-wrap items-center gap-2">
                        <Pill tone="identity">AMAA</Pill>
                        <span className="text-density font-medium text-ink">
                          Upgrading chart: {upgrade.label}
                        </span>
                        {upgrade.paper === undefined ? null : (
                          <Pill tone={upgrade.paper === "High Maine" ? "calm" : "neutral"}>
                            {upgrade.paper} papers
                          </Pill>
                        )}
                      </span>
                      {/*
                        The chart is a lookup on the parents' registered
                        classes, not a calculation on the calf's percentage,
                        and it is more generous than halving in places — a
                        Fullblood bull on a 3/8 cow gives 11/16 by arithmetic
                        and registers as 3/4. Shown beside the percentage
                        rather than instead of it, because a breeder needs
                        both: one is what the calf is, the other is what the
                        association will paper it as.
                      */}
                      <span className="text-sm text-muted">
                        Off the AMAA upgrading chart, which is a lookup on both parents&apos;
                        classes rather than a sum — it is more generous than halving in places, and
                        it is what papers actually get issued on.
                      </span>
                      {upgrade.conditions.map((condition) => (
                        <span key={condition} className="text-sm text-muted">
                          · {condition}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            )}
          </Section>

          <Section
            title="What color"
            description="Both loci together. Roan has no color of its own — it takes the one Extension gave it, so black through roan is a blue roan. Worked out from the parents' coats and pedigrees; a hair card sharpens it but is not needed."
          >
            {calfColour === undefined || calfColour.outcomes.length === 0 ? (
              <EmptyState
                title="Nothing to go on yet"
                detail={
                  sireCoat === undefined
                    ? "That bull is not on file, so there is no coat and no pedigree to work from."
                    : damCoat === undefined
                      ? "That cow is not on file, so there is no coat and no pedigree to work from."
                      : "Neither parent's coat is recorded and neither has a pedigree that settles one. A colour on each of them is usually enough — red is e/e outright, and roan is R/r."
                }
              />
            ) : (
              <div className="flex flex-col gap-density">
                <Card>
                  <div className="flex flex-col gap-3">
                    {calfColour.outcomes.map((outcome) => (
                      <div key={outcome.name} className="flex flex-col gap-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-density text-ink">{outcome.name}</span>
                          <Pill tone="action">{percent(outcome.chance)}</Pill>
                        </div>
                        <Meter value={outcome.chance} tone="action" />
                      </div>
                    ))}
                    {calfColour.missing.length === 0 ? null : (
                      <ul className="flex flex-col gap-1 text-sm text-muted">
                        {calfColour.missing.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </Card>

                {colour === undefined ? null : (
                <Card title="Off the hair cards">
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
                )}

                {/*
                  The squares themselves, where both parents are hair-carded. A
                  breeder reads four boxes and checks them; a bar chart of
                  percentages has to be taken on trust. Shown only for typed
                  parents because a square drawn over an unsettled pair would
                  be four boxes of guesswork wearing the same clothes.
                */}
                <div className="grid grid-cols-1 gap-density md:grid-cols-2">
                  {colour?.extensionSquare === undefined ? null : (
                    <PunnettTable
                      title="Extension — black or red"
                      square={colour.extensionSquare.map((row) =>
                        row.map((cell) => writeExtension(cell.genotype)),
                      )}
                      sire={sireProfile?.coatGenotype?.extension ?? []}
                      dam={damProfile?.coatGenotype?.extension ?? []}
                    />
                  )}
                  {colour?.roanSquare === undefined ? null : (
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

                {colour === undefined ? null : (
                  <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted">
                    {colour.caveats.map((caveat) => (
                      <li key={caveat}>{caveat}</li>
                    ))}
                  </ul>
                )}
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
