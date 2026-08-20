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
import { displayName, isUlid, type Animal, type Ulid } from "@galaxy-farm/core";
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
  drawStraw,
  isInCalvingWindow,
  PREG_CHECK_METHODS,
  PREG_CHECK_RESULTS,
  pregCheckDue,
  projectedDueDate,
  semenInventorySchema,
  tankLocation,
  type BreedingMethod,
  type BreedingRecord,
  type CattleProfile,
  type ExternalAnimal,
  type PregCheckMethod,
  type PregCheckResult,
  type SemenInventory,
  type SexVerdict,
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
  const { records: straws } = useRecords<SemenInventory>("semenInventory", { propertyId });

  const breedingsApi = useMutations<BreedingRecord>(
    "breedingRecords",
    "breedingRecords",
    breedingRecordSchema,
    propertyId,
    actorId,
  );
  const strawsApi = useMutations<SemenInventory>(
    "semenInventory",
    "semenInventory",
    semenInventorySchema,
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
   * Every way of saying who the bull was, in one list.
   *
   * Four of them, because four are true: a straw out of our own tank, a bull
   * standing here, an ancestor already on file, and a name typed in for semen
   * this farm never held or a cow bred at somebody else's place. The last one
   * is not a fallback for a picker that failed — it is the commonest AI on
   * this farm, and requiring one of the other three is what made an AI
   * breeding impossible to record at all.
   *
   * A cow in the list is how a cow gets recorded as somebody's sire, so the
   * bulls-only rule applies to every group that comes off a record.
   */
  const sexes = useMemo(
    () => inferAncestorSexes(outsiders, [...profiles, ...outsiders]),
    [outsiders, profiles],
  );
  const lookup: SireLookup = useMemo(
    () => ({ animals, outsiders, straws }),
    [animals, outsiders, straws],
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
    {
      key: "sire",
      header: "Sire",
      // Worth a column of its own: the sire is half the answer to "what is
      // this calf", and until there was a field for him he lived in a note
      // nobody could see from here.
      render: (record) => {
        const sire = sireDisplay(record, lookup);
        return sire === undefined ? (
          <span className="text-muted">—</span>
        ) : (
          <span className="flex items-center gap-2">
            {sire}
            {record.semenInventoryId === undefined ? null : <Pill tone="neutral">straw</Pill>}
          </span>
        );
      },
    },
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
          sexes={sexes}
          lookup={lookup}
          api={breedingsApi}
          strawsApi={strawsApi}
          profiles={profiles}
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

/**
 * Who the bull was, in one field.
 *
 * The picker offers rows from three different record types and accepts a name
 * that belongs to none of them, so the value it carries has to say which. The
 * prefix does that; anything without a recognised one is a name somebody
 * typed, which is exactly what an ad-hoc sire is.
 */
type SireChoice =
  | { readonly kind: "straw"; readonly id: Ulid }
  | { readonly kind: "bull"; readonly id: Ulid }
  | { readonly kind: "external"; readonly id: Ulid }
  | { readonly kind: "name"; readonly name: string };

export interface SireLookup {
  readonly animals: readonly Animal[];
  readonly outsiders: readonly ExternalAnimal[];
  readonly straws: readonly SemenInventory[];
}

export function parseSire(value: string): SireChoice | undefined {
  const typed = value.trim();
  if (typed === "") return undefined;

  const colon = typed.indexOf(":");
  const prefix = colon === -1 ? "" : typed.slice(0, colon);
  const rest = typed.slice(colon + 1);
  // The id has to be a ULID as well as the prefix being one of ours, so a bull
  // somebody genuinely named "bull: something" is still taken as a name.
  if ((prefix === "straw" || prefix === "bull" || prefix === "external") && isUlid(rest)) {
    return { kind: prefix, id: rest };
  }
  return { kind: "name", name: typed };
}

/** Every straw, bull and ancestor worth offering for this method. */
export function sireOptions(
  method: BreedingMethod,
  lookup: SireLookup,
  sexes: ReadonlyMap<Ulid, SexVerdict>,
): SearchOption[] {
  // The tank belongs to AI and only to AI. A straw is not a natural service,
  // and an embryo's sire is on its papers rather than in our canister —
  // offering it there would draw a straw down for a breeding that used none.
  const tank =
    method !== "AI"
      ? []
      : [...lookup.straws]
          .sort(
            (left, right) =>
              right.strawsOnHand - left.strawsOnHand || left.sireName.localeCompare(right.sireName),
          )
          .map((straw) => {
            // Empty canes stay on the list. A breeding entered a fortnight
            // late, with the last straw of that bull already drawn, is still
            // that bull's breeding — it just leaves the count alone.
            const count =
              straw.strawsOnHand === 0
                ? "none left"
                : `${straw.strawsOnHand} straw${straw.strawsOnHand === 1 ? "" : "s"}`;
            const detail = [count, tankLocation(straw)].filter((part) => part !== undefined);
            return {
              value: `straw:${straw.id}`,
              label: straw.sireName,
              detail: detail.join(" · "),
              group: "In the tank",
            };
          });

  const ours = lookup.animals
    .filter(
      (animal) =>
        animal.species === "cattle" && animal.sex === "male" && animal.status === "active",
    )
    .map((animal) => ({
      value: `bull:${animal.id}`,
      label: displayName(animal),
      ...(animal.tagNumber === undefined ? {} : { detail: animal.tagNumber }),
      group: "Bulls here",
    }));

  const papers = [...lookup.outsiders]
    .filter((entry) => canBe(sexes.get(entry.id), "male"))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const registrations = allRegistrations(entry)
        .map((registration) => `${registration.association} ${registration.regNumber}`)
        .join(" · ");
      return {
        value: `external:${entry.id}`,
        label: entry.name,
        ...(registrations === "" ? {} : { detail: registrations }),
        group: "On the papers",
      };
    });

  return [...tank, ...ours, ...papers];
}

