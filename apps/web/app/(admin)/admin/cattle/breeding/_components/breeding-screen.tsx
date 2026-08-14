"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import {
  Badge,
  Button,
  Callout,
  Card,
  DataTable,
  DetailList,
  EmptyState,
  PageBody,
  PageHeader,
  Pill,
  Section,
  SearchSelect,
  Select,
  StatRow,
  Tile,
  TextInput,
  useConfirmDelete,
  useToast,
  type Column,
  type SearchOption,
} from "@galaxy-farm/ui";
import { displayName, type Animal, type Ulid } from "@galaxy-farm/core";
import {
  allRegistrations,
  BREEDING_METHODS,
  predictCalfColour,
  breedingRecordSchema,
  canBe,
  DEFAULT_GESTATION_DAYS,
  inferAncestorSexes,
  calvingWindow,
  daysBred,
  isInCalvingWindow,
  PREG_CHECK_METHODS,
  PREG_CHECK_RESULTS,
  pregCheckDue,
  projectedDueDate,
  type BreedingMethod,
  type BreedingRecord,
  type CattleProfile,
  type ExternalAnimal,
  type PregCheckMethod,
  type PregCheckResult,
} from "@galaxy-farm/module-cattle";

import { PairingPlanner } from "@/app/(admin)/admin/cattle/breeding/_components/pairing-planner";
import { animalHref } from "@/lib/animal-slug";
import { coatResolver } from "@/lib/coat";
import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

/**
 * Breeding, and the dates that fall out of it (spec §5.2, issue #12).
 *
 * The screen that races a real date. Andromeda was bred by AI on 14 February
 * 2026; at §12 decision 2's flat 283 days that is 24 November, with the watch
 * opening on the 10th.
 *
 * Two things are typed — the date and the sire — and everything else on this
 * page is derived from them: the due date, the fortnight either side of it,
 * when to preg check, and how far along she is today. §2's "derive, don't
 * duplicate", which is also what makes correcting a mistyped breeding date fix
 * every downstream date at once instead of leaving four stale copies.
 */

