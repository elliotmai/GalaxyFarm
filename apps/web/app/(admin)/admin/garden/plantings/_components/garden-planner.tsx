"use client";

import { useMemo, useState } from "react";

import {
  Button,
  Callout,
  Checkbox,
  Modal,
  Select,
  SEGMENT_TRACK_CLASS,
  segmentClass,
  TextInput,
  useToast,
} from "@galaxy-farm/ui";
import type { Ulid } from "@galaxy-farm/core";
import {
  cropFamily,
  cropSchema,
  hasFallPlanting,
  MILESTONE_LABELS,
  planGarden,
  plannedPlantingSchema,
  seasonPlanSchema,
  suggestedCount,
  usualStart,
  varietySchema,
  type Bed,
  type Crop,
  type FrostDates,
  type GrowingFacts,
  type PlannedPlanting,
  type Planting,
  type PlanRow,
  type SeasonPlan,
  type StartFrom,
  type Variety,
} from "@galaxy-farm/module-garden";

import {
  figuresFor,
  growsLikeFacts,
  resolveGrowsLike,
} from "@/app/(admin)/admin/garden/seeds/_components/plants-panel";
import {
  PlantSuggestions,
  type PlantPick,
} from "@/app/(admin)/admin/garden/seeds/_components/plant-suggestions";
import {
  byId,
  cropFields,
  familyHistory,
  growingDraft,
  varietyFacts,
  varietyLabel,
} from "@/lib/garden";
import { useMutations } from "@/lib/local/mutations";

/**
 * Plan my garden (spec §5.5): what you want to grow, for which years, and the
 * app works out when and where.
 *
 * Three steps, each one screen: the wish list (with how many, how it is
 * started, and whether it goes in again for fall), the years, and the plan
 * itself to look over — every planting with its dates and a bed, the bed
 * changeable, the reasons shown. Saving writes it into each year's season
 * plan, and from there Up next, the calendar and the reminders carry it:
 * the planner only ever adds plan entries, so nothing here is new machinery.
 *
 * A plant the garden has not got yet can be wished for by name; it is added
 * to Plants (and what it grows like, if that is new) when the plan is saved.
 */

interface Wish {
  readonly key: string;
  /** An existing plant, or one to add on save. */
  readonly varietyId?: Ulid | undefined;
  readonly name: string;
  readonly pick?: PlantPick | undefined;
  readonly count: string;
  readonly start: StartFrom;
  readonly fall: boolean;
}

const START_LABELS: Readonly<Record<StartFrom, string>> = {
  indoor_start: "Seed, indoors",
  direct_sow: "Seed, outside",
  transplant: "Bought seedlings",
};

/** Ways a crop can sensibly be started, its usual way first. */
function startsFor(facts: GrowingFacts | undefined): StartFrom[] {
  if (facts === undefined) return ["direct_sow", "indoor_start", "transplant"];
  const usual = usualStart(facts);
  const all: StartFrom[] =
    facts.sowing === "direct"
      ? ["direct_sow", "transplant"]
      : facts.sowing === "transplant"
        ? ["indoor_start", "transplant"]
        : ["direct_sow", "indoor_start", "transplant"];
  return [usual, ...all.filter((start) => start !== usual)];
}

const fold = (value: string) => value.trim().toLowerCase();