/**
 * What the record says about the sire, whichever way he was picked.
 *
 * The name is written every time, alongside whatever reference there is. A
 * straw gets used up and purged and a bull gets sold; the breeding still has
 * to be able to say who bred her years later, which is what the calf's papers
 * are filled in from.
 */
export function sireFields(choice: SireChoice, lookup: SireLookup): Partial<BreedingRecord> {
  if (choice.kind === "name") return { sireName: choice.name };

  if (choice.kind === "bull") {
    const bull = lookup.animals.find((animal) => animal.id === choice.id);
    return {
      bullId: choice.id,
      ...(bull === undefined ? {} : { sireName: displayName(bull) }),
    };
  }

  if (choice.kind === "external") {
    const outsider = lookup.outsiders.find((entry) => entry.id === choice.id);
    return {
      sireExternalId: choice.id,
      ...(outsider === undefined ? {} : { sireName: outsider.name }),
    };
  }

  const straw = lookup.straws.find((entry) => entry.id === choice.id);
  if (straw === undefined) return { semenInventoryId: choice.id };

  // The straw's own sire travels onto the breeding, so the calving flow can
  // pedigree the calf from the service without going back through the tank.
  return {
    semenInventoryId: straw.id,
    ...(straw.sireAnimalId === undefined ? {} : { bullId: straw.sireAnimalId }),
    ...(straw.sireExternalId === undefined ? {} : { sireExternalId: straw.sireExternalId }),
    sireName: straw.sireName,
  };
}

