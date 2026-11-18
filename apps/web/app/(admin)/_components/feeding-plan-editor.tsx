"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";

import {
  Button,
  Checkbox,
  Modal,
  optionLabel,
  Pill,
  PlusIcon,
  Select,
  TextArea,
  TextInput,
  toOptions,
  useConfirmDelete,
  useToast,
} from "@galaxy-farm/ui";
import {
  animalsOf,
  audienceOf,
  displayName,
  FEEDING_FREQUENCIES,
  feedingPlanSchema,
  flocksOf,
  isOnFarm,
  isTotal,
  PET_FEEDING_PLACES,
  RECEPTACLE_INFO,
  receptaclesFor,
  SPECIES,
  SPECIES_LABELS,
  TIMES_OF_DAY,
  wrongSpecies,
  type Animal,
  type FeedingFrequency,
  type FeedingPlan,
  type FeedingPlanLine,
  type Portion,
  type Receptacle,
  type Species,
  type TimeOfDay,
  type Ulid,
  type Unit,
  type Zone,
} from "@galaxy-farm/core";
import {
  FEED_CATEGORY_INFO,
  FEED_UNITS,
  roleOf,
  suits,
  type FeedType,
} from "@galaxy-farm/module-feed";

import { headCountOn, type Flock, type FlockAdjustment } from "@galaxy-farm/module-poultry";

import { ListRow, RowList } from "@/app/(admin)/admin/horses/_components/list-row";
import { describeLine, describePlanLine, mixedUnitFeed, nameList } from "@/lib/feed-lines";
import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

/**
 * Feeding plans, written and read the same way everywhere (spec §5.1,
 * decision 49).
 *
 * There used to be two editors — the herd's, aimed at an animal, a pen or the
 * place, and the pets', a checkbox grid of whoever shared a bowl — and they
 * disagreed: the herd's dropped a line's note on save, the pets' could not say
 * where the bowl was. Now a plan owns its animals, and this one editor writes
 * it from every screen: Farm › Feed, the cattle's feed page, a pet's care page
 * and a pet's own page. What changes between them is only what it starts with.
 *
 * It knows the animal. Choosing the species decides who can be ticked, which
 * feeds are offered (kibble for the dogs, crickets for the gecko, layer feed
 * for the hens), which receptacles (a bowl, not a bunk), and how "where" is
 * asked: a pen from the property's zones for livestock, words with household
 * suggestions for a pet, which has no zone.
 */

/** Something a poultry plan can feed: a flock and how many birds are in it. */
export interface PlanFlock {
  readonly id: Ulid;
  readonly name: string;
  readonly species: Species;
  readonly heads: number;
}

/**
 * The property's active flocks with today's headcounts, ready for a plan.
 *
 * Poultry are counted, not named, so a hen plan's demand is its flocks' heads
 * — read from the headcount log, the same number the Chickens page shows.
 */
export function usePlanFlocks(propertyId: Ulid): PlanFlock[] {
  const query = { propertyId };
  const { records: flocks } = useRecords<Flock>("flocks", query);
  const { records: adjustments } = useRecords<FlockAdjustment>("flockAdjustments", query);
  return useMemo(() => {
    const now = new Date();
    return flocks
      .filter((flock) => flock.active)
      .map((flock) => ({
        id: flock.id,
        name: flock.name,
        species: flock.species,
        heads: headCountOn(flock, adjustments, now),
      }));
  }, [flocks, adjustments]);
}

/* ------------------------------------------------------------- the rows */

/** "Max and Bella", "14 cattle", "Layers — 12 birds". */
export function membersLabel(
  plan: Pick<FeedingPlan, "animalIds" | "flockIds" | "species">,
  animals: readonly Pick<Animal, "id" | "name" | "tagNumber" | "status">[],
  flocks: readonly PlanFlock[] = [],
): string {
  const byId = new Map(animals.map((animal) => [animal.id, animal]));
  const fed = animalsOf(plan)
    .map((id) => byId.get(id))
    .filter((animal): animal is NonNullable<typeof animal> => animal !== undefined);
  const birds = flocksOf(plan)
    .map((id) => flocks.find((flock) => flock.id === id))
    .filter((flock): flock is PlanFlock => flock !== undefined);

  const parts = [
    ...birds.map((flock) => `${flock.name} — ${flock.heads} birds`),
    ...(fed.length <= 4
      ? fed.map(displayName)
      : [`${fed.length} ${SPECIES_LABELS[plan.species].toLowerCase()}`]),
  ];
  if (parts.length > 0) return nameList(parts);
  return flocksOf(plan).length > 0 ? "A flock" : "Nobody yet";
}

