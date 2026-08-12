"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import {
  Button,
  Callout,
  Card,
  Constellation,
  DataTable,
  DetailList,
  EmptyState,
  Meter,
  Pill,
  SearchSelect,
  Section,
  TextInput,
  useConfirmDelete,
  useToast,
  type Column,
  type ConstellationNode,
  type SearchOption,
} from "@galaxy-farm/ui";
import { displayName, formatMoney, type Animal, type Ulid } from "@galaxy-farm/core";
import {
  allRegistrations,
  animalProfitAndLoss,
  breedingsFor,
  canBe,
  buildPedigree,
  calvingsFor,
  calvingInterval,
  cattleProfileSchema,
  daysBred,
  describeComposition,
  healthHistoryFor,
  inferAncestorSexes,
  isUnderWithdrawal,
  lifetimeGain,
  MAX_PEDIGREE_GENERATIONS,
  pedigreeDepth,
  projectedDueDate,
  repeatedAncestors,
  wouldCreateCycle,
  compositionTotal,
  isCompositionComplete,
  unadjusted205DayWeight,
  weightsFor,
  weightIn,
  withdrawalEndDate,
  type AcquisitionRecord,
  type BreedingRecord,
  type BreedShare,
  type CalvingRecord,
  type CattleProfile,
  type ExternalAnimal,
  type HealthRecord,
  type ParentRef,
  type PedigreeNode,
  type PedigreeSource,
  type ProcessingRecord,
  type SaleRecord,
  type WeightRecord,
} from "@galaxy-farm/module-cattle";

import { useMutations } from "@/lib/local/mutations";
import { usePedigreeSource } from "@/lib/pedigree-source";
import { useRecords } from "@/lib/local/use-records";

/**
 * The per-animal tabs §7 asks for (issues #15, #16, #20).
 *
 * Each is a view over records that live elsewhere — nothing here is a second
 * store. The health tab reads the same `healthRecords` the health screen
 * writes, so a treatment logged in a chute is on her page before anybody
 * navigates.
 *
 * Split out of `animal-screen.tsx` because that file had grown past the point
 * where the page's own structure was visible in it.
 */