/** The sire of a breeding already on file, however he was recorded. */
export function sireDisplay(record: BreedingRecord, lookup: SireLookup): string | undefined {
  if (record.sireName !== undefined && record.sireName.trim() !== "") return record.sireName;

  const bull =
    record.bullId === undefined
      ? undefined
      : lookup.animals.find((animal) => animal.id === record.bullId);
  if (bull !== undefined) return displayName(bull);

  const outsider =
    record.sireExternalId === undefined
      ? undefined
      : lookup.outsiders.find((entry) => entry.id === record.sireExternalId);
  if (outsider !== undefined) return outsider.name;

  const straw =
    record.semenInventoryId === undefined
      ? undefined
      : lookup.straws.find((entry) => entry.id === record.semenInventoryId);
  if (straw !== undefined) return straw.sireName;

  // Records written before there was a field for him: this screen used to put
  // the sire in the notes because there was nowhere else to put it.
  const noted = /^Sire: (.+)$/m.exec(record.notes ?? "");
  return noted?.[1]?.trim();
}

type Api = ReturnType<typeof useMutations<BreedingRecord>>;

function AddBreeding({
  dams,
  sexes,
  lookup,
  api,
  strawsApi,
  profiles,
}: {
  readonly dams: readonly Animal[];
  readonly sexes: ReadonlyMap<Ulid, SexVerdict>;
  /** Everything a sire could be picked from, and matched back out of. */
  readonly lookup: SireLookup;
  readonly api: Api;
  /** The tank, so drawing a straw takes it off the count (§5.2).  */
  readonly strawsApi: ReturnType<typeof useMutations<SemenInventory>>;
  readonly profiles: readonly CattleProfile[];
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

  const options = useMemo(() => sireOptions(method, lookup, sexes), [method, lookup, sexes]);
  const choice = useMemo(() => parseSire(sire), [sire]);
  const chosenStraw =
    choice?.kind === "straw" ? lookup.straws.find((entry) => entry.id === choice.id) : undefined;

  /**
   * What colour the calf can be, before the breeding is even recorded.
   *
   * The moment to know is while the bull is still a choice. Worked out from
   * the parents' inferred genotypes rather than from hair cards — this farm
   * has cards for almost nothing, and a prediction that needs one would be
   * blank on every pairing anybody actually makes.
   *
   * A sire typed in rather than picked is still matched back by name, because
   * a bull can be on file as an ancestor and not be what somebody reached for
   * in the list. A name matching nothing simply yields nothing, which is the
   * honest answer for semen bought from a stranger.
   */
  const calfColour = useMemo(() => {
    if (damId === "" || choice === undefined) return undefined;

    const resolve = coatResolver({ profiles, outsiders: lookup.outsiders });
    const damCoat = resolve.of({ kind: "animal", id: damId as Ulid });

    const named =
      choice.kind === "name" ? choice.name : (sireFields(choice, lookup).sireName ?? "the sire");
    const animalId =
      choice.kind === "bull"
        ? choice.id
        : choice.kind === "name"
          ? lookup.animals.find((animal) => displayName(animal) === choice.name)?.id
          : chosenStraw?.sireAnimalId;
    const externalId =
      choice.kind === "external"
        ? choice.id
        : choice.kind === "name"
          ? lookup.outsiders.find((entry) => entry.name === choice.name)?.id
          : chosenStraw?.sireExternalId;

    const sireCoat =
      animalId !== undefined
        ? resolve.of({ kind: "animal", id: animalId })
        : externalId !== undefined
          ? resolve.of({ kind: "external", id: externalId })
          : undefined;

    // Which side is missing, said out loud. Rendering nothing when one of them
    // cannot be worked out leaves somebody staring at a blank space with no
    // idea whether the app is thinking, broken, or simply has nothing — and no
    // idea which record to go and fill in.
    const blocked: string[] = [];
    if (sireCoat === undefined) {
      blocked.push(
        animalId === undefined && externalId === undefined
          ? `${named} is not on file — a bull named by hand has no pedigree to work from.`
          : `Nothing is recorded about ${named}'s colour, and nothing in his pedigree settles it.`,
      );
    }
    if (damCoat === undefined) {
      blocked.push(
        "Nothing is recorded about the cow's colour, and nothing in her pedigree settles it.",
      );
    }
    if (sireCoat === undefined || damCoat === undefined) return { blocked };

    return { prediction: predictCalfColour(sireCoat, damCoat), blocked };
  }, [damId, choice, chosenStraw, lookup, profiles]);

  // Shown before saving, because the date is the whole point of the record and
  // a typo in the year is invisible until eleven months later.
  const preview =
    date === ""
      ? undefined
      : projectedDueDate(
          { date: new Date(date), gestationDays: gestation === "" ? undefined : Number(gestation) },
          DEFAULT_GESTATION_DAYS,
        );

  /**
   * Take the straw off the count (§5.2: "decremented by AI breeding records").
   *
   * Runs after the breeding is saved, and never blocks it. A tank count that
   * refused to go negative — the §4.5 invariant `drawStraw` enforces — is not
   * a reason to lose the service: a breeding entered a fortnight late, against
   * a cane already emptied, is still that cow's breeding and still her due
   * date. What comes back is what to say about the tank, not whether to save.
   */
  async function drawFromTank(straw: SemenInventory): Promise<string> {
    const drawn = drawStraw(straw, new Date());
    if (!drawn.ok) return ` · tank left alone — ${straw.sireName} shows none on hand`;

    const updated = await strawsApi.update(straw.id, {
      strawsOnHand: drawn.item.strawsOnHand,
    } as Partial<SemenInventory>);
    if (!updated.ok) return " · the tank count could not be updated";

    const left = drawn.item.strawsOnHand;
    return ` · ${left} straw${left === 1 ? "" : "s"} of ${straw.sireName} left`;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);

    if (damId === "") {
      setError("Choose the cow");
      return;
    }
    // ET is the one method that can be recorded without him: the pedigree the
    // calf gets is the embryo's, and the donor is what identifies it.
    if (choice === undefined && method !== "ET") {
      setError("Say who the bull was — pick a straw or a bull, or type his name");
      return;
    }

    setBusy(true);
    try {
      const result = await api.create({
        damId: damId as Ulid,
        method,
        date: new Date(date),
        ...(choice === undefined ? {} : sireFields(choice, lookup)),
        ...(notes.trim() === "" ? {} : { notes: notes.trim() }),
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

      const tank = chosenStraw === undefined ? "" : await drawFromTank(chosenStraw);

      setSire("");
      setNotes("");
      show({ message: `Bred. Due ${formatDate(projectedDueDate(result.value))}${tank}` });
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
          label={method === "natural" ? "Bull" : method === "ET" ? "Sire of the embryo" : "Sire"}
          hint={
            method === "natural"
              ? "Bulls here and on the papers. A leased or neighbour's bull can be typed in."
              : method === "ET"
                ? "The bull on the embryo's papers. Picked, typed, or left out."
                : "A straw from the tank, a bull on file, or a name typed in — semen you never held and a cow bred at somebody else's place both count."
          }
          value={sire}
          placeholder={
            method === "natural" ? "Choose or type a bull" : "Choose a straw, or type a bull"
          }
          options={options}
          // The one field where an outside name is genuinely the answer, and
          // the reason an AI breeding could not be recorded at all until now.
          // The row still has to be picked, so nothing is recorded by typing
          // and walking away.
          allowCustom={(typed) => `Use "${typed}" — not on file`}
          onChange={setSire}
          {...(method === "ET" ? {} : { required: true })}
          clearLabel={method === "ET" ? "Not recorded" : undefined}
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
        {chosenStraw === undefined ? null : (
          <p className="text-sm text-muted">
            {chosenStraw.strawsOnHand === 0
              ? `${chosenStraw.sireName} shows none on hand — the breeding saves and the tank count stays put.`
              : `Draws one straw of ${chosenStraw.sireName}; ${chosenStraw.strawsOnHand - 1} would be left.`}
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
