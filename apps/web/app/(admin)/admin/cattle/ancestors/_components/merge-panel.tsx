"use client";

import { useMemo, useState } from "react";

import {
  Button,
  Callout,
  Pill,
  SearchSelect,
  useConfirmDelete,
  useToast,
} from "@galaxy-farm/ui";
import type { Ulid } from "@galaxy-farm/core";
import {
  allRegistrations,
  cattleProfileSchema,
  externalAnimalSchema,
  planAncestorMerge,
  type CattleProfile,
  type ExternalAnimal,
} from "@galaxy-farm/module-cattle";

import { useMutations } from "@/lib/local/mutations";

/**
 * Folding two records for one animal into one (spec §5.2, §4.5 clause 3).
 *
 * The situation this exists for: the same cow imported from two associations
 * before anything could join them. Different registries, different numbers,
 * nothing about either connecting them — so she is on file twice, each copy
 * holding half her descendants, and neither pedigree showing the whole line.
 *
 * The kept record gains every registration number and every field it does not
 * already have, and loses nothing. Where both hold a value the kept one wins
 * and the difference is *reported* — a merge cannot be undone, and quietly
 * preferring one of two hand-typed values is the kind of thing nobody would
 * ever notice going wrong.
 *
 * Everything that pointed at the record being dropped is repointed first, then
 * that record is deleted. In that order: a pedigree that briefly points at
 * nothing is a pedigree that renders as a gap, and somebody watching the
 * screen would see the tree lose a branch.
 */

export function MergeAncestors({
  keep,
  others,
  profiles,
  animalNames,
  propertyId,
  actorId,
  onDone,
}: {
  readonly keep: ExternalAnimal;
  readonly others: readonly ExternalAnimal[];
  readonly profiles: readonly CattleProfile[];
  readonly animalNames: ReadonlyMap<Ulid, string>;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly onDone: () => void;
}) {
  const externals = useMutations<ExternalAnimal>(
    "externalAnimals",
    "externalAnimals",
    externalAnimalSchema,
    propertyId,
    actorId,
  );
  const cattle = useMutations<CattleProfile>(
    "cattleProfiles",
    "cattleProfiles",
    cattleProfileSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [chosen, setChosen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const drop = others.find((entry) => entry.id === chosen);

  const plan = useMemo(
    () =>
      drop === undefined
        ? undefined
        : planAncestorMerge(
            keep,
            drop,
            profiles.map((profile) => ({
              id: profile.id,
              label: animalNames.get(profile.animalId) ?? "an animal",
              sire: profile.sire,
              dam: profile.dam,
            })),
            others,
          ),
    [keep, drop, profiles, others, animalNames],
  );

  async function merge() {
    if (drop === undefined || plan === undefined) return;

    const confirmed = await confirmDelete({
      tier: "typed",
      recordName: drop.name,
      entity: "ancestor",
      dependents: plan.repoint.map((reference) => ({
        entity: reference.kind === "profile" ? "animal" : "ancestor",
        label: reference.label,
        // "detached" is the closest of the two the dialog knows: each of these
        // loses its reference to the record being dropped. It gains one to the
        // record being kept in the same breath, which the consequence says.
        effect: "detached" as const,
      })),
      consequence:
        `${drop.name} will be deleted and everything that named it will point at ${keep.name} ` +
        `instead. This cannot be undone.`,
      action: "Merge",
    });
    if (!confirmed) return;

    setBusy(true);
    try {
      // The kept record first, then the references, then the delete. A
      // pedigree that briefly points at a deleted animal renders as a gap, and
      // anybody watching would see the tree lose a branch.
      const updated = await externals.update(keep.id, plan.patch);
      if (!updated.ok) {
        setError("Could not update the record being kept.");
        return;
      }

      for (const reference of plan.repoint) {
        const patch = { [reference.role]: { kind: "external", id: keep.id } };
        const result =
          reference.kind === "profile"
            ? await cattle.update(reference.id, patch as Partial<CattleProfile>)
            : await externals.update(reference.id, patch as Partial<ExternalAnimal>);
        if (!result.ok) {
          setError(`Could not repoint ${reference.label}. Nothing has been deleted.`);
          return;
        }
      }

      await externals.remove(drop.id, `Merged into ${keep.name}`);
      show({
        message: `${drop.name} merged into ${keep.name}`,
        tone: "success",
      });
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-density">
      <SearchSelect
        label="The other record for this animal"
        hint="Type a name or a registration number. The one you pick is the one that gets deleted."
        value={chosen}
        placeholder="Search the ancestors"
        options={others.map((entry) => {
          const papers = allRegistrations(entry)
            .map((registration) => `${registration.association} ${registration.regNumber}`)
            .join(" · ");
          return {
            value: entry.id,
            label: entry.name,
            ...(papers === "" ? {} : { detail: papers }),
          };
        })}
        onChange={setChosen}
      />

      {plan === undefined || drop === undefined ? null : (
        <>
          <div className="flex flex-col gap-2">
            <p className="text-density text-ink">
              <strong>{keep.name}</strong> keeps its record and gains:
            </p>
            <span className="flex flex-wrap gap-1.5">
              {(plan.patch.registrations ?? []).map((registration) => (
                <Pill
                  key={`${registration.association}-${registration.regNumber}`}
                  tone={
                    allRegistrations(keep).some(
                      (known) => known.regNumber === registration.regNumber,
                    )
                      ? "neutral"
                      : "calm"
                  }
                >
                  {registration.association} {registration.regNumber}
                </Pill>
              ))}
            </span>
            <p className="text-sm text-muted">
              {Object.keys(plan.patch).filter((field) => field !== "registrations").length === 0
                ? "No other blank fields to fill in."
                : `Filling in: ${Object.keys(plan.patch)
                    .filter((field) => field !== "registrations")
                    .join(", ")}.`}
            </p>
          </div>

          {plan.repoint.length === 0 ? (
            <p className="text-sm text-muted">Nothing names {drop.name}, so nothing moves.</p>
          ) : (
            <div className="flex flex-col gap-1">
              <p className="text-density text-ink">
                {plan.repoint.length} pedigree
                {plan.repoint.length === 1 ? "" : "s"} will point at {keep.name} instead:
              </p>
              <span className="flex flex-wrap gap-1.5">
                {plan.repoint.map((reference) => (
                  <Pill key={`${reference.kind}-${reference.id}-${reference.role}`}>
                    {reference.label} · {reference.role}
                  </Pill>
                ))}
              </span>
            </div>
          )}

          {plan.warnings.length === 0 ? null : (
            <Callout tone="action" title="The two records disagree">
              <ul className="flex flex-col gap-1">
                {plan.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
              Nothing on the kept record is overwritten — this is only so you know what is being
              set aside. A merge cannot be undone.
            </Callout>
          )}
        </>
      )}

      {error === undefined ? null : (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2 border-t border-edge pt-density">
        <Button onClick={() => void merge()} busy={busy} disabled={drop === undefined}>
          Merge them
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
