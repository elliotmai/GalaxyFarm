"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import type { ReactNode } from "react";

import {
  Button,
  EmptyState,
  Meter,
  Modal,
  PedigreeChart,
  Pill,
  SearchSelect,
  Section,
  StatRow,
  TagInput,
  TextInput,
  Tile,
  useConfirmDelete,
  useToast,
  type Ancestor,
  type SearchOption,
  type Tone,
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
  BREEDS,
  breedsFromComposition,
  breedsInUse,
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

import { facts, Row, Rows } from "@/app/(admin)/admin/cattle/[id]/_components/record-rows";
import { useMutations } from "@/lib/local/mutations";
import { usePedigreeSource } from "@/lib/pedigree-source";
import { useRecords } from "@/lib/local/use-records";

/**
 * The per-animal views §7 asks for (issues #15, #16, #20).
 *
 * Each is a view over records that live elsewhere — nothing here is a second
 * store. The health view reads the same `healthRecords` the health screen
 * writes, so a treatment logged in a chute is on her page before anybody
 * navigates.
 *
 * Records are rows (`record-rows.tsx`), the herd list's anatomy: what happened
 * in bold, one muted line of facts, at most one chip. They used to be a card
 * per record holding a grid of six labelled pairs, which on a phone is a
 * screen per breeding.
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

/** A link styled as a secondary button, for "go and record it over there". */
function ActionLink({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-target items-center rounded-density border border-edge bg-panel px-4 text-density font-medium text-ink hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
    >
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------------ breeds */

/**
 * The breed, in words (issue #15).
 *
 * More than one, because a crossbred animal is more than one — and separate
 * from the percentages, which come off the papers.
 */
export function BreedField({
  animal,
  profile,
  profiles = [],
  propertyId,
  actorId,
}: {
  readonly animal: Animal;
  readonly profile: CattleProfile | undefined;
  /** The rest of the herd, so its own spellings are offered first. */
  readonly profiles?: readonly CattleProfile[];
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
  const [busy, setBusy] = useState(false);

  const shares = profile?.breedComposition ?? [];
  const named = profile?.breed ?? [];
  /** What the makeup would say, so the field can show it rather than sit blank. */
  const derived = breedsFromComposition(shares);

  async function setBreeds(next: string[]) {
    setBusy(true);
    try {
      if (profile === undefined) {
        await api.create({
          animalId: animal.id,
          breed: next,
          breedComposition: [],
          registrations: [],
        } as never);
        return;
      }
      await api.update(profile.id, { breed: next } as Partial<CattleProfile>);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Breed">
      <TagInput
        label="Breed"
        value={named.length > 0 ? named : derived}
        onChange={(next) => void setBreeds(next)}
        disabled={busy}
        placeholder="Maine-Anjou"
        // What this farm already runs first, then the rest. Offering the
        // herd's own spellings is what stops "Maine Anjou" and "Maine-Anjou"
        // becoming two breeds nothing can filter across.
        suggestions={[...breedsInUse(profiles), ...BREEDS]}
        hint={
          named.length === 0 && derived.length > 0
            ? "From the percentages below. Type to override."
            : "Leave empty to use the percentages."
        }
      />
    </Section>
  );
}

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
      // The total is the fact this section exists to say, so it sits where a
      // subtitle would and turns red the moment it stops being 100.
      description={
        shares.length === 0 ? (
          "As written on the papers."
        ) : (
          <span
            className={complete ? "text-calm" : "text-danger"}
            role={complete ? undefined : "alert"}
          >
            {complete ? "Adds to 100%" : `Adds to ${total}% — will not save until 100`}
          </span>
        )
      }
    >
      {shares.length === 0 ? null : (
        <div className="flex flex-col gap-3">
          {shares.map((share) => (
            <div key={`${share.breed}-${share.percent}`} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <Meter
                  value={share.percent / 100}
                  tone="identity"
                  label={share.breed}
                  detail={`${share.percent}%`}
                />
              </div>
              <button
                type="button"
                aria-label={`Remove ${share.breed}`}
                onClick={() => void drop(share)}
                className="inline-flex min-h-target min-w-target shrink-0 items-center justify-center rounded-full text-muted hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-action"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={(event) => void add(event)} className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 basis-40">
          <TextInput
            label="Breed"
            value={breed}
            onChange={(event) => setBreed(event.target.value)}
          />
        </div>
        <div className="w-24">
          <TextInput
            label="Percent"
            type="number"
            inputMode="decimal"
            value={percent}
            onChange={(event) => setPercent(event.target.value)}
          />
        </div>
        <Button type="submit" busy={busy}>
          Add
        </Button>
      </form>
    </Section>
  );
}

/* ---------------------------------------------------------------- pedigree */

/**
 * The pedigree, drawn as a certificate bracket (issue #16, §8 v0.9).
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
  const [editing, setEditing] = useState(false);

  const source = usePedigreeSource({ animals, profiles, outsiders });
  const self: ParentRef = { kind: "animal", id: animal.id };

  const tree = buildPedigree(self, source, generations);
  const hasParents = profile?.sire !== undefined || profile?.dam !== undefined;
  // Repeats are counted over the full depth, not the displayed one, so
  // switching from 5 generations to 3 does not make line breeding vanish.
  const repeats = repeatedAncestors(buildPedigree(self, source, MAX_PEDIGREE_GENERATIONS));
  const depth = pedigreeDepth(buildPedigree(self, source, MAX_PEDIGREE_GENERATIONS));

  const editButton = (
    <Button variant="ghost" aria-haspopup="dialog" onClick={() => setEditing(true)}>
      Edit sire and dam
    </Button>
  );

  return (
    <div className="flex flex-col gap-density">
      <Section
        title="Pedigree"
        description={
          !hasParents || tree === undefined
            ? undefined
            : depth === 0
              ? "No ancestors recorded"
              : `Papers go back ${depth} generation${depth === 1 ? "" : "s"}`
        }
        actions={
          hasParents ? (
            <span className="gf-no-print flex flex-wrap items-center gap-1">
              {[3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={n === generations}
                  onClick={() => setGenerations(n)}
                  className={[
                    "inline-flex min-h-target items-center whitespace-nowrap rounded-full px-3 text-sm",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action",
                    n === generations
                      ? "bg-action/15 font-semibold text-action"
                      : "font-medium text-muted hover:bg-raised hover:text-ink",
                  ].join(" ")}
                >
                  {n} gen
                </button>
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
          ) : undefined
        }
      >
        {!hasParents || tree === undefined ? (
          <EmptyState
            title="No pedigree recorded"
            detail="Set the sire and dam, and everything above them follows from the ancestors on file."
            action={
              <Button variant="primary" aria-haspopup="dialog" onClick={() => setEditing(true)}>
                Set sire and dam
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-density">
            <Rows label="Parents">
              <Row
                title={tree.sire?.name ?? "Unknown"}
                line={facts("Sire", tree.sire?.regNumber)}
              />
              <Row title={tree.dam?.name ?? "Unknown"} line={facts("Dam", tree.dam?.regNumber)} />
            </Rows>
            <div className="gf-no-print flex flex-wrap items-center justify-between gap-2">
              {editButton}
              <Link
                href="/admin/cattle/ancestors"
                className="inline-flex min-h-target items-center text-sm text-action underline-offset-2 hover:underline"
              >
                Manage ancestors
              </Link>
            </div>

            {/* Line breeding is ordinary in show cattle — and it is also how a
                mistyped registration number shows itself, so it gets a line. */}
            {repeats.size === 0 ? null : (
              <p className="text-sm text-identity">
                {repeats.size} ancestor{repeats.size === 1 ? " appears" : "s appear"} more than once
                — check the numbers.
              </p>
            )}

            <PedigreeChart
              root={toAncestor(tree, repeats)}
              generations={generations}
              caption={<>Solid cells are ours; dashed are on paper only.</>}
            />

            {/*
              The same tree as a nested list. Not a fallback nobody sees: it is
              what a screen reader reads, what the print stylesheet keeps when
              the chart is cut off by a page break, and what somebody checks a
              registration number against.
            */}
            <details className="rounded-density border border-rule bg-panel p-density">
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

      {editing ? (
        <Parents
          animal={animal}
          profile={profile}
          profiles={profiles}
          animals={animals}
          outsiders={outsiders}
          source={source}
          propertyId={propertyId}
          actorId={actorId}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </div>
  );
}

/** The module's tree, flattened into the shape the chart draws. */
function toAncestor(node: PedigreeNode, repeats: ReadonlyMap<string, number>): Ancestor {
  const key = `${node.ref.kind}:${node.ref.id}`;
  return {
    id: key,
    label: node.name,
    ...(node.regNumber === undefined ? {} : { sublabel: node.regNumber }),
    outside: node.ref.kind === "external",
    repeated: repeats.has(key),
    ...(node.sire === undefined ? {} : { sire: toAncestor(node.sire, repeats) }),
    ...(node.dam === undefined ? {} : { dam: toAncestor(node.dam, repeats) }),
  };
}

/**
 * Setting a sire and a dam (issue #16), in a side panel.
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
  onClose,
}: {
  readonly animal: Animal;
  readonly profile: CattleProfile | undefined;
  readonly profiles: readonly CattleProfile[];
  readonly animals: readonly Animal[];
  readonly outsiders: readonly ExternalAnimal[];
  readonly source: PedigreeSource;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly onClose: () => void;
}) {
  const api = useMutations<CattleProfile>(
    "cattleProfiles",
    "cattleProfiles",
    cattleProfileSchema,
    propertyId,
    actorId,
  );
  const { show } = useToast();
  const formId = useId();

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
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      placement="side"
      title="Sire and dam"
      onClose={onClose}
      footer={
        <>
          <Button variant="primary" type="submit" form={formId} busy={busy}>
            Save parents
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => void save(event)}
        className="flex flex-col gap-density"
      >
        <SearchSelect
          label="Sire"
          hint="Bulls only. Name or registration number."
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

        {error === undefined ? null : (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </Modal>
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
        {node.regNumber === undefined ? null : (
          <span className="gf-numeric text-sm text-muted">{node.regNumber}</span>
        )}
        {node.ref.kind === "external" ? <span className="text-sm text-muted">outside</span> : null}
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

/** The preg check, as the one chip a service row is allowed. */
const CHECK_TONE: Record<string, Tone> = { bred: "calm", open: "danger", recheck: "action" };

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
        title="Services"
        description={hers.length === 0 ? undefined : `${hers.length} recorded`}
        actions={<ActionLink href="/admin/cattle/breeding">Breeding screen</ActionLink>}
      >
        {hers.length === 0 ? (
          <p className="text-sm text-muted">Never bred.</p>
        ) : (
          <Rows label="Services">
            {hers.map((record) => {
              const day = daysBred(record, now);
              const result = record.pregCheck?.result;
              return (
                <Row
                  key={record.id}
                  title={`Bred ${formatDate(record.date)}`}
                  line={facts(
                    record.method,
                    `due ${formatDate(projectedDueDate(record))}`,
                    day >= 0 && `day ${day}`,
                  )}
                  notes={record.notes}
                  chip={
                    result === undefined ? (
                      <Pill tone="neutral">Not checked</Pill>
                    ) : (
                      <Pill tone={CHECK_TONE[result] ?? "neutral"}>{capitalise(result)}</Pill>
                    )
                  }
                />
              );
            })}
          </Rows>
        )}
      </Section>

      <Section
        title="Calvings"
        // The interval is the number that says whether a yearly calving is
        // holding, so it is the fact beside the heading.
        description={interval === undefined ? undefined : `${interval} days between the last two`}
      >
        {herCalvings.length === 0 ? (
          <p className="text-sm text-muted">Never calved.</p>
        ) : (
          <Rows label="Calvings">
            {herCalvings.map((record) => (
              <Row
                key={record.id}
                title={`Calved ${formatDate(record.date)}`}
                line={facts(
                  `ease ${record.calvingEase}`,
                  `vigour ${record.vigour}`,
                  record.birthWeightLb === undefined ? undefined : lb(record.birthWeightLb),
                )}
                notes={record.notes}
                chip={record.assisted ? <Pill tone="action">Assisted</Pill> : undefined}
              />
            ))}
          </Rows>
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

  return (
    <Section
      title="Treatments"
      description={hers.length === 0 ? undefined : `${hers.length} on file`}
      actions={
        // #17: two taps to a treatment. This link, then Record — the animal
        // arrives chosen, the date is today, and the product is the last one
        // used. A round of blackleg is forty calves and one bottle, and
        // re-picking that bottle forty times is forty chances to pick wrong.
        <ActionLink href={`/admin/cattle/health?animal=${animal.id}`}>
          Record a treatment
        </ActionLink>
      }
    >
      {/* The withdrawal itself is the line above the tabs; here each record
          says only whether it is the one still holding her. */}
      {hers.length === 0 ? (
        <p className="text-sm text-muted">No treatments on file.</p>
      ) : (
        <Rows label={`Health records for ${displayName(animal)}`}>
          {hers.map((record) => {
            const ends = withdrawalEndDate(record);
            const held = ends !== undefined && isUnderWithdrawal(record, now);
            return (
              <Row
                key={record.id}
                title={record.product ?? capitalise(record.type)}
                line={facts(
                  formatDate(record.date),
                  record.product === undefined ? undefined : record.type,
                  record.administeredBy,
                  ends !== undefined && !held && "withdrawal cleared",
                )}
                chip={
                  held ? (
                    <Pill tone="danger" dot>
                      Until {formatDate(ends)}
                    </Pill>
                  ) : undefined
                }
              />
            );
          })}
        </Rows>
      )}
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
  const latest = series[series.length - 1];

  return (
    <Section
      title="Weights"
      description={
        series.length === 0
          ? undefined
          : `${series.length} weighing${series.length === 1 ? "" : "s"}`
      }
      actions={<ActionLink href="/admin/cattle/weights">Weights screen</ActionLink>}
    >
      {series.length === 0 ? (
        <p className="text-sm text-muted">Never weighed.</p>
      ) : (
        <div className="flex flex-col gap-density">
          <StatRow>
            <Tile
              label="Latest"
              value={lb(latest?.weightLb)}
              hint={latest === undefined ? undefined : formatDate(latest.date)}
            />
            <Tile label="Lifetime ADG" value={adg === undefined ? "—" : `${adg.toFixed(2)} lb/d`} />
            <Tile label="Birth" value={lb(birth?.weightLb)} />
            <Tile
              label="Weaning"
              value={lb(weaning?.weightLb)}
              // Unadjusted: the age-of-dam and sex factors are not applied, and
              // the label says so because the adjusted figure is the one quoted.
              hint={w205 === undefined ? undefined : `205-day ${lb(w205)}, unadjusted`}
            />
          </StatRow>

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
      actions={<ActionLink href="/admin/cattle/sales">Sales screen</ActionLink>}
    >
      <StatRow>
        <Tile
          label={pl.net.cents >= 0 ? "In front" : "Behind"}
          value={formatMoney(pl.net)}
          tone={pl.complete ? "neutral" : "action"}
          // Said plainly rather than shown as a clean number. A home-raised
          // calf with no feed allocation shows a flattering profit that is
          // arithmetically right and practically misleading.
          hint={pl.complete ? undefined : "Incomplete — a cost line has no figure yet"}
        />
        <Tile label="Revenue" value={formatMoney(pl.totalRevenue)} />
        <Tile label="Total cost" value={formatMoney(pl.totalCost)} />
      </StatRow>

      <Rows label="Costs">
        <Row title="Acquisition" chip={<Money value={formatMoney(pl.acquisitionCost)} />} />
        <Row title="Health" chip={<Money value={formatMoney(pl.healthCost)} />} />
        {/* Usually the blank one: feed is apportioned in §5.3. */}
        <Row title="Feed" chip={<Money value={formatMoney(pl.feedCost)} />} />
        <Row title="Breeding" chip={<Money value={formatMoney(pl.breedingCost)} />} />
      </Rows>
    </Section>
  );
}

function Money({ value }: { readonly value: string }) {
  return <span className="gf-numeric text-ink">{value}</span>;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