function formatDate(value: Date | undefined): string {
  return value === undefined
    ? "—"
    : value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function lb(value: number | undefined): string {
  return value === undefined ? "—" : `${Math.round(value)} lb`;
}

/* ------------------------------------------------------------------ breeds */

/**
 * The breed-composition editor (issue #15).
 *
 * Percentages, not fractions: "½ Maine ¼ Chi ¼ Shorthorn" is written 50/25/25
 * on every paper this farm will handle, and a three-way split with a third in
 * it has no exact fractional form anyway.
 *
 * The running total is shown while editing rather than only on save. A
 * composition that does not reach 100 is refused by the schema — an animal
 * recorded as 50% Maine and nothing else means the other half was *forgotten*,
 * not that it is unknown, and it would misstate a percentage on a sale sheet.
 */
export function BreedComposition({
  animal,
  profile,
  propertyId,
  actorId,
}: {
  readonly animal: Animal;
  readonly profile: CattleProfile | undefined;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const api = useMutations<CattleProfile>(
    "cattleProfiles",
    "cattleProfiles",
    cattleProfileSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [breed, setBreed] = useState("");
  const [percent, setPercent] = useState("");
  const [busy, setBusy] = useState(false);

  const shares = profile?.breedComposition ?? [];
  const total = compositionTotal(shares);
  const complete = isCompositionComplete(shares);

  async function save(next: readonly BreedShare[]) {
    setBusy(true);
    try {
      if (profile === undefined) {
        await api.create({
          animalId: animal.id,
          breedComposition: next,
          registrations: [],
        } as never);
        return;
      }
      await api.update(profile.id, { breedComposition: next } as Partial<CattleProfile>);
    } finally {
      setBusy(false);
    }
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (breed.trim() === "" || percent === "") return;

    await save([...shares, { breed: breed.trim(), percent: Number(percent) }]);
    setBreed("");
    setPercent("");
  }

  async function drop(share: BreedShare) {
    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: `${share.percent}% ${share.breed}`,
      entity: "breed share",
      dependents: [],
      consequence: complete
        ? "The composition will no longer add to 100%, and will not save until it does."
        : undefined,
      action: "Remove",
    });
    if (!confirmed) return;

    await save(shares.filter((entry) => entry !== share));
    show({ message: `${share.breed} removed` });
  }

  return (
    <Section
      title="Breed composition"
      description="Percentages as they are written on the papers. It has to add to 100 — a partial composition means half was forgotten, not that it is unknown."
    >
      {shares.length === 0 ? (
        <EmptyState
          title="No composition recorded"
          detail="Plenty of commercial cattle arrive with nobody's idea of what they are. Add the shares you know."
        />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-density text-ink">{describeComposition(shares)}</p>
          {shares.map((share) => (
            <div key={`${share.breed}-${share.percent}`} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-3">
                <span className="text-density text-ink">{share.breed}</span>
                <span className="flex items-center gap-2">
                  <Pill tone="identity">{share.percent}%</Pill>
                  <Button variant="ghost" onClick={() => void drop(share)}>
                    Remove
                  </Button>
                </span>
              </div>
              <Meter value={share.percent / 100} tone="identity" />
            </div>
          ))}

          <p
            className={`text-sm ${complete ? "text-calm" : "text-danger"}`}
            role={complete ? undefined : "alert"}
          >
            {complete
              ? "Adds to 100%."
              : `Adds to ${total}% — this will not save until it reaches 100.`}
          </p>
        </div>
      )}

      <form onSubmit={(event) => void add(event)} className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <TextInput
            label="Breed"
            value={breed}
            onChange={(event) => setBreed(event.target.value)}
          />
        </div>
        <TextInput
          label="Percent"
          type="number"
          inputMode="decimal"
          value={percent}
          onChange={(event) => setPercent(event.target.value)}
        />
        <Button type="submit" busy={busy}>
          Add breed
        </Button>
      </form>
    </Section>
  );
}

/* ---------------------------------------------------------------- pedigree */

/**
 * The pedigree, drawn as a constellation (issue #16, §8).
 *
 * Depth-limited for two reasons and the second is not theoretical: §5.2 asks
 * for a 3/4/5-generation view, and a pedigree can genuinely contain a cycle
 * once somebody mistypes a registration number and makes an animal its own
 * great-grandsire. `buildPedigree` bounds the walk; this only draws it.
 *
 * Two renderings of one tree, and both are load-bearing. The chart is what §8
 * asks for and what somebody hands a buyer. The nested list underneath is what
 * a screen reader reads, what survives a page break in print, and what anybody
 * checking a registration number against a certificate will actually use — a
 * chart is a poor place to compare sixteen numbers.
 */
export function Pedigree({
  animal,
  profile,
  propertyId,
  actorId,
}: {
  readonly animal: Animal;
  readonly profile: CattleProfile | undefined;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const query = { propertyId };
  const { records: animals } = useRecords<Animal>("animals", query);
  const { records: profiles } = useRecords<CattleProfile>("cattleProfiles", query);
  const { records: outsiders } = useRecords<ExternalAnimal>("externalAnimals", query);
  const [generations, setGenerations] = useState(4);

  const source = usePedigreeSource({ animals, profiles, outsiders });
  const self: ParentRef = { kind: "animal", id: animal.id };

  const tree = buildPedigree(self, source, generations);
  const hasParents = profile?.sire !== undefined || profile?.dam !== undefined;
  // Repeats are counted over the full depth, not the displayed one, so
  // switching from 5 generations to 3 does not make line breeding vanish.
  const repeats = repeatedAncestors(buildPedigree(self, source, MAX_PEDIGREE_GENERATIONS));
  const depth = pedigreeDepth(buildPedigree(self, source, MAX_PEDIGREE_GENERATIONS));

  return (
    <div className="flex flex-col gap-density">
      <Section
        title="Pedigree"
        description="As far back as the papers go. Ancestors that are not ours are held as external animals — a five-generation tree has thirty of them and this farm owns two."
        actions={
          <span className="gf-no-print flex flex-wrap items-center gap-2">
            {[3, 4, 5].map((n) => (
              <Button
                key={n}
                variant={n === generations ? "primary" : "ghost"}
                onClick={() => setGenerations(n)}
              >
                {n} gen
              </Button>
            ))}
            {/*
              A pedigree is something you hand to a buyer (#16). The browser's
              own print is the right mechanism — it already knows about paper
              sizes and margins — so this triggers it and the print stylesheet
              in the theme drops the navigation and the buttons.
            */}
            <Button variant="ghost" onClick={() => window.print()}>
              Print
            </Button>
          </span>
        }
      >
        {!hasParents || tree === undefined ? (
          <EmptyState
            title="No pedigree recorded"
            detail="Set the sire and dam below, and everything above them follows from the ancestors already on file."
          />
        ) : (
          <div className="flex flex-col gap-density">
            <Constellation
              root={toConstellation(tree, repeats)}
              generations={generations}
              caption={
                <>
                  {depth === 0
                    ? "No ancestors recorded."
                    : `Papers go back ${depth} generation${depth === 1 ? "" : "s"}.`}{" "}
                  Filled stars are ours, hollow ones are on paper only
                  {repeats.size === 0 ? "" : ", and the coloured ones appear more than once"}.
                </>
              }
            />

            {repeats.size === 0 ? null : (
              <Callout tone="identity" title="Line breeding in this pedigree">
                {repeats.size} ancestor{repeats.size === 1 ? "" : "s"} appear
                {repeats.size === 1 ? "s" : ""} more than once. That is ordinary in show cattle —
                but it is also how a mistyped registration number shows itself, so it is worth a
                look at the numbers.
              </Callout>
            )}

            {/*
              The same tree as a nested list. Not a fallback nobody sees: it is
              what a screen reader reads, what the print stylesheet keeps when
              the chart is cut off by a page break, and what somebody checks a
              registration number against.
            */}
            <details className="rounded-density border border-edge bg-panel p-density">
              <summary className="cursor-pointer text-density font-medium text-ink">
                Read it as a list
              </summary>
              <div className="pt-density">
                <PedigreeBranch node={tree} />
              </div>
            </details>
          </div>
        )}
      </Section>

      <Parents
        animal={animal}
        profile={profile}
        profiles={profiles}
        animals={animals}
        outsiders={outsiders}
        source={source}
        propertyId={propertyId}
        actorId={actorId}
      />
    </div>
  );
}

/** The module's tree, flattened into the shape the chart draws. */
function toConstellation(
  node: PedigreeNode,
  repeats: ReadonlyMap<string, number>,
): ConstellationNode {
  const key = `${node.ref.kind}:${node.ref.id}`;
  return {
    id: key,
    label: node.name,
    ...(node.regNumber === undefined ? {} : { sublabel: node.regNumber }),
    outside: node.ref.kind === "external",
    repeated: repeats.has(key),
    ...(node.sire === undefined ? {} : { sire: toConstellation(node.sire, repeats) }),
    ...(node.dam === undefined ? {} : { dam: toConstellation(node.dam, repeats) }),
  };
}

/**
 * Setting a sire and a dam (issue #16).
 *
 * Either parent can be one of ours or a name off a certificate, which is why
 * both dropdowns list the herd and the ancestors together rather than making
 * somebody pick a category first. A loop is refused here rather than survived
 * by the chart — `wouldCreateCycle` is the same function the ancestors screen
 * calls, so the two cannot disagree about what a loop is.
 */
function Parents({
  animal,
  profile,
  profiles,
  animals,
  outsiders,
  source,
  propertyId,
  actorId,
}: {
  readonly animal: Animal;
  readonly profile: CattleProfile | undefined;
  readonly profiles: readonly CattleProfile[];
  readonly animals: readonly Animal[];
  readonly outsiders: readonly ExternalAnimal[];
  readonly source: PedigreeSource;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const api = useMutations<CattleProfile>(
    "cattleProfiles",
    "cattleProfiles",
    cattleProfileSchema,
    propertyId,
    actorId,
  );
  const { show } = useToast();

  const refKey = (ref: ParentRef | undefined) => (ref === undefined ? "" : `${ref.kind}:${ref.id}`);
  const [sire, setSire] = useState(refKey(profile?.sire));
  const [dam, setDam] = useState(refKey(profile?.dam));
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  /**
   * Which ancestors are bulls and which are cows.
   *
   * A certificate has a sire column and a dam column rather than a sex field,
   * so this is worked out from where each animal sits in the pedigrees already
   * on file. It is what keeps a cow out of the sire list — and a cow recorded
   * as somebody's sire makes every relatedness figure and colour prediction
   * drawn afterwards wrong in a way that looks perfectly ordinary on screen.
   */
  const sexes = useMemo(
    () => inferAncestorSexes(outsiders, [...profiles, ...outsiders]),
    [outsiders, profiles],
  );

  const options = (sex: "male" | "female"): SearchOption[] => [
    ...animals
      .filter(
        (entry) =>
          entry.species === "cattle" &&
          entry.id !== animal.id &&
          (entry.sex === sex || entry.sex === "unknown"),
      )
      .map((entry) => ({
        value: `animal:${entry.id}`,
        label: displayName(entry),
        ...(entry.tagNumber === undefined ? {} : { detail: entry.tagNumber }),
        group: "Ours",
      })),
    ...[...outsiders]
      .filter((entry) => canBe(sexes.get(entry.id), sex))
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

  function parse(value: string): ParentRef | undefined {
    if (value === "") return undefined;
    const [kind, id] = value.split(":");
    return kind === "animal" || kind === "external" ? { kind, id: id as Ulid } : undefined;
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);

    const self: ParentRef = { kind: "animal", id: animal.id };
    const next = { sire: parse(sire), dam: parse(dam) };

    for (const [role, ref] of Object.entries(next)) {
      if (ref !== undefined && wouldCreateCycle(self, ref, source)) {
        setError(
          `${displayName(animal)} already appears above that animal, so it cannot also be the ${role}.`,
        );
        return;
      }
    }

    setBusy(true);
    try {
      const result =
        profile === undefined
          ? await api.create({
              animalId: animal.id,
              breedComposition: [],
              registrations: [],
              ...(next.sire === undefined ? {} : { sire: next.sire }),
              ...(next.dam === undefined ? {} : { dam: next.dam }),
            } as never)
          : // Sent explicitly rather than omitted, so clearing a parent clears it.
            await api.update(profile.id, next as Partial<CattleProfile>);

      if (!result.ok) {
        setError(
          result.error.kind === "validation"
            ? (result.error.issues[0]?.message ?? "That is not valid")
            : "Could not save that",
        );
        return;
      }
      show({ message: "Parents saved", tone: "success" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Sire and dam"
      description="Either can be one of ours or a name off a certificate. Everything above them is already on file."
      actions={
        <Link
          href="/admin/cattle/ancestors"
          className="text-sm text-action underline underline-offset-2"
        >
          Manage ancestors
        </Link>
      }
    >
      <form onSubmit={(event) => void save(event)} className="flex flex-col gap-density">
        <div className="grid grid-cols-1 gap-density sm:grid-cols-2">
          <SearchSelect
            label="Sire"
            hint="Bulls only. Type any part of a name or a registration number."
            value={sire}
            placeholder="Unknown"
            clearLabel="Unknown"
            options={options("male")}
            onChange={setSire}
          />
          <SearchSelect
            label="Dam"
            hint="Cows only."
            value={dam}
            placeholder="Unknown"
            clearLabel="Unknown"
            options={options("female")}
            onChange={setDam}
          />
        </div>

        {error === undefined ? null : (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        <div>
          <Button type="submit" busy={busy}>
            Save parents
          </Button>
        </div>
      </form>
    </Section>
  );
}

function PedigreeBranch({ node }: { readonly node: PedigreeNode }) {
  const parents = [node.sire, node.dam].filter(
    (entry): entry is PedigreeNode => entry !== undefined,
  );

  return (
    <ul className="flex flex-col gap-2 border-l border-edge pl-density">
      <li className="flex flex-wrap items-center gap-2">
        <span className="text-density font-medium text-ink">{node.name}</span>
        {node.regNumber === undefined ? null : <Pill>{node.regNumber}</Pill>}
        {node.ref.kind === "external" ? <Pill tone="neutral">outside</Pill> : null}
      </li>
      {parents.length === 0 ? null : (
        <li>
          {parents.map((parent) => (
            <PedigreeBranch key={`${parent.ref.kind}:${parent.ref.id}`} node={parent} />
          ))}
        </li>
      )}
    </ul>
  );
}

/* --------------------------------------------------------------- breeding */

export function BreedingTab({
  animal,
  propertyId,
}: {
  readonly animal: Animal;
  readonly propertyId: Ulid;
}) {
  const { records: breedings } = useRecords<BreedingRecord>("breedingRecords", { propertyId });
  const { records: calvings } = useRecords<CalvingRecord>("calvingRecords", { propertyId });

  const hers = breedingsFor(breedings, animal.id);
  const herCalvings = calvingsFor(calvings, animal.id);
  const interval = calvingInterval(calvings, animal.id);
  const now = new Date();

  return (
    <div className="flex flex-col gap-density">
      <Section
        title="Breeding"
        description="Every service, and the dates that follow from it."
        actions={
          <Link
            href={`/admin/cattle/breeding`}
            className="text-sm text-action underline underline-offset-2"
          >
            Breeding screen
          </Link>
        }
      >
        {hers.length === 0 ? (
          <EmptyState title="Never bred" detail="Record a service on the breeding screen." />
        ) : (
          <div className="flex flex-col gap-3">
            {hers.map((record) => (
              <Card key={record.id}>
                <DetailList
                  columns={3}
                  items={[
                    { label: "Bred", value: formatDate(record.date) },
                    { label: "Method", value: record.method },
                    { label: "Due", value: formatDate(projectedDueDate(record)) },
                    {
                      label: "Day",
                      value: daysBred(record, now) < 0 ? "—" : daysBred(record, now),
                    },
                    { label: "Check", value: record.pregCheck?.result ?? "not checked" },
                    { label: "Notes", value: record.notes, wide: true },
                  ]}
                />
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Calvings"
        description={
          interval === undefined
            ? "The calving history."
            : `${interval} days between the last two — the number that says whether a yearly interval is holding.`
        }
      >
        {herCalvings.length === 0 ? (
          <EmptyState title="Never calved" detail="Nothing recorded yet." />
        ) : (
          <div className="flex flex-col gap-3">
            {herCalvings.map((record) => (
              <Card key={record.id}>
                <DetailList
                  columns={3}
                  items={[
                    { label: "Calved", value: formatDate(record.date) },
                    { label: "Ease", value: record.calvingEase },
                    { label: "Vigour", value: record.vigour },
                    { label: "Birth weight", value: lb(record.birthWeightLb) },
                    { label: "Assisted", value: record.assisted ? "yes" : "no" },
                    { label: "Notes", value: record.notes, wide: true },
                  ]}
                />
              </Card>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

/* ----------------------------------------------------------------- health */

export function HealthTab({
  animal,
  propertyId,
}: {
  readonly animal: Animal;
  readonly propertyId: Ulid;
}) {
  const { records } = useRecords<HealthRecord>("healthRecords", { propertyId });
  const now = new Date();
  const hers = healthHistoryFor(records, animal.id);
  const held = hers.filter((record) => isUnderWithdrawal(record, now));

  const columns: readonly Column<HealthRecord>[] = [
    { key: "date", header: "Date", primary: true, render: (r) => formatDate(r.date) },
    { key: "type", header: "Type", render: (r) => r.type },
    { key: "product", header: "Product", render: (r) => r.product ?? "—" },
    {
      key: "withdrawal",
      header: "Withdrawal",
      render: (r) => {
        const ends = withdrawalEndDate(r);
        if (ends === undefined) return <span className="text-muted">None</span>;
        return isUnderWithdrawal(r, now) ? (
          <Pill tone="danger" dot>
            until {formatDate(ends)}
          </Pill>
        ) : (
          <Pill tone="calm">cleared</Pill>
        );
      },
    },
    { key: "by", header: "By", render: (r) => r.administeredBy ?? "—" },
  ];

  return (
    <Section
      title="Health"
      description="Treatments, and the withdrawal each one starts."
      actions={
        // #17: two taps to a treatment. This link, then Record — the animal
        // arrives chosen, the date is today, and the product is the last one
        // used. A round of blackleg is forty calves and one bottle, and
        // re-picking that bottle forty times is forty chances to pick wrong.
        <Link
          href={`/admin/cattle/health?animal=${animal.id}`}
          className="text-sm text-action underline underline-offset-2"
        >
          Record a treatment
        </Link>
      }
    >
      {held.length === 0 ? null : (
        <Card title="Not clear for sale">
          <p className="text-density text-danger">
            {displayName(animal)} is inside a withdrawal period until{" "}
            {formatDate(
              held
                .map((record) => withdrawalEndDate(record) as Date)
                .sort((a, b) => b.getTime() - a.getTime())[0],
            )}
            .
          </p>
        </Card>
      )}

      <Card>
        <DataTable
          caption={`Health records for ${displayName(animal)}`}
          columns={columns}
          rows={hers}
          rowKey={(record) => record.id}
          empty={<EmptyState title="Nothing recorded" detail="No treatments on file for this animal." />}
        />
      </Card>
    </Section>
  );
}

/* ---------------------------------------------------------------- weights */

export function WeightsTab({
  animal,
  propertyId,
}: {
  readonly animal: Animal;
  readonly propertyId: Ulid;
}) {
  const { records } = useRecords<WeightRecord>("weightRecords", { propertyId });

  const series = weightsFor(records, animal.id);
  const birth = weightIn(records, animal.id, "birth");
  const weaning = weightIn(records, animal.id, "weaning");
  const adg = lifetimeGain(records, animal.id);
  const w205 =
    birth === undefined || weaning === undefined
      ? undefined
      : unadjusted205DayWeight(birth, weaning);
  const heaviest = Math.max(...series.map((entry) => entry.weightLb), 1);

  return (
    <Section
      title="Weights"
      description="Birth weights are the reliable ones. The 205-day figure is unadjusted — the age-of-dam and sex factors are not applied."
      actions={
        <Link
          href="/admin/cattle/weights"
          className="text-sm text-action underline underline-offset-2"
        >
          Weights screen
        </Link>
      }
    >
      {series.length === 0 ? (
        <EmptyState title="Never weighed" detail="Record one on the weights screen." />
      ) : (
        <div className="flex flex-col gap-density">
          <DetailList
            columns={3}
            items={[
              { label: "Birth", value: lb(birth?.weightLb) },
              { label: "Weaning", value: lb(weaning?.weightLb) },
              { label: "Latest", value: lb(series[series.length - 1]?.weightLb) },
              { label: "Lifetime ADG", value: adg === undefined ? "—" : `${adg.toFixed(2)} lb/d` },
              {
                label: "205-day, unadjusted",
                value: w205 === undefined ? "—" : lb(w205),
              },
              { label: "Weights taken", value: series.length },
            ]}
          />

          <div className="flex flex-col gap-2">
            {series.map((entry) => (
              <Meter
                key={entry.id}
                value={entry.weightLb / heaviest}
                tone={entry.context === "birth" ? "identity" : "action"}
                label={`${formatDate(entry.date)} · ${entry.context}`}
                detail={lb(entry.weightLb)}
              />
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

/* ---------------------------------------------------------------- finance */

export function FinanceTab({
  animal,
  propertyId,
}: {
  readonly animal: Animal;
  readonly propertyId: Ulid;
}) {
  const query = { propertyId };
  const { records: acquisitions } = useRecords<AcquisitionRecord>("acquisitionRecords", query);
  const { records: sales } = useRecords<SaleRecord>("saleRecords", query);
  const { records: health } = useRecords<HealthRecord>("healthRecords", query);
  const { records: processing } = useRecords<ProcessingRecord>("processingRecords", query);

  const pl = animalProfitAndLoss({
    animalId: animal.id,
    acquisitions,
    sales,
    health,
    processing,
  });

  return (
    <Section
      title="Finance"
      description="What it cost and what it brought."
      actions={
        <Link
          href="/admin/cattle/sales"
          className="text-sm text-action underline underline-offset-2"
        >
          Sales screen
        </Link>
      }
    >
      <DetailList
        columns={3}
        items={[
          { label: "Acquisition", value: formatMoney(pl.acquisitionCost) },
          { label: "Health", value: formatMoney(pl.healthCost) },
          { label: "Feed", value: formatMoney(pl.feedCost) },
          { label: "Breeding", value: formatMoney(pl.breedingCost) },
          { label: "Total cost", value: formatMoney(pl.totalCost) },
          { label: "Revenue", value: formatMoney(pl.totalRevenue) },
        ]}
      />

      <Card title={pl.net.cents >= 0 ? "In front" : "Behind"}>
        <p className="font-heading text-3xl font-semibold [font-variant-numeric:tabular-nums] text-ink">
          {formatMoney(pl.net)}
        </p>
        {pl.complete ? null : (
          // Said plainly rather than shown as a clean number. A home-raised
          // calf with no feed allocation shows a flattering profit that is
          // arithmetically right and practically misleading.
          <p className="pt-2 text-sm text-muted">
            One or more cost lines has no figure behind it yet — usually feed, which is apportioned
            in §5.3. Treat this as incomplete rather than as a profit.
          </p>
        )}
      </Card>
    </Section>
  );
}
