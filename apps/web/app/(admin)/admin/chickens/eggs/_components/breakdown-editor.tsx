"use client";

import { useState } from "react";

import { Button, Select, TextInput } from "@galaxy-farm/ui";
import {
  EGG_COLOURS,
  EGG_SIZES,
  type EggBreakdown,
  type EggColour,
  type EggSize,
} from "@galaxy-farm/module-poultry";

/**
 * The optional half of an egg log (spec §5.4).
 *
 * §5.4 calls the breakdown optional and §8 says logging must be fast, so this
 * is deliberately not a grid of thirty-six buttons — one row at a time, added
 * by whoever cares which hens are laying, ignored entirely by whoever is
 * carrying a bucket in from the rain.
 *
 * The total is not asked for once a row exists: the schema refuses a breakdown
 * that does not add up to the total, and the only way to be sure a person
 * never meets that error is to stop making them enter both numbers.
 */

const COLOUR_LABEL: Readonly<Record<EggColour, string>> = {
  brown: "Brown",
  white: "White",
  blue: "Blue",
  green: "Green",
  cream: "Cream",
  speckled: "Speckled",
};

const SIZE_LABEL: Readonly<Record<EggSize, string>> = {
  peewee: "Peewee",
  small: "Small",
  medium: "Medium",
  large: "Large",
  extra_large: "Extra large",
  jumbo: "Jumbo",
};

export function describeBreakdown(rows: readonly EggBreakdown[]): string {
  return rows
    .map((row) => `${row.count} ${COLOUR_LABEL[row.colour].toLowerCase()} ${SIZE_LABEL[row.size]}`)
    .join(", ");
}

export function breakdownSum(rows: readonly EggBreakdown[]): number {
  return rows.reduce((total, row) => total + row.count, 0);
}

export function BreakdownEditor({
  rows,
  onChange,
  error,
}: {
  readonly rows: readonly EggBreakdown[];
  readonly onChange: (rows: readonly EggBreakdown[]) => void;
  readonly error?: string | undefined;
}) {
  const [colour, setColour] = useState<EggColour>("brown");
  const [size, setSize] = useState<EggSize>("large");
  const [count, setCount] = useState("1");

  function add() {
    const quantity = Math.trunc(Number(count));
    if (!Number.isFinite(quantity) || quantity <= 0) return;

    // Same colour and size twice is one line, not two. Two lines is what
    // happens when somebody adds the browns, then finds three more browns.
    const existing = rows.findIndex((row) => row.colour === colour && row.size === size);
    onChange(
      existing === -1
        ? [...rows, { colour, size, count: quantity }]
        : rows.map((row, index) =>
            index === existing ? { ...row, count: row.count + quantity } : row,
          ),
    );
    setCount("1");
  }

  return (
    <div className="flex flex-col gap-density">
      <div className="grid grid-cols-1 gap-density sm:grid-cols-4">
        <Select
          label="Colour"
          value={colour}
          options={EGG_COLOURS.map((value) => ({ value, label: COLOUR_LABEL[value] }))}
          onChange={(event) => setColour(event.target.value as EggColour)}
        />
        <Select
          label="Size"
          value={size}
          options={EGG_SIZES.map((value) => ({ value, label: SIZE_LABEL[value] }))}
          onChange={(event) => setSize(event.target.value as EggSize)}
        />
        <TextInput
          label="How many"
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          numeric
          value={count}
          error={error}
          onChange={(event) => setCount(event.target.value)}
        />
        <div className="flex items-end">
          <Button onClick={add}>Add to the breakdown</Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">
          No breakdown — the total stands on its own, which is all the trends report needs. Add rows
          only when it is worth knowing which hens are laying.
        </p>
      ) : (
        <ul className="flex flex-wrap items-center gap-2" aria-label="The breakdown so far">
          {rows.map((row, index) => (
            <li key={`${row.colour}-${row.size}`}>
              {/* The same chip the tag input uses — the × belongs inside the
                  thing it takes out, or a row of them reads as its own list. */}
              <span className="inline-flex items-center gap-1 rounded-full border border-edge bg-raised px-3 py-1 text-sm text-ink">
                {row.count} {COLOUR_LABEL[row.colour].toLowerCase()} {SIZE_LABEL[row.size]}
                <button
                  type="button"
                  aria-label={`Take out ${COLOUR_LABEL[row.colour].toLowerCase()} ${SIZE_LABEL[row.size]}`}
                  onClick={() => onChange(rows.filter((_, at) => at !== index))}
                  className="rounded-full px-1 text-muted hover:text-danger"
                >
                  ×
                </button>
              </span>
            </li>
          ))}
          <li className="text-sm text-muted">
            adds up to <strong className="text-ink">{breakdownSum(rows)}</strong>, which is the
            total
          </li>
        </ul>
      )}
    </div>
  );
}