/** Where a plan is fed, in words: "West Pen", "Kitchen", "Barn, north end". */
export function placeLabel(
  plan: Pick<FeedingPlan, "placeZoneId" | "placeLabel">,
  zones: readonly Pick<Zone, "id" | "name">[],
): string | undefined {
  const zone = zones.find((candidate) => candidate.id === plan.placeZoneId)?.name;
  const label = plan.placeLabel?.trim();
  const parts = [zone, label === "" ? undefined : label].filter(
    (part): part is string => part !== undefined,
  );
  return parts.length === 0 ? undefined : parts.join(", ");
}

/**
 * Plans as rows, each opening its editor.
 *
 * Who, where, then every line as somebody would follow it at six in the
 * morning — the amount, the feed, what it goes in, how often.
 */
export function PlanRows({
  label,
  plans,
  feeds,
  animals,
  flocks = [],
  zones = [],
  onOpen,
  showWho = true,
}: {
  readonly label: string;
  readonly plans: readonly FeedingPlan[];
  readonly feeds: readonly FeedType[];
  readonly animals: readonly Animal[];
  readonly flocks?: readonly PlanFlock[];
  readonly zones?: readonly Pick<Zone, "id" | "name">[];
  readonly onOpen: (plan: FeedingPlan) => void;
  /** Off on a pet's own page, where "who" is the page itself. */
  readonly showWho?: boolean;
}) {
  return (
    <RowList label={label}>
      {plans.map((plan) => {
        const where = placeLabel(plan, zones);
        return (
          <ListRow
            key={plan.id}
            title={plan.name}
            line={[
              showWho && membersLabel(plan, animals, flocks),
              where === undefined ? undefined : `at ${where}`,
              ...plan.lines.map((line: FeedingPlanLine) => describePlanLine(line, feeds)),
              plan.specialNotes,
            ]}
            chip={
              !plan.active ? (
                <Pill tone="neutral">Off</Pill>
              ) : isTotal(plan) && animalsOf(plan).length + flocksOf(plan).length > 1 ? (
                <Pill tone="action">Together</Pill>
              ) : undefined
            }
            label={`Edit ${plan.name}`}
            onOpen={() => onOpen(plan)}
          />
        );
      })}
    </RowList>
  );
}

/* ---------------------------------------------------- saving and removing */

export function usePlanActions(propertyId: Ulid, actorId: Ulid) {
  const api = useMutations<FeedingPlan>(
    "feedingPlans",
    "feedingPlans",
    feedingPlanSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  async function toggle(plan: FeedingPlan) {
    await api.update(plan.id, { active: !plan.active } as Partial<FeedingPlan>);
    show({
      message: plan.active ? `${plan.name} switched off` : `${plan.name} switched on`,
      tone: plan.active ? "warning" : "success",
    });
  }

  async function remove(plan: FeedingPlan): Promise<boolean> {
    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: plan.name,
      entity: "feeding plan",
      dependents: [
        { entity: "Daily demand", label: "for the feed it names", effect: "deleted" as const },
      ],
      // Switching off is nearly always what somebody means out of season, and
      // it keeps the plan for next year.
      consequence: "To stop feeding it for a season, switch it off instead — that keeps the plan.",
      action: "Delete",
    });
    if (!confirmed) return false;

    await api.remove(plan.id, "Removed from the feeding plans");
    show({ message: "Plan deleted", tone: "danger" });
    return true;
  }

  return { api, toggle, remove };
}

/* -------------------------------------------------------------- the form */

/**
 * One line of a plan, as the form holds it.
 *
 * The unit is on the line rather than taken from the feed: cubes are bought by
 * the bag and fed by the scoop, and kibble is bought by the bag and fed by the
 * cup. A form that read the unit off the catalog would have somebody writing
 * "0.03 bags" twice a day.
 */
interface LineDraft {
  readonly key: string;
  readonly feedId: string;
  readonly amount: string;
  readonly unit: Unit;
  readonly frequency: FeedingFrequency;
  readonly timeOfDay: TimeOfDay;
  readonly receptacle: Receptacle | "";
  readonly notes: string;
}

