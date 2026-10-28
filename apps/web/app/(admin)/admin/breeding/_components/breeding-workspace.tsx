"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Button, EmptyState, PageBody, PageHeader, useToast } from "@galaxy-farm/ui";
import { displayName, type Animal, type Ulid } from "@galaxy-farm/core";
import {
  allRegistrations,
  canBe,
  inferAncestorSexes,
  plannedMatingSchema,
  tankLocation,
  type BreedingMethod,
  type BreedingRecord,
  type CalvingRecord,
  type CattleProfile,
  type ExternalAnimal,
  type ParentRef,
  type PlannedMating,
  type SemenInventory,
} from "@galaxy-farm/module-cattle";

import { Pane, PICK_LIST, PickRow } from "@/app/(admin)/admin/breeding/_components/pane";
import { SirePane, type SireOption } from "@/app/(admin)/admin/breeding/_components/sire-pane";
import {
  analysePairing,
  cowsToBreed,
  seasonOf,
  sireFlag,
} from "@/app/(admin)/admin/breeding/_components/workspace-logic";

import { coatResolver } from "@/lib/coat";
import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";
import { usePedigreeSource } from "@/lib/pedigree-source";
import { breedingSire, parseSire, sireValue, type SireLookup } from "@/lib/sires";

/**
 * The breeding workspace (spec §5.2): one desk screen for the seasonal job.
 *
 * Breeding is decided once a year, at a desk, with the catalog, the ancestors
 * and the tank all open at once — and on the old screens that meant three tabs
 * and a whiteboard. Here it is three panes read left to right: which cows need
 * a bull this season, which bull, and what the calf would be. The last pane
 * answers with the pairing planner's own functions, boiled down to one line
 * each; the planner itself, with its Punnett squares, stays on the breeding
 * log for anybody who wants the working.
 *
 * "Plan this mating" writes a planned mating through the same mutation the
 * genetic roadmap uses, so the plan shows up there and becomes the breeding
 * record in one tap when the cow is actually bred.
 */

const LINK = "text-sm font-medium text-action underline underline-offset-4";

const LINKS: readonly { href: string; label: string }[] = [
  { href: "/admin/cattle/ancestors", label: "Ancestors" },
  { href: "/admin/cattle/supplies", label: "Semen tank" },
  { href: "/admin/cattle/catalog", label: "Catalog" },
  { href: "/admin/cattle/breeding", label: "Breeding log" },
  { href: "/admin/cattle/roadmap", label: "Roadmap" },
];

/** The picker value a plan's sire reads back as — the straw, if it named one. */
function planKey(plan: PlannedMating | undefined): string | undefined {
  if (plan === undefined) return undefined;
  if (plan.semenInventoryId !== undefined) return sireValue("straw", plan.semenInventoryId);
  if (plan.bullId !== undefined) return sireValue("bull", plan.bullId);
  if (plan.sireExternalId !== undefined) return sireValue("external", plan.sireExternalId);
  return undefined;
}

