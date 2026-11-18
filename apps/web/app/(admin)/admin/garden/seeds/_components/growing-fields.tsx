"use client";

import { Select, TextInput } from "@galaxy-farm/ui";
import {
  FROST_TOLERANCE_LABELS,
  FROST_TOLERANCES,
  LIFECYCLE_LABELS,
  LIFECYCLES,
  SEASON_LABELS,
  SEASONS,
  SOWING_LABELS,
  SOWING_METHODS,
  SUN_LABELS,
  SUN_NEEDS,
} from "@galaxy-farm/module-garden";

import type { GrowingDraft } from "@/lib/garden";

/**
 * "How it grows" on the crop form (spec §5.5): the seven facts a plant pick
 * fills in, each one editable, each one optional.
 *
 * `status` is the one line above them — where the figures came from, or that
 * they are being looked up — so a filled-in field is never mistaken for one
 * somebody typed off a packet.
 */

function options<Value extends string>(
  values: readonly Value[],
  labels: Readonly<Record<Value, string>>,
): { value: string; label: string }[] {
  return [
    { value: "", label: "Not recorded" },
    ...values.map((value) => ({ value, label: labels[value] })),
  ];
}

const SEASON_OPTIONS = options(SEASONS, SEASON_LABELS);
const LIFECYCLE_OPTIONS = options(LIFECYCLES, LIFECYCLE_LABELS);
const SUN_OPTIONS = options(SUN_NEEDS, SUN_LABELS);
const SOWING_OPTIONS = options(SOWING_METHODS, SOWING_LABELS);
const FROST_OPTIONS = options(FROST_TOLERANCES, FROST_TOLERANCE_LABELS);

export function GrowingFields({
  value,
  onChange,
  errors,
  status,
  legend = "How it grows",
  withoutDaysAndSpacing = false,
}: {
  readonly value: GrowingDraft;
  readonly onChange: (next: GrowingDraft) => void;
  readonly errors: Readonly<Record<string, string>>;
  readonly status?: string | undefined;
  readonly legend?: string;
  /** For the plant form, which asks for its own days and spacing above. */
  readonly withoutDaysAndSpacing?: boolean;
}) {
  const set = <Key extends keyof GrowingDraft>(key: Key, next: GrowingDraft[Key]) =>
    onChange({ ...value, [key]: next });

  return (
    <fieldset className="m-0 flex flex-col gap-density border-0 p-0">
      <legend className="mb-1 p-0 text-sm font-semibold text-ink">{legend}</legend>
      {status === undefined ? null : (
        <p className="m-0 text-xs text-muted" role="status">
          {status}
        </p>
      )}
      <div className="flex flex-col gap-density sm:grid sm:grid-cols-2">
        {withoutDaysAndSpacing ? null : (
          <>
            <TextInput
              label="Days to maturity"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              numeric
              hint="Typical. Each variety keeps its own."
              value={value.daysToMaturity}
              error={errors["daysToMaturity"]}
              onChange={(event) => set("daysToMaturity", event.target.value)}
            />
            <TextInput
              label="Spacing (inches)"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              numeric
              hint="Between plants in the row."
              value={value.spacingInches}
              error={errors["spacingInches"]}
              onChange={(event) => set("spacingInches", event.target.value)}
            />
          </>
        )}
        <Select
          label="Season"
          options={SEASON_OPTIONS}
          value={value.season}
          error={errors["season"]}
          onChange={(event) => set("season", event.target.value as GrowingDraft["season"])}
        />
        <Select
          label="Sun"
          options={SUN_OPTIONS}
          value={value.sun}
          error={errors["sun"]}
          onChange={(event) => set("sun", event.target.value as GrowingDraft["sun"])}
        />
        <Select
          label="Sowing"
          options={SOWING_OPTIONS}
          value={value.sowing}
          error={errors["sowing"]}
          onChange={(event) => set("sowing", event.target.value as GrowingDraft["sowing"])}
        />
        <Select
          label="Lifecycle"
          options={LIFECYCLE_OPTIONS}
          value={value.lifecycle}
          error={errors["lifecycle"]}
          onChange={(event) => set("lifecycle", event.target.value as GrowingDraft["lifecycle"])}
        />
        <TextInput
          label="Planting depth (inches)"
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          numeric
          value={value.depthInches}
          error={errors["depthInches"]}
          onChange={(event) => set("depthInches", event.target.value)}
        />
      </div>

      {/* When — every planting date in the garden is worked out from these
          and the farm's frost dates, so they are worth a heading of their own. */}
      <p className="m-0 text-sm font-semibold text-ink">When it goes in</p>
      <div className="flex flex-col gap-density sm:grid sm:grid-cols-2">
        <Select
          label="Cold"
          options={FROST_OPTIONS}
          value={value.frostTolerance}
          error={errors["frostTolerance"]}
          onChange={(event) =>
            set("frostTolerance", event.target.value as GrowingDraft["frostTolerance"])
          }
        />
        <TextInput
          label="Days to sprout"
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          numeric
          value={value.germinationDays}
          error={errors["germinationDays"]}
          onChange={(event) => set("germinationDays", event.target.value)}
        />
        <TextInput
          label="Start indoors (weeks before last frost)"
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          numeric
          hint="Blank for a crop sown where it grows."
          value={value.startIndoorsWeeks}
          error={errors["startIndoorsWeeks"]}
          onChange={(event) => set("startIndoorsWeeks", event.target.value)}
        />
        <TextInput
          label="Plant out (weeks from last frost)"
          type="number"
          inputMode="decimal"
          step="any"
          numeric
          hint="−4 is a month before it; 2 is a fortnight after."
          value={value.plantOutWeeks}
          error={errors["plantOutWeeks"]}
          onChange={(event) => set("plantOutWeeks", event.target.value)}
        />
        <TextInput
          label="Harvest lasts (weeks)"
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          numeric
          value={value.harvestWeeks}
          error={errors["harvestWeeks"]}
          onChange={(event) => set("harvestWeeks", event.target.value)}
        />
        <TextInput
          label="Sow again every (days)"
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          numeric
          hint="For a steady supply. Blank if it is sown once."
          value={value.successionDays}
          error={errors["successionDays"]}
          onChange={(event) => set("successionDays", event.target.value)}
        />
        <TextInput
          label="Plant in fall (weeks before first frost)"
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          numeric
          hint="Garlic and other crops that overwinter."
          value={value.fallPlantWeeks}
          error={errors["fallPlantWeeks"]}
          onChange={(event) => set("fallPlantWeeks", event.target.value)}
        />
      </div>
    </fieldset>
  );
}