let lineSequence = 0;

function blankLine(species: Species): LineDraft {
  const pet = audienceOf(species) === "pet";
  return {
    key: `line-${lineSequence++}`,
    feedId: "",
    amount: "",
    unit: pet ? (species === "reptile" ? "each" : "cup") : "lb",
    frequency: species === "reptile" ? "every_other_day" : "twice_daily",
    timeOfDay: species === "reptile" ? "evening" : "morning",
    receptacle: receptaclesFor(species)[0] ?? "",
    notes: "",
  };
}

function linesFrom(plan: FeedingPlan): LineDraft[] {
  return plan.lines.map((line) => ({
    key: `line-${lineSequence++}`,
    feedId: line.feedTypeId,
    amount: String(line.amount.amount),
    unit: line.amount.unit,
    frequency: line.frequency,
    timeOfDay: line.timeOfDay,
    receptacle: line.receptacle ?? "",
    // Carried, not dropped: the old herd editor wrote every line without its
    // note, so adjusting an amount erased "dust with calcium" for good.
    notes: line.notes ?? "",
  }));
}

/** Livestock first, then the household — the order the work is done in. */
const SPECIES_ORDER: readonly Species[] = [
  ...SPECIES.filter((species) => audienceOf(species) === "livestock"),
  ...SPECIES.filter((species) => audienceOf(species) === "pet"),
];

/** Zones a ration can be put out in: not an area, a garden bed or off the place. */
const FEEDING_ZONE = (zone: Zone): boolean =>
  zone.type !== "area" && zone.type !== "garden_area" && zone.type !== "off_site";