export function BreedingWorkspace({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const query = { propertyId };
  const { records: animals } = useRecords<Animal>("animals", query);
  const { records: profiles } = useRecords<CattleProfile>("cattleProfiles", query);
  const { records: outsiders } = useRecords<ExternalAnimal>("externalAnimals", query);
  const { records: breedings } = useRecords<BreedingRecord>("breedingRecords", query);
  const { records: calvings } = useRecords<CalvingRecord>("calvingRecords", query);
  const { records: plans } = useRecords<PlannedMating>("plannedMatings", query);
  const { records: straws } = useRecords<SemenInventory>("semenInventory", query);

  // The roadmap's own mutation: one write path for a planned mating.
  const plansApi = useMutations<PlannedMating>(
    "plannedMatings",
    "plannedMatings",
    plannedMatingSchema,
    propertyId,
    actorId,
  );
  const { show } = useToast();

  const now = useMemo(() => new Date(), []);
  const season = seasonOf(now);

  const cows = useMemo(
    () => cowsToBreed({ animals, profiles, breedings, calvings, plans, now }),
    [animals, profiles, breedings, calvings, plans, now],
  );

  const [cowId, setCowId] = useState<Ulid | undefined>();
  // Undefined means "whatever her plan says", so picking a planned cow shows
  // her planned bull without a second tap.
  const [sireKey, setSireKey] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const cow = cows.find((entry) => entry.animal.id === cowId) ?? cows[0];
  const chosenKey = sireKey ?? planKey(cow?.plan);

  const profileOf = useMemo(
    () => new Map(profiles.map((profile) => [profile.animalId, profile])),
    [profiles],
  );
  const outsiderOf = useMemo(
    () => new Map(outsiders.map((outsider) => [outsider.id, outsider])),
    [outsiders],
  );
  const lookup: SireLookup = useMemo(
    () => ({ animals, outsiders, straws }),
    [animals, outsiders, straws],
  );

  /** A sire's tests, or undefined when there is no record to read them off. */
  const testsOf = (ref: ParentRef | undefined) =>
    ref === undefined
      ? undefined
      : ref.kind === "animal"
        ? profileOf.get(ref.id)?.geneticTests
        : outsiderOf.has(ref.id)
          ? (outsiderOf.get(ref.id)?.geneticTests ?? [])
          : undefined;

  const hornOf = (ref: ParentRef | undefined) =>
    ref === undefined
      ? undefined
      : ref.kind === "animal"
        ? profileOf.get(ref.id)?.hornStatus
        : outsiderOf.get(ref.id)?.hornStatus;

  const strawRef = (straw: SemenInventory): ParentRef | undefined =>
    straw.sireAnimalId !== undefined
      ? { kind: "animal", id: straw.sireAnimalId }
      : straw.sireExternalId !== undefined
        ? { kind: "external", id: straw.sireExternalId }
        : undefined;

  // The tank, most stocked first — empty canes last but still listed, since a
  // plan can be made for semen that is on order.
  const tank: SireOption[] = [...straws]
    .sort(
      (left, right) =>
        right.strawsOnHand - left.strawsOnHand || left.sireName.localeCompare(right.sireName),
    )
    .map((straw) => ({
      key: sireValue("straw", straw.id),
      name: straw.sireName,
      line: [
        straw.strawsOnHand === 0
          ? "none left"
          : `${straw.strawsOnHand} straw${straw.strawsOnHand === 1 ? "" : "s"}`,
        tankLocation(straw),
      ]
        .filter((part) => part !== undefined)
        .join(" · "),
      chip: sireFlag(testsOf(strawRef(straw))),
    }));

  // Bulls only: the sexes come from where each ancestor sits in a pedigree,
  // because a certificate has a sire column and no sex field.
  const sexes = useMemo(
    () => inferAncestorSexes(outsiders, [...profiles, ...outsiders]),
    [outsiders, profiles],
  );
  const onFile: SireOption[] = [
    ...animals
      .filter((a) => a.species === "cattle" && a.sex === "male" && a.status === "active")
      .map((bull) => ({
        key: sireValue("bull", bull.id),
        name: displayName(bull),
        line: ["Bull here", bull.tagNumber].filter(Boolean).join(" · "),
        chip: sireFlag(profileOf.get(bull.id)?.geneticTests),
      })),
    ...[...outsiders]
      .filter((entry) => canBe(sexes.get(entry.id), "male"))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => ({
        key: sireValue("external", entry.id),
        name: entry.name,
        line:
          allRegistrations(entry)
            .map((r) => `${r.association} ${r.regNumber}`)
            .join(" · ") || "On the papers",
        chip: sireFlag(entry.geneticTests ?? []),
      })),
  ];

  const choice = chosenKey === undefined ? undefined : parseSire(chosenKey);
  const sire = choice === undefined ? undefined : breedingSire(choice, lookup);
  const sireRef: ParentRef | undefined =
    sire?.bullId !== undefined
      ? { kind: "animal", id: sire.bullId }
      : sire?.sireExternalId !== undefined
        ? { kind: "external", id: sire.sireExternalId }
        : undefined;
  const damRef: ParentRef | undefined =
    cow === undefined ? undefined : { kind: "animal", id: cow.animal.id };

  const source = usePedigreeSource({ animals, profiles, outsiders });
  const coats = useMemo(() => coatResolver({ profiles, outsiders }), [profiles, outsiders]);

  const pairing =
    sireRef === undefined || damRef === undefined
      ? undefined
      : analysePairing({
          sireRef,
          damRef,
          sireTests: testsOf(sireRef),
          damTests: testsOf(damRef),
          sireCoat: coats.of(sireRef),
          damCoat: coats.of(damRef),
          sireHorn: hornOf(sireRef),
          damHorn: hornOf(damRef),
          source,
        });

  const cowName = cow === undefined ? undefined : displayName(cow.animal);
  const sireName = sire?.sireName;
  const alreadyPlanned = cow?.plan !== undefined && planKey(cow.plan) === chosenKey;

  async function planMating() {
    if (cow === undefined || choice === undefined || sire === undefined) return;
    // A straw or a catalog bull is AI; a bull standing here is natural service.
    const method: BreedingMethod = choice.kind === "bull" ? "natural" : "AI";
    const sireFields = {
      semenInventoryId: sire.semenInventoryId,
      bullId: sire.bullId,
      sireExternalId: sire.sireExternalId,
    };

    setBusy(true);
    try {
      // Her open plan is re-pointed rather than doubled: two open plans for
      // one cow is a question the roadmap cannot answer for anybody.
      const result =
        cow.plan === undefined
          ? await plansApi.create({
              damId: cow.animal.id,
              method,
              ...Object.fromEntries(
                Object.entries(sireFields).filter(([, value]) => value !== undefined),
              ),
              targetSeason: season,
              planStatus: "open",
            } as never)
          : await plansApi.update(cow.plan.id, { method, ...sireFields });

      if (!result.ok) {
        show({ message: "Could not save that plan", tone: "danger" });
        return;
      }
      setSireKey(undefined);
      show({
        message: `Planned: ${cowName ?? "her"} × ${sireName ?? "this bull"}`,
        tone: "success",
      });
    } finally {
      setBusy(false);
    }
  }

  const planned = cows.filter((entry) => entry.plan !== undefined).length;
  const strawCount = straws.reduce((sum, straw) => sum + straw.strawsOnHand, 0);

  return (
    <PageBody>
      <div className="flex flex-col gap-density">
        <PageHeader
          eyebrow="More"
          title={`Breeding · ${season}`}
          subtitle={`${planned} of ${cows.length} cows planned · ${strawCount} straw${strawCount === 1 ? "" : "s"} in the tank`}
          meta={
            <nav aria-label="Breeding records" className="flex flex-wrap gap-x-4 gap-y-1">
              {LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`${LINK} inline-flex min-h-target items-center`}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          }
        />

        <div className="flex flex-wrap items-start gap-density">
          <Pane
            label="Cows to breed"
            title="1 · Cows to breed"
            line="Open, or calving before the season"
          >
            {cows.length === 0 ? (
              <EmptyState
                title="No cows to breed"
                detail="Every cow is carrying past the season."
              />
            ) : (
              <ul className={PICK_LIST}>
                {cows.map((entry) => (
                  <PickRow
                    key={entry.animal.id}
                    title={displayName(entry.animal)}
                    line={entry.line}
                    chip={
                      entry.plan === undefined
                        ? { label: "To plan", tone: "neutral" }
                        : { label: "Planned", tone: "calm" }
                    }
                    selected={entry.animal.id === cow?.animal.id}
                    onPick={() => {
                      setCowId(entry.animal.id);
                      setSireKey(undefined);
                    }}
                  />
                ))}
              </ul>
            )}
          </Pane>

          <SirePane
            cowName={cowName}
            tank={tank}
            onFile={onFile}
            outsiders={outsiders}
            selected={chosenKey}
            onPick={setSireKey}
          />

          <Pane
            label="This pairing"
            title={
              cowName === undefined || sireName === undefined
                ? "3 · The pairing"
                : `3 · ${cowName} × ${sireName}`
            }
            line="Predicted from both pedigrees"
          >
            {cow === undefined || choice === undefined ? (
              <p className="px-4 py-3 text-sm text-muted">Pick a cow and a sire.</p>
            ) : (
              <>
                {pairing === undefined ? (
                  // A straw typed in by name only: there is nobody on file to
                  // walk a pedigree from, and saying "no shared ancestors"
                  // would only mean nobody looked.
                  <p className="px-4 py-3 text-sm text-action">
                    This straw is not linked to a bull on file.{" "}
                    <Link href="/admin/cattle/supplies" className="underline">
                      Link it in the Semen tank
                    </Link>{" "}
                    to see the pairing.
                  </p>
                ) : (
                  <dl className="flex flex-col">
                    {pairing.facts.map((fact) => (
                      <div
                        key={fact.label}
                        className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 border-t border-rule px-4 py-3 first:border-t-0"
                      >
                        <dt className="text-sm text-muted">{fact.label}</dt>
                        <dd
                          className={
                            "text-right text-sm font-semibold " +
                            (fact.tone === "danger"
                              ? "text-danger"
                              : fact.tone === "action"
                                ? "text-action"
                                : "text-ink")
                          }
                        >
                          {fact.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}

                <div className="flex flex-col gap-2 border-t border-rule px-4 py-3">
                  {pairing?.refusal === undefined ? null : (
                    <p
                      role="alert"
                      className="rounded-density bg-danger/10 px-3 py-2 text-sm text-danger"
                    >
                      {pairing.refusal}
                    </p>
                  )}
                  <Button
                    variant="primary"
                    block
                    busy={busy}
                    disabled={alreadyPlanned}
                    onClick={() => void planMating()}
                  >
                    {alreadyPlanned
                      ? "Planned ✓"
                      : cow.plan === undefined
                        ? "Plan this mating"
                        : "Change her plan"}
                  </Button>
                  <span className="text-sm text-muted">
                    Goes on the{" "}
                    <Link href="/admin/cattle/roadmap" className="underline">
                      roadmap
                    </Link>
                    ; recorded as bred from there.
                  </span>
                </div>
              </>
            )}
          </Pane>
        </div>
      </div>
    </PageBody>
  );
}