function formatDate(value: Date | undefined): string {
  return value === undefined
    ? "—"
    : value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function BreedingScreen({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const { records: animals } = useRecords<Animal>("animals", { propertyId });
  const { records: outsiders } = useRecords<ExternalAnimal>("externalAnimals", { propertyId });
  const { records: profiles } = useRecords<CattleProfile>("cattleProfiles", { propertyId });
  const { records: breedings, loading } = useRecords<BreedingRecord>("breedingRecords", {
    propertyId,
  });

  const breedingsApi = useMutations<BreedingRecord>(
    "breedingRecords",
    "breedingRecords",
    breedingRecordSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const now = new Date();
  const byId = useMemo(() => new Map(animals.map((animal) => [animal.id, animal])), [animals]);
  const damOf = (record: BreedingRecord) => byId.get(record.damId);

  // Females are the only ones that can be bred, and offering the whole herd in
  // the dam picker is how a steer ends up with a due date.
  const dams = animals.filter(
    (animal) =>
      animal.species === "cattle" && animal.sex === "female" && animal.status === "active",
  );

  /**
   * Every bull worth offering: ours, and the ones on the papers.
   *
   * The sire on a breeding record is a *name* rather than a reference — a
   * straw can come from a bull nobody will ever own — so this is a list to
   * pick from rather than a list to be held to. A cow in it, though, is how a
   * cow gets recorded as somebody's sire, so the same bulls-only rule applies.
   */
  const sexes = useMemo(
    () => inferAncestorSexes(outsiders, [...profiles, ...outsiders]),
    [outsiders, profiles],
  );
  const sires: SearchOption[] = useMemo(
    () => [
      ...animals
        .filter(
          (animal) =>
            animal.species === "cattle" && animal.sex === "male" && animal.status === "active",
        )
        .map((animal) => ({
          value: displayName(animal),
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
            value: entry.name,
            label: entry.name,
            ...(papers === "" ? {} : { detail: papers }),
            group: "On the papers",
          };
        }),
    ],
    [animals, outsiders, sexes],
  );

  const watched = breedings.filter((record) => isInCalvingWindow(record, now));
  const openChecks = breedings.filter((record) => {
    const due = pregCheckDue(record);
    return due !== undefined && due <= now;
  });

  async function remove(record: BreedingRecord) {
    const dam = damOf(record);
    const confirmed = await confirmDelete({
      tier: "elevated",
      recordName: `${dam === undefined ? "this cow" : displayName(dam)}, bred ${formatDate(record.date)}`,
      entity: "breeding record",
      // Naming what goes with it, per §4.5 clause 3. These are not separate
      // records to be tidied up afterwards — they stop existing with it.
      dependents: [
        {
          entity: "Projected due date",
          label: formatDate(projectedDueDate(record)),
          effect: "deleted" as const,
        },
        {
          entity: "Calving window",
          label: "and any watch card raised from it",
          effect: "deleted" as const,
        },
        ...(record.pregCheck === undefined
          ? []
          : [
              {
                entity: "Pregnancy check",
                label: `${record.pregCheck.result} on ${formatDate(record.pregCheck.date)}`,
                effect: "deleted" as const,
              },
            ]),
      ],
      action: "Delete",
    });
    if (!confirmed) return;

    await breedingsApi.remove(record.id, "Removed from the breeding log");
    show({ message: "Breeding record deleted", tone: "danger" });
  }

  const columns: readonly Column<BreedingRecord>[] = [
    {
      key: "dam",
      header: "Dam",
      render: (record) => {
        const dam = damOf(record);
        return dam === undefined ? (
          <span className="text-muted">Unknown</span>
        ) : (
          <Link
            href={animalHref(dam)}
            className="font-medium text-ink underline decoration-edge underline-offset-4 hover:decoration-action"
          >
            {displayName(dam)}
          </Link>
        );
      },
    },
    { key: "method", header: "Method", render: (record) => record.method },
    { key: "date", header: "Bred", render: (record) => formatDate(record.date) },
    {
      key: "due",
      header: "Due",
      render: (record) => (
        <span className="[font-variant-numeric:tabular-nums]">
          {formatDate(projectedDueDate(record))}
        </span>
      ),
    },
    {
      key: "day",
      header: "Day",
      // The number the calving-watch alert says out loud.
      render: (record) => {
        const day = daysBred(record, now);
        return day < 0 ? "—" : <span className="[font-variant-numeric:tabular-nums]">{day}</span>;
      },
    },
    {
      key: "state",
      header: "State",
      render: (record) => {
        if (record.pregCheck?.result === "open") return <Badge tone="neutral">Open</Badge>;
        if (isInCalvingWindow(record, now)) return <Badge tone="danger">Calving window</Badge>;
        if (record.pregCheck?.result === "bred") return <Badge tone="calm">Confirmed bred</Badge>;
        const due = pregCheckDue(record);
        if (due !== undefined && due <= now) return <Badge tone="action">Preg check due</Badge>;
        return <Badge tone="neutral">Waiting</Badge>;
      },
    },
    {
      key: "actions",
      header: "",
      render: (record) => (
        <span className="flex gap-2">
          <PregCheckButton record={record} api={breedingsApi} />
          <Button variant="ghost" onClick={() => void remove(record)}>
            Delete
          </Button>
        </span>
      ),
    },
  ];

  return (
    <PageBody>
      <PageHeader
        eyebrow="Cattle"
        title="Breeding"
        subtitle={`Due dates project at ${DEFAULT_GESTATION_DAYS} days (§12 decision 2), and the calving window opens a fortnight before.`}
      />

      <StatRow>
        <Tile label="Bred" value={breedings.length} />
        <Tile
          label="In the window"
          value={watched.length}
          emphasis={watched.length > 0}
          hint={watched.length > 0 ? "Watch these" : undefined}
        />
        <Tile label="Preg checks due" value={openChecks.length} />
        <Tile
          label="Next due"
          value={
            breedings.length === 0
              ? "—"
              : formatDate(
                  breedings
                    .filter((record) => record.pregCheck?.result !== "open")
                    .map((record) => projectedDueDate(record))
                    .filter((due) => due >= now)
                    .sort((left, right) => left.getTime() - right.getTime())[0],
                )
          }
        />
      </StatRow>

      {watched.length === 0 ? null : (
        <Section
          title="In the calving window"
          description="Due date give or take a fortnight. The weather side of the watch is issue #14."
        >
          {watched.map((record) => {
            const window = calvingWindow(record);
            const dam = damOf(record);
            return (
              <Card key={record.id}>
                <DetailList
                  columns={3}
                  items={[
                    { label: "Dam", value: dam === undefined ? undefined : displayName(dam) },
                    { label: "Day of gestation", value: daysBred(record, now) },
                    { label: "Due", value: formatDate(projectedDueDate(record)) },
                    { label: "Window opened", value: formatDate(window.from) },
                    { label: "Window closes", value: formatDate(window.to) },
                    { label: "Service", value: record.method },
                  ]}
                />
              </Card>
            );
          })}
        </Section>
      )}

      {/*
        The planner sits above the form on purpose. The questions it answers —
        what the calf will be, what colour, how close these two are, and what
        the pairing could carry — are the ones somebody wishes they had asked
        *before* the straw was pulled, and a panel underneath the form is a
        panel nobody scrolls to.
      */}
      <PairingPlanner animals={animals} propertyId={propertyId} />

      <Section title="Record a breeding">
        <AddBreeding
          dams={dams}
          sires={sires}
          api={breedingsApi}
          animals={animals}
          profiles={profiles}
          outsiders={outsiders}
        />
      </Section>

      <Section title="Every breeding">
        {loading ? (
          <p className="text-muted">Looking…</p>
        ) : (
          <Card>
            <DataTable
              caption="Breeding records"
              columns={columns}
              rows={[...breedings].sort(
                (left, right) => right.date.getTime() - left.date.getTime(),
              )}
              rowKey={(record) => record.id}
              empty={
                <EmptyState
                  title="Nothing bred yet"
                  detail="Record a service above and the due date, the calving window and the preg-check reminder all follow from it."
                />
              }
            />
          </Card>
        )}
      </Section>
    </PageBody>
  );
}

type Api = ReturnType<typeof useMutations<BreedingRecord>>;

function AddBreeding({
  dams,
  sires,
  api,
  animals,
  profiles,
  outsiders,
}: {
  readonly dams: readonly Animal[];
  readonly sires: readonly SearchOption[];
  readonly api: Api;
  /** Everything on file, so the calf's colour can be worked out before saving. */
  readonly animals: readonly Animal[];
  readonly profiles: readonly CattleProfile[];
  readonly outsiders: readonly ExternalAnimal[];
}) {
  const { show } = useToast();
  const [damId, setDamId] = useState("");
  const [method, setMethod] = useState<BreedingMethod>("AI");
  const [sire, setSire] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [gestation, setGestation] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  /**
   * What colour the calf can be, before the breeding is even recorded.
   *
   * The moment to know is while the bull is still a choice. Worked out from
   * the parents' inferred genotypes rather than from hair cards — this farm
   * has cards for almost nothing, and a prediction that needs one would be
   * blank on every pairing anybody actually makes.
   *
   * The sire is stored as a name rather than an id, because a straw from a
   * bull this farm will never own is a legitimate answer. So he is matched
   * back by name, and a typed-in bull nobody has on file simply yields
   * nothing.
   */
  const calfColour = useMemo(() => {
    if (damId === "" || sire.trim() === "") return undefined;

    const resolve = coatResolver({ profiles, outsiders });

    const damCoat = resolve.of({ kind: "animal", id: damId as Ulid });
    const ours = animals.find((animal) => displayName(animal) === sire.trim());
    const theirs = outsiders.find((entry) => entry.name === sire.trim());
    const sireCoat =
      ours !== undefined
        ? resolve.of({ kind: "animal", id: ours.id })
        : theirs !== undefined
          ? resolve.of({ kind: "external", id: theirs.id })
          : undefined;

    // Which side is missing, said out loud. Rendering nothing when one of them
    // cannot be worked out leaves somebody staring at a blank space with no
    // idea whether the app is thinking, broken, or simply has nothing — and no
    // idea which record to go and fill in.
    const blocked: string[] = [];
    if (sireCoat === undefined) {
      blocked.push(
        theirs === undefined && ours === undefined
          ? `${sire.trim()} is not on file — a bull typed in by hand has no pedigree to work from.`
          : `Nothing is recorded about ${sire.trim()}'s colour, and nothing in his pedigree settles it.`,
      );
    }
    if (damCoat === undefined) {
      blocked.push(
        "Nothing is recorded about the cow's colour, and nothing in her pedigree settles it.",
      );
    }
    if (sireCoat === undefined || damCoat === undefined) return { blocked };

    return { prediction: predictCalfColour(sireCoat, damCoat), blocked };
  }, [damId, sire, animals, profiles, outsiders]);

  // Shown before saving, because the date is the whole point of the record and
  // a typo in the year is invisible until eleven months later.
  const preview =
    date === ""
      ? undefined
      : projectedDueDate(
          { date: new Date(date), gestationDays: gestation === "" ? undefined : Number(gestation) },
          DEFAULT_GESTATION_DAYS,
        );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);

    if (damId === "") {
      setError("Choose the cow");
      return;
    }
    if (sire.trim() === "") {
      setError("Name the sire — a breeding with no sire cannot pedigree the calf");
      return;
    }

    setBusy(true);
    try {
      const result = await api.create({
        damId: damId as Ulid,
        method,
        date: new Date(date),
        // Recorded as a note until the semen tank and ExternalAnimal pickers
        // exist (#20, #16). Losing which bull it was would be worse than the
        // reference being unstructured for now.
        notes: [`Sire: ${sire.trim()}`, notes.trim()].filter(Boolean).join("\n"),
        ...(gestation === "" ? {} : { gestationDays: Number(gestation) }),
      } as never);

      if (!result.ok) {
        setError(
          result.error.kind === "validation"
            ? (result.error.issues[0]?.message ?? "That is not valid")
            : "Could not save that",
        );
        return;
      }

      setSire("");
      setNotes("");
      show({ message: `Bred. Due ${formatDate(projectedDueDate(result.value))}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-density">
      <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-3">
        <SearchSelect
          label="Dam"
          value={damId}
          onChange={setDamId}
          placeholder="Choose a cow"
          options={dams.map((animal) => ({
            value: animal.id,
            label: displayName(animal),
            ...(animal.tagNumber === undefined ? {} : { detail: animal.tagNumber }),
          }))}
          required
        />
        <Select
          label="Method"
          value={method}
          onChange={(event) => setMethod(event.target.value as BreedingMethod)}
          options={BREEDING_METHODS.map((value) => ({ value, label: value }))}
        />
        <SearchSelect
          label="Sire"
          hint="Bulls here and on the papers. A straw from a bull nobody has on file can be typed in."
          value={sire}
          placeholder="Choose or type a bull"
          options={sires}
          // The one field where an outside name is genuinely the answer: a
          // straw from a bull this farm will never own. The row still has to
          // be picked, so nothing is recorded by typing and walking away.
          allowCustom={(typed) => `Use "${typed}" — not on file`}
          onChange={setSire}
          required
        />
        <TextInput
          label="Date bred"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          required
        />
        <TextInput
          label="Gestation days"
          hint={`Blank uses the ${DEFAULT_GESTATION_DAYS}-day default.`}
          type="number"
          value={gestation}
          onChange={(event) => setGestation(event.target.value)}
        />
        <TextInput
          label="Notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          {...(error === undefined ? {} : { error })}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" busy={busy}>
          Record breeding
        </Button>
        {preview === undefined ? null : (
          <p className="text-sm text-muted">
            Due <span className="font-medium text-ink">{formatDate(preview)}</span> · window opens{" "}
            {formatDate(
              calvingWindow({
                date: new Date(date),
                gestationDays: gestation === "" ? undefined : Number(gestation),
              }).from,
            )}
          </p>
        )}
      </div>

      {calfColour === undefined ? null : (
        <Callout
          tone={calfColour.prediction === undefined ? "neutral" : "identity"}
          title="What colour the calf can be"
        >
          {calfColour.prediction === undefined ? null : (
            <ul className="flex flex-wrap gap-2">
              {calfColour.prediction.outcomes.map((outcome) => (
                <li key={outcome.name}>
                  <Pill tone={outcome.chance === 1 ? "identity" : "neutral"}>
                    {outcome.name} · {Math.round(outcome.chance * 100)}%
                  </Pill>
                </li>
              ))}
            </ul>
          )}

          {/*
            Half an answer said to be half an answer, and no answer said to be
            no answer. A confident-looking list covering one locus is worse
            than one admitting the other is open, and a blank space is worse
            than either.
          */}
          {[...calfColour.blocked, ...(calfColour.prediction?.missing ?? [])].length ===
          0 ? null : (
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {[...calfColour.blocked, ...(calfColour.prediction?.missing ?? [])].map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </Callout>
      )}
    </form>
  );
}

/**
 * Recording the check.
 *
 * A result of `open` ends the watch: a cow that came back open is not about to
 * calve, and leaving her on the dashboard for a month teaches people to ignore
 * the card.
 */
function PregCheckButton({ record, api }: { readonly record: BreedingRecord; readonly api: Api }) {
  const { show } = useToast();
  const [openForm, setOpenForm] = useState(false);
  const [result, setResult] = useState<PregCheckResult>("bred");
  const [method, setMethod] = useState<PregCheckMethod>("ultrasound");

  async function save() {
    await api.update(record.id, {
      pregCheck: { date: new Date(), result, method },
    } as Partial<BreedingRecord>);
    setOpenForm(false);
    show({ message: result === "open" ? "Recorded open" : "Recorded bred" });
  }

  if (!openForm) {
    return (
      <Button variant="ghost" onClick={() => setOpenForm(true)}>
        {record.pregCheck === undefined ? "Preg check" : "Re-check"}
      </Button>
    );
  }

  return (
    <span className="flex flex-wrap items-end gap-2">
      <Select
        label="Result"
        value={result}
        onChange={(event) => setResult(event.target.value as PregCheckResult)}
        options={PREG_CHECK_RESULTS.map((value) => ({ value, label: value }))}
      />
      <Select
        label="Method"
        value={method}
        onChange={(event) => setMethod(event.target.value as PregCheckMethod)}
        options={PREG_CHECK_METHODS.map((value) => ({ value, label: value }))}
      />
      <Button onClick={() => void save()}>Save</Button>
      <Button variant="ghost" onClick={() => setOpenForm(false)}>
        Cancel
      </Button>
    </span>
  );
}