export function FeedingPlanEditor({
  plan,
  species: startSpecies,
  lockSpecies = false,
  animals,
  flocks = [],
  zones = [],
  feeds,
  startWith = [],
  propertyId,
  actorId,
  onClose,
  onDeleted,
}: {
  /** The plan to change. Absent to write a new one. */
  readonly plan?: FeedingPlan | undefined;
  /** What a new plan starts as — the Cats page starts a cats' plan. */
  readonly species?: Species | undefined;
  /** Hold the species where it is — the cattle feed page writes cattle plans. */
  readonly lockSpecies?: boolean;
  /** Every animal on the place; the form offers the chosen species' own. */
  readonly animals: readonly Animal[];
  readonly flocks?: readonly PlanFlock[];
  readonly zones?: readonly Zone[];
  readonly feeds: readonly FeedType[];
  /** Animals ticked on a new plan — the pet whose page it was opened from. */
  readonly startWith?: readonly Ulid[];
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly onClose: () => void;
  readonly onDeleted?: () => void;
}) {
  const { api, toggle, remove } = usePlanActions(propertyId, actorId);
  const { show } = useToast();
  const formId = useId();
  const placesId = useId();
  const editing = plan !== undefined;

  const firstSpecies: Species =
    plan?.species ??
    startSpecies ??
    animals.find((animal) => startWith.includes(animal.id))?.species ??
    "cattle";

  const [species, setSpecies] = useState<Species>(firstSpecies);
  const [name, setName] = useState(plan?.name ?? "");
  const [animalIds, setAnimalIds] = useState<readonly Ulid[]>(
    plan === undefined ? startWith : animalsOf(plan),
  );
  const [flockIds, setFlockIds] = useState<readonly Ulid[]>(
    plan === undefined ? [] : flocksOf(plan),
  );
  const [portion, setPortion] = useState<Portion>(plan?.portion ?? "each");
  const [placeZoneId, setPlaceZoneId] = useState<string>(plan?.placeZoneId ?? "");
  const [place, setPlace] = useState(plan?.placeLabel ?? "");
  const [lines, setLines] = useState<LineDraft[]>(
    plan === undefined ? [blankLine(firstSpecies)] : linesFrom(plan),
  );
  const [notes, setNotes] = useState(plan?.specialNotes ?? "");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const pet = audienceOf(species) === "pet";
  const poultry = species === "chicken" || species === "quail";

  /**
   * Who can be ticked: this species, on the place — and anybody already on the
   * plan, so a plan still naming a sold steer can let go of him.
   */
  const candidates = useMemo(
    () =>
      animals
        .filter(
          (animal) =>
            animal.species === species && (isOnFarm(animal) || animalIds.includes(animal.id)),
        )
        .sort((left, right) => displayName(left).localeCompare(displayName(right))),
    [animals, species, animalIds],
  );
  const flockCandidates = flocks.filter((flock) => flock.species === species);

  /**
   * The feeds this species eats, by category — and any feed already on a line,
   * so a plan written before the catalogue knew better still opens intact.
   */
  const offered = useMemo(() => {
    const onLines = new Set(lines.map((line) => line.feedId));
    return feeds
      .filter((feed) => (feed.active && suits(feed.category, species)) || onLines.has(feed.id))
      .sort(
        (left, right) =>
          ["feed", "supplement", "treat"].indexOf(roleOf(left)) -
            ["feed", "supplement", "treat"].indexOf(roleOf(right)) ||
          left.name.localeCompare(right.name),
      );
  }, [feeds, species, lines]);
  const feedById = new Map<string, FeedType>(feeds.map((feed) => [feed.id, feed]));
  const receptacles = receptaclesFor(species);
  const heads = animalIds.length + flockIds.length;

  const editLine = (key: string, patch: Partial<LineDraft>): void =>
    setLines(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const dropLine = (key: string): void =>
    // crud-guard: allow-unconfirmed — taking a line out of a form that has not been saved
    setLines(lines.filter((line) => line.key !== key));

  function chooseSpecies(next: Species) {
    setSpecies(next);
    // A cow's members and a hay ring mean nothing on a cat's plan.
    setAnimalIds([]);
    setFlockIds([]);
    setPlaceZoneId("");
    setLines(lines.map((line) => ({ ...blankLine(next), key: line.key, notes: line.notes })));
  }

  function toggleIn(list: readonly Ulid[], id: Ulid): readonly Ulid[] {
    return list.includes(id) ? list.filter((held) => held !== id) : [...list, id];
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);

    if (heads === 0) {
      setError(poultry ? "Tick the flocks or birds this plan feeds" : "Tick who this plan feeds");
      return;
    }
    if (lines.length === 0 || lines.some((line) => line.feedId === "")) {
      setError("Choose what each line feeds");
      return;
    }
    if (lines.some((line) => !(Number(line.amount) > 0))) {
      setError("Each line needs an amount");
      return;
    }
    // `dailyDemandOf` refuses a plan that feeds one feed in two units, which
    // has no meaningful total; said here as a sentence instead.
    const mixed = mixedUnitFeed(lines);
    if (mixed !== undefined) {
      setError(
        `Two lines feed ${feedById.get(mixed)?.name ?? "the same feed"} in different units. Put both in the same one.`,
      );
      return;
    }
    if (wrongSpecies({ species, animalIds }, animals).length > 0) {
      setError(`Every animal on this plan has to be ${SPECIES_LABELS[species].toLowerCase()}.`);
      return;
    }

    setBusy(true);
    try {
      const written: FeedingPlanLine[] = lines.map((line) => ({
        feedTypeId: line.feedId as Ulid,
        amount: { amount: Number(line.amount), unit: line.unit },
        frequency: line.frequency,
        timeOfDay: line.timeOfDay,
        ...(line.receptacle === "" ? {} : { receptacle: line.receptacle }),
        ...(line.notes.trim() === "" ? {} : { notes: line.notes.trim() }),
      }));

      // Cleared fields travel as an explicit `undefined`: a patch that never
      // mentions a field keeps its old value, so a place somebody deleted
      // would come straight back.
      const fields = {
        name: name.trim(),
        species,
        animalIds: [...animalIds],
        flockIds: [...flockIds],
        // One head has nobody to share with, whatever the control last said.
        portion: heads <= 1 ? ("each" as const) : portion,
        placeZoneId: pet || placeZoneId === "" ? undefined : (placeZoneId as Ulid),
        placeLabel: place.trim() === "" ? undefined : place.trim(),
        lines: written,
        specialNotes: notes.trim() === "" ? undefined : notes.trim(),
      };

      const result = editing
        ? await api.update(plan.id, fields as Partial<FeedingPlan>)
        : await api.create({ ...fields, active: true } as never);

      if (!result.ok) {
        setError(
          result.error.kind === "validation"
            ? (result.error.issues[0]?.message ?? "That is not valid")
            : "Could not save that",
        );
        return;
      }

      show({ message: editing ? "Feeding plan saved" : "Feeding plan added", tone: "success" });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const speciesWord = SPECIES_LABELS[species].toLowerCase();

  return (
    <Modal
      placement="side"
      title={editing ? `Edit ${plan.name}` : "Add feeding plan"}
      onClose={onClose}
      footer={
        <>
          <Button variant="primary" type="submit" form={formId} busy={busy}>
            {editing ? "Save changes" : "Add feeding plan"}
          </Button>
          {editing ? (
            <Button
              onClick={() => {
                void toggle(plan);
                onClose();
              }}
            >
              {plan.active ? "Switch off" : "Switch on"}
            </Button>
          ) : (
            <Button onClick={onClose}>Cancel</Button>
          )}
          {editing ? (
            <Button
              variant="danger"
              className="ml-auto"
              onClick={() =>
                void remove(plan).then((gone) => {
                  if (!gone) return;
                  onClose();
                  onDeleted?.();
                })
              }
            >
              Delete
            </Button>
          ) : null}
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-density"
      >
        <TextInput
          label="Plan name"
          hint={pet ? "“Evening kibble”, “Cricket night”" : "“Show heifers, grain”"}
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />

        {lockSpecies ? null : (
          <Select
            label="Feeds"
            hint="One kind of animal per plan."
            value={species}
            onChange={(event) => chooseSpecies(event.target.value as Species)}
            options={SPECIES_ORDER.map((value) => ({ value, label: SPECIES_LABELS[value] }))}
          />
        )}

        {/* Who. Flocks first for poultry: hens are counted, not named. */}
        {flockCandidates.length === 0 ? null : (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-density font-medium text-ink">Flocks</legend>
            <div className="grid grid-cols-1 gap-x-density min-[400px]:grid-cols-2">
              {flockCandidates.map((flock) => (
                <Checkbox
                  key={flock.id}
                  label={`${flock.name} — ${flock.heads} birds`}
                  checked={flockIds.includes(flock.id)}
                  onChange={() => setFlockIds(toggleIn(flockIds, flock.id))}
                />
              ))}
            </div>
          </fieldset>
        )}

        <fieldset className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <legend className="text-density font-medium text-ink">
              {poultry ? "Birds kept on their own" : `Which ${speciesWord}`}
            </legend>
            {candidates.length > 1 ? (
              <Button
                variant="ghost"
                onClick={() =>
                  setAnimalIds(
                    animalIds.length === candidates.length
                      ? []
                      : candidates.map((animal) => animal.id),
                  )
                }
              >
                {animalIds.length === candidates.length ? "Clear all" : "Select all"}
              </Button>
            ) : null}
          </div>
          {candidates.length === 0 ? (
            <p className="text-sm text-muted">
              {poultry && flockCandidates.length > 0
                ? "None — the flocks above are the birds."
                : `No ${speciesWord} on the place yet.`}
            </p>
          ) : (
            <div className="grid max-h-64 grid-cols-1 gap-x-density overflow-y-auto min-[400px]:grid-cols-2">
              {candidates.map((animal) => (
                <Checkbox
                  key={animal.id}
                  label={displayName(animal)}
                  checked={animalIds.includes(animal.id)}
                  onChange={() => setAnimalIds(toggleIn(animalIds, animal.id))}
                />
              ))}
            </div>
          )}
        </fieldset>

        {heads <= 1 ? null : (
          <Select
            label="The amounts below are"
            hint={
              pet
                ? "Each: every one of them gets this. Together: one bowl between them."
                : "Each: 40 lb for four head is 160 lb. Together: one tub, however many there are."
            }
            value={portion}
            onChange={(event) => setPortion(event.target.value as Portion)}
            options={[
              { value: "each", label: "For each animal" },
              { value: "total", label: "For all of them together" },
            ]}
          />
        )}

        {/* Where. A pen for livestock; words for a pet, which has no zone. */}
        {pet ? (
          <>
            <TextInput
              label="Where they are fed"
              hint="Optional. Kitchen, porch, the enclosure."
              list={placesId}
              value={place}
              onChange={(event) => setPlace(event.target.value)}
            />
            <datalist id={placesId}>
              {(PET_FEEDING_PLACES[species] ?? []).map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>
          </>
        ) : (
          <div className="grid grid-cols-1 gap-density sm:grid-cols-2">
            <Select
              label="Where they are fed"
              value={placeZoneId}
              onChange={(event) => setPlaceZoneId(event.target.value)}
              options={[
                { value: "", label: "Not set" },
                ...zones
                  .filter((zone) => FEEDING_ZONE(zone) || zone.id === placeZoneId)
                  .map((zone) => ({ value: zone.id, label: zone.name })),
              ]}
            />
            <TextInput
              label="Spot"
              hint="Optional. “North end of the bunk.”"
              value={place}
              onChange={(event) => setPlace(event.target.value)}
            />
          </div>
        )}

        {offered.length === 0 ? (
          <p className="text-sm text-danger">
            No feed for {speciesWord} in the catalogue yet.{" "}
            <Link href="/admin/feed?view=shed" className="underline underline-offset-2">
              Add one in the shed
            </Link>{" "}
            — {FEED_CATEGORY_INFO[firstCategoryFor(species)].label.toLowerCase()}, for example.
          </p>
        ) : null}

        {lines.map((line, index) => (
          <fieldset
            key={line.key}
            className="grid grid-cols-2 gap-density rounded-density border border-rule p-3"
          >
            <legend className="px-1 text-sm font-medium text-muted">
              {lines.length === 1 ? "What they get" : `Feed ${index + 1}`}
            </legend>
            <div className="col-span-2">
              <Select
                label="Feed"
                value={line.feedId}
                onChange={(event) => {
                  const feed = feedById.get(event.target.value);
                  // The catalogue's unit is the starting point, nothing more —
                  // kibble bought by the bag is fed by the cup.
                  editLine(line.key, {
                    feedId: event.target.value,
                    ...(feed === undefined || audienceOf(species) === "pet"
                      ? {}
                      : { unit: feed.unit }),
                  });
                }}
                placeholder="Choose a feed"
                options={offered.map((feed) => ({
                  value: feed.id,
                  label: `${feed.name} — ${FEED_CATEGORY_INFO[feed.category]?.label ?? feed.category}`,
                }))}
                required
              />
            </div>
            <TextInput
              label="Amount"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={line.amount}
              onChange={(event) => editLine(line.key, { amount: event.target.value })}
              required
            />
            <Select
              label="Measured in"
              value={line.unit}
              onChange={(event) => editLine(line.key, { unit: event.target.value as Unit })}
              options={FEED_UNITS.map((value) => ({
                value,
                label: value === "each" ? "count (each)" : value.replace(/_/g, " "),
              }))}
            />
            <Select
              label="How often"
              value={line.frequency}
              onChange={(event) =>
                editLine(line.key, { frequency: event.target.value as FeedingFrequency })
              }
              options={FEEDING_FREQUENCIES.map((value) => ({ value, label: optionLabel(value) }))}
            />
            <Select
              label="When"
              value={line.timeOfDay}
              onChange={(event) =>
                editLine(line.key, { timeOfDay: event.target.value as TimeOfDay })
              }
              options={toOptions(TIMES_OF_DAY)}
            />
            <div className="col-span-2">
              <Select
                label="Fed from"
                value={line.receptacle}
                onChange={(event) =>
                  editLine(line.key, { receptacle: event.target.value as Receptacle | "" })
                }
                options={[
                  { value: "", label: "Not set" },
                  ...receptacles.map((value) => ({ value, label: RECEPTACLE_INFO[value].label })),
                ]}
              />
            </div>
            <div className="col-span-2">
              <TextInput
                label="Note"
                hint={pet ? "“Dust with calcium first.”" : "“Top-dress, don’t mix in.”"}
                value={line.notes}
                onChange={(event) => editLine(line.key, { notes: event.target.value })}
              />
            </div>

            <div className="col-span-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted">{describeLine(line, feedById.get(line.feedId))}</p>
              {lines.length === 1 ? null : (
                <Button variant="ghost" onClick={() => dropLine(line.key)}>
                  Remove
                </Button>
              )}
            </div>
          </fieldset>
        ))}

        <div>
          <Button variant="ghost" onClick={() => setLines([...lines, blankLine(species)])}>
            <PlusIcon />
            Add another feed
          </Button>
        </div>

        <TextArea
          label="Notes"
          hint="Anything the person feeding needs to know."
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
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

/** The first category a species eats — what the empty-catalogue hint suggests. */
function firstCategoryFor(species: Species) {
  const categories = Object.keys(FEED_CATEGORY_INFO) as (keyof typeof FEED_CATEGORY_INFO)[];
  return categories.find((category) => suits(category, species)) ?? "supplement";
}