function shortDate(date: Date): string {
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function span(from: Date, to: Date): string {
  return from.getTime() === to.getTime()
    ? shortDate(from)
    : `${shortDate(from)} – ${shortDate(to)}`;
}

/** The year a plan for "this season" means: next year once this one's frost has come. */
function firstYear(now: Date, frostFor: (year: number) => FrostDates | undefined): number {
  const frost = frostFor(now.getFullYear());
  return frost !== undefined && now > frost.firstFallFrost
    ? now.getFullYear() + 1
    : now.getFullYear();
}

export function GardenPlanner({
  varieties,
  crops,
  beds,
  plantings,
  plans,
  planned,
  frostFor,
  propertyId,
  actorId,
  onClose,
  now = new Date(),
}: {
  readonly varieties: readonly Variety[];
  readonly crops: readonly Crop[];
  readonly beds: readonly Bed[];
  readonly plantings: readonly Planting[];
  readonly plans: readonly SeasonPlan[];
  readonly planned: readonly PlannedPlanting[];
  readonly frostFor: (year: number) => FrostDates | undefined;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly onClose: () => void;
  readonly now?: Date;
}) {
  const varietyApi = useMutations<Variety>(
    "varieties",
    "varieties",
    varietySchema,
    propertyId,
    actorId,
  );
  const cropApi = useMutations<Crop>("crops", "crops", cropSchema, propertyId, actorId);
  const planApi = useMutations<SeasonPlan>(
    "seasonPlans",
    "seasonPlans",
    seasonPlanSchema,
    propertyId,
    actorId,
  );
  const entryApi = useMutations<PlannedPlanting>(
    "plannedPlantings",
    "plannedPlantings",
    plannedPlantingSchema,
    propertyId,
    actorId,
  );
  const { show } = useToast();

  const start = firstYear(now, frostFor);
  const yearChoices = [start, start + 1, start + 2];

  const [step, setStep] = useState<"want" | "years" | "review">("want");
  const [wishes, setWishes] = useState<Wish[]>([]);
  const [query, setQuery] = useState("");
  const [years, setYears] = useState<number[]>([start]);
  /** Beds changed by hand on the review, by row key. */
  const [bedOverride, setBedOverride] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const openBeds = beds.filter((bed) => bed.active);

  /** How a wish grows: an existing plant's facts, or the table's for its name. */
  function factsOf(wish: Pick<Wish, "varietyId" | "name" | "pick">): GrowingFacts | undefined {
    if (wish.varietyId !== undefined) return varietyFacts(wish.varietyId, varieties, crops);
    const resolved = resolveGrowsLike(wish.name, crops, "", wish.pick);
    return wish.pick?.growing ?? figuresFor(wish.name, resolved) ?? growsLikeFacts(resolved);
  }

  function cropOf(wish: Wish): { name: string; family: string | undefined } {
    if (wish.varietyId !== undefined) {
      const variety = byId(varieties).get(wish.varietyId);
      const crop = variety === undefined ? undefined : byId(crops).get(variety.cropId);
      return { name: crop?.name ?? wish.name, family: cropFamily(crop) };
    }
    const resolved = resolveGrowsLike(wish.name, crops, "", wish.pick);
    if (resolved?.kind === "existing") {
      return { name: resolved.crop.name, family: cropFamily(resolved.crop) };
    }
    return {
      name: resolved?.name ?? wish.name,
      family: cropFamily({
        name: resolved?.name ?? wish.name,
        family: resolved?.family || undefined,
        scientificName: resolved?.scientificName,
      }),
    };
  }

  function add(name: string, pick?: PlantPick) {
    const existing = varieties.find((variety) => fold(variety.name) === fold(name));
    const key = existing?.id ?? `new:${fold(name)}`;
    if (wishes.some((wish) => wish.key === key)) {
      setQuery("");
      return;
    }
    const base = { varietyId: existing?.id, name: existing?.name ?? name, pick };
    const facts = factsOf(base);
    setWishes([
      ...wishes,
      {
        key,
        ...base,
        count: String(suggestedCount(facts)),
        start: startsFor(facts)[0] ?? "direct_sow",
        fall: hasFallPlanting(facts, frostFor(start)),
      },
    ]);
    setQuery("");
  }

  const update = (key: string, patch: Partial<Wish>) =>
    setWishes(wishes.map((wish) => (wish.key === key ? { ...wish, ...patch } : wish)));

  // Your plants not yet on the list, to tap rather than search for.
  const yours = varieties
    .filter((variety) => !wishes.some((wish) => wish.varietyId === variety.id))
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, 12);

  const result = useMemo(() => {
    if (step !== "review") return undefined;
    const history = [
      ...familyHistory(plantings, varieties, crops),
      // What is already planned somewhere counts for the rotation too.
      ...planned.flatMap((entry) => {
        if (entry.planStatus !== "open" || entry.bedId === undefined) return [];
        const variety = byId(varieties).get(entry.varietyId);
        const family = cropFamily(
          variety === undefined ? undefined : byId(crops).get(variety.cropId),
        );
        return family === undefined
          ? []
          : [{ bedId: entry.bedId, family, plantedOn: entry.windowFrom }];
      }),
    ];
    return planGarden({
      wants: wishes.map((wish) => {
        const crop = cropOf(wish);
        return {
          varietyId: (wish.varietyId ?? wish.key) as Ulid,
          name: wish.name,
          cropName: crop.name,
          family: crop.family,
          facts: factsOf(wish),
          count: Math.max(1, Math.round(Number(wish.count) || 1)),
          start: wish.start,
          fall: wish.fall,
        };
      }),
      beds: openBeds,
      history,
      frostFor,
      years,
    });
  }, [step, wishes, years, plantings, planned, varieties, crops, beds]);

  const rowKey = (row: PlanRow) => `${row.varietyId}:${row.year}:${row.season}`;
  const bedFor = (row: PlanRow) => bedOverride[rowKey(row)] ?? row.bedId ?? "";

  async function save() {
    if (result === undefined) return;
    setSaving(true);
    try {
      // 1. Plants that are only wished for yet: added, with what they grow like.
      const idFor = new Map<string, Ulid>();
      for (const wish of wishes) {
        if (wish.varietyId !== undefined) {
          idFor.set(wish.varietyId, wish.varietyId);
          continue;
        }
        const resolved = resolveGrowsLike(wish.name, crops, "", wish.pick);
        if (resolved === undefined) continue;
        let cropId: Ulid;
        if (resolved.kind === "existing") cropId = resolved.crop.id;
        else {
          const created = await cropApi.create(
            cropFields({
              name: resolved.name,
              scientificName: resolved.scientificName,
              family: resolved.family,
              growing: growingDraft(resolved.growing),
            }) as never,
          );
          if (!created.ok) throw new Error(`Could not add ${resolved.name}`);
          cropId = created.value.id;
        }
        const facts = factsOf(wish);
        const variety = await varietyApi.create({
          cropId,
          name: wish.name,
          ...(facts?.daysToMaturity === undefined ? {} : { daysToMaturity: facts.daysToMaturity }),
          ...(facts?.spacingInches === undefined ? {} : { spacingInches: facts.spacingInches }),
        } as never);
        if (!variety.ok) throw new Error(`Could not add ${wish.name}`);
        idFor.set(wish.key, variety.value.id);
      }

      // 2. A season plan for each year: the year's active one, else a new one.
      const planFor = new Map<number, Ulid>();
      for (const year of years) {
        const existing = plans.find((plan) => plan.year === year && plan.active);
        if (existing !== undefined) {
          planFor.set(year, existing.id);
          continue;
        }
        const created = await planApi.create({
          name: `${year} garden`,
          year,
          active: true,
        } as never);
        if (!created.ok) throw new Error(`Could not start the ${year} plan`);
        planFor.set(year, created.value.id);
      }

      // 3. The entries — skipping any already planned for the same plant and day.
      let added = 0;
      for (const row of result.rows) {
        const varietyId = idFor.get(row.varietyId);
        const seasonPlanId = planFor.get(row.year);
        if (varietyId === undefined || seasonPlanId === undefined) continue;
        const duplicate = planned.some(
          (entry) =>
            entry.varietyId === varietyId &&
            entry.planStatus === "open" &&
            shortDate(entry.windowFrom) === shortDate(row.step.from) &&
            entry.windowFrom.getFullYear() === row.step.from.getFullYear(),
        );
        if (duplicate) continue;
        const bed = bedFor(row);
        const created = await entryApi.create({
          seasonPlanId,
          varietyId,
          method: row.method,
          ...(bed === "" ? {} : { bedId: bed }),
          windowFrom: row.step.from,
          windowTo: row.step.to,
          quantity: row.count,
          planStatus: "open",
          ...(row.notes.length === 0 ? {} : { notes: row.notes.join(". ") }),
        } as never);
        if (created.ok) added += 1;
      }

      show({
        message: `${added} planting${added === 1 ? "" : "s"} planned — they show in Up next as their dates come round`,
        tone: "success",
      });
      onClose();
    } catch (error) {
      show({
        message: error instanceof Error ? error.message : "Could not save the plan",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  }

  /* --------------------------------------------------------------- views */

  const footer =
    step === "want" ? (
      <>
        <Button variant="primary" disabled={wishes.length === 0} onClick={() => setStep("years")}>
          Next: which years
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </>
    ) : step === "years" ? (
      <>
        <Button variant="primary" disabled={years.length === 0} onClick={() => setStep("review")}>
          Next: see the plan
        </Button>
        <Button onClick={() => setStep("want")}>Back</Button>
      </>
    ) : (
      <>
        <Button
          variant="primary"
          disabled={saving || result === undefined || result.rows.length === 0}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save the plan"}
        </Button>
        <Button onClick={() => setStep("years")}>Back</Button>
      </>
    );

  return (
    <Modal
      title="Plan my garden"
      description={
        step === "want"
          ? "What do you want to grow? Add everything — how many, and how you will start it."
          : step === "years"
            ? "For which years? Each year rotates what goes where."
            : "When and where for each. Change a bed if you like; the dates follow your frost dates."
      }
      size="wide"
      onClose={onClose}
      footer={footer}
    >
      <ol aria-label="Steps" className="m-0 flex list-none gap-2 p-0 text-xs text-muted">
        {(["want", "years", "review"] as const).map((id, index) => (
          <li key={id} className={step === id ? "font-semibold text-ink" : undefined}>
            {index + 1}. {id === "want" ? "What" : id === "years" ? "Years" : "Plan"}
          </li>
        ))}
      </ol>

      {step === "want" ? (
        <div className="flex flex-col gap-density">
          <div className="flex flex-col gap-1">
            <TextInput
              label="Add something to grow"
              placeholder="Jalapeño, cherry tomato, garlic, zinnias…"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && query.trim() !== "") {
                  event.preventDefault();
                  add(query.trim());
                }
              }}
            />
            <PlantSuggestions
              query={query}
              onPick={(pick) => add(pick.commonName, pick)}
              label="Plants to add"
            />
          </div>

          {yours.length === 0 ? null : (
            <div className="flex flex-col gap-1">
              <p className="gf-label m-0">From your plants</p>
              <div className="flex flex-wrap gap-2">
                {yours.map((variety) => (
                  <button
                    key={variety.id}
                    type="button"
                    onClick={() => add(variety.name)}
                    className="min-h-target rounded-full border border-rule bg-panel px-3 text-sm text-ink hover:border-action"
                  >
                    + {variety.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {wishes.length === 0 ? (
            <p className="text-sm text-muted">Nothing on the list yet.</p>
          ) : (
            <ul aria-label="To grow" className="m-0 flex list-none flex-col gap-2 p-0">
              {wishes.map((wish) => {
                const facts = factsOf(wish);
                const fallOk = hasFallPlanting(facts, frostFor(start));
                return (
                  <li
                    key={wish.key}
                    aria-label={wish.name}
                    className="flex flex-col gap-2 rounded-density border border-rule p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-col">
                        <span className="font-medium text-ink">{wish.name}</span>
                        <span className="text-xs text-muted">
                          {wish.varietyId === undefined
                            ? "New — added to Plants when saved"
                            : varietyLabel(byId(varieties).get(wish.varietyId), crops)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setWishes(wishes.filter((held) => held.key !== wish.key))}
                        aria-label={`Remove ${wish.name}`}
                        className="min-h-target shrink-0 rounded-density px-2 text-sm font-semibold text-muted hover:text-danger"
                      >
                        Remove
                      </button>
                    </div>
                    {/* Side by side even on a phone: two short answers, one row. */}
                    <div className="grid grid-cols-[5.5rem_1fr] items-end gap-2">
                      <TextInput
                        label="How many"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        numeric
                        value={wish.count}
                        onChange={(event) => update(wish.key, { count: event.target.value })}
                      />
                      <Select
                        label="Start from"
                        options={startsFor(facts).map((value) => ({
                          value,
                          label: START_LABELS[value],
                        }))}
                        value={wish.start}
                        onChange={(event) =>
                          update(wish.key, { start: event.target.value as StartFrom })
                        }
                      />
                    </div>
                    {fallOk ? (
                      <Checkbox
                        label="Plant again for fall"
                        checked={wish.fall}
                        onChange={(event) => update(wish.key, { fall: event.target.checked })}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {step === "years" ? (
        <div className="flex flex-col gap-density">
          <div role="group" aria-label="Years" className={SEGMENT_TRACK_CLASS}>
            {yearChoices.map((year) => {
              const on = years.includes(year);
              return (
                <button
                  key={year}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setYears(on ? years.filter((held) => held !== year) : [...years, year].sort())
                  }
                  className={segmentClass(on)}
                >
                  {year}
                </button>
              );
            })}
          </div>
          {frostFor(start) === undefined ? (
            <Callout tone="danger" title="No frost dates yet">
              Set the growing zone, or your own frost dates, in Settings → Farm. Every date in the
              plan is worked out from them.
            </Callout>
          ) : (
            <p className="text-sm text-muted">
              Over more than one year the same plants move round the beds, so no family goes back
              where it was within three years.
            </p>
          )}
          {openBeds.length === 0 ? (
            <Callout tone="action" title="No beds yet">
              The plan will still say when; add beds under Beds and it will say where too.
            </Callout>
          ) : null}
        </div>
      ) : null}

      {step === "review" && result !== undefined ? (
        <div className="flex flex-col gap-density">
          {result.unscheduled.map((entry) => (
            <Callout key={entry.name} tone="action" title={`${entry.name}: no dates`}>
              {entry.why}
            </Callout>
          ))}
          {years.map((year) => {
            const rows = result.rows.filter((row) => row.year === year);
            if (rows.length === 0) return null;
            return (
              <section key={year} aria-label={`${year}`} className="flex flex-col gap-2">
                <h3 className="gf-label m-0">{year}</h3>
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {rows.map((row) => {
                    const harvest = row.steps.find((step) => step.kind === "harvest");
                    return (
                      <li
                        key={rowKey(row)}
                        aria-label={`${row.name} ${row.season} ${year}`}
                        className="flex flex-col gap-2 rounded-density border border-rule p-3 sm:flex-row sm:items-start"
                      >
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="font-medium text-ink">
                            {row.name} × {row.count}
                            {row.season === "fall" ? " · fall" : ""}
                          </span>
                          <span className="text-sm text-ink">
                            {row.steps
                              .filter((step) => step.kind !== "harvest")
                              .map(
                                (step) =>
                                  `${MILESTONE_LABELS[step.kind]} ${span(step.from, step.to)}`,
                              )
                              .join(" → ")}
                          </span>
                          {harvest === undefined ? null : (
                            <span className="text-sm text-muted">
                              Pick {span(harvest.from, harvest.to)} · {Math.ceil(row.area)} sq ft
                            </span>
                          )}
                          {row.notes.map((note) => (
                            <span key={note} className="text-xs text-danger">
                              {note}
                            </span>
                          ))}
                        </div>
                        <Select
                          label="Bed"
                          options={[
                            { value: "", label: "No bed yet" },
                            ...openBeds.map((bed) => ({ value: bed.id, label: bed.name })),
                          ]}
                          value={bedFor(row)}
                          onChange={(event) =>
                            setBedOverride({ ...bedOverride, [rowKey(row)]: event.target.value })
                          }
                        />
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      ) : null}
    </Modal>
  );
}
