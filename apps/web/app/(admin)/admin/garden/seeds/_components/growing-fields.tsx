"use client";

import { Select, TextInput } from "@galaxy-farm/ui";
import {
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

export function GrowingFields({
  value,
  onChange,
  errors,
  status,
}: {
  readonly value: GrowingDraft;
  readonly onChange: (next: GrowingDraft) => void;
  readonly errors: Readonly<Record<string, string>>;
  readonly status?: string | undefined;
}) {
  const set = <Key extends keyof GrowingDraft>(key: Key, next: GrowingDraft[Key]) =>
    onChange({ ...value, [key]: next });

  return (
    <fieldset className="m-0 flex flex-col gap-density border-0 p-0">
      <legend className="mb-1 p-0 text-sm font-semibold text-ink">How it grows</legend>
      {status === undefined ? null : (
        <p className="m-0 text-xs text-muted" role="status">
          {status}
        </p>
      )}
      <div className="flex flex-col gap-density sm:grid sm:grid-cols-2">
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
    </fieldset>
  );
}
