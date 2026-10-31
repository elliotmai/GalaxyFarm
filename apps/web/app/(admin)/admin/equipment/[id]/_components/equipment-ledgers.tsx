"use client";

import type { ReactNode } from "react";

import { Button, DetailList, EmptyState, Pill } from "@galaxy-farm/ui";
import { formatMoney, type Money } from "@galaxy-farm/core";
import {
  currentMeter,
  fuelEfficiency,
  type Equipment,
  type FuelLog,
  type MaintenanceDue,
  type MaintenanceLog,
  type MaintenanceRule,
  type MeterReading,
} from "@galaxy-farm/module-equipment";

import { KitList, KitRow } from "../../_components/kit-controls";
import { describeDue, formatDate, line, meterAt, num } from "./equipment-format";

/**
 * The tabs of one machine's page, as lists (spec §5.6).
 *
 * These only show. Every add, edit and delete is a side panel the screen owns,
 * reached from the button at the top of the tab or from a row, so a tab is a
 * line of facts, one button, and the rows — newest first, a row per entry,
 * the date and the numbers on one muted line.
 */

/** The top of a tab: what it adds up to, and the one thing to do in it. */
function LedgerHead({
  facts,
  action,
}: {
  readonly facts: string | undefined;
  readonly action: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-muted">{facts}</p>
      {action}
    </div>
  );
}

/* ----------------------------------------------------------------- meters */

export function MetersTab({
  machine,
  readings,
  rules,
  onAdd,
  onEdit,
}: {
  readonly machine: Equipment;
  readonly readings: readonly MeterReading[];
  readonly rules: readonly MaintenanceRule[];
  readonly onAdd: () => void;
  readonly onEdit: (reading: MeterReading) => void;
}) {
  const hours = currentMeter(readings, machine.id, "hours");
  const miles = currentMeter(readings, machine.id, "miles");

  /** Rules that will never come due while this meter is unread. */
  const waiting = rules.filter(
    (rule) =>
      rule.active &&
      ((rule.everyHours !== undefined && hours === undefined) ||
        (rule.everyMiles !== undefined && miles === undefined)),
  );

  return (
    <div className="flex flex-col gap-density">
      <LedgerHead
        facts={meterAt(hours, miles) ?? "Never read"}
        action={
          <Button variant="primary" onClick={onAdd}>
            Read meter
          </Button>
        }
      />

      {/* One line, not a callout: it is the reason a rule is silent, and the
          button beside it is the fix. */}
      {waiting.length === 0 ? null : (
        <p className="text-sm text-action">
          Waiting on a first reading: {waiting.map((rule) => rule.task).join(", ")}
        </p>
      )}

      {readings.length === 0 ? (
        <EmptyState
          title="Never read"
          detail="Hours and miles are what the maintenance rules count against."
        />
      ) : (
        <KitList label={`Meter readings for ${machine.name}`}>
          {[...readings]
            .sort((a, b) => b.readOn.getTime() - a.readOn.getTime())
            .map((reading) => (
              <KitRow
                key={reading.id}
                title={`${num(reading.value, 1)} ${reading.kind}`}
                line={line(formatDate(reading.readOn), reading.notes)}
                onOpen={() => onEdit(reading)}
                openLabel={`Edit the ${reading.kind} reading of ${formatDate(reading.readOn)}`}
              />
            ))}
        </KitList>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ maintenance */

export function MaintenanceTab({
  rules,
  due,
  readings,
  onAdd,
  onEdit,
  onRecord,
}: {
  readonly rules: readonly MaintenanceRule[];
  readonly due: readonly MaintenanceDue[];
  readonly readings: readonly MeterReading[];
  readonly onAdd: () => void;
  readonly onEdit: (rule: MaintenanceRule) => void;
  readonly onRecord: (rule: MaintenanceRule) => void;
}) {
  const dueByRule = new Map(due.map((entry) => [entry.rule.id, entry]));
  const active = rules.filter((rule) => rule.active).length;

  /**
   * The one chip on a rule: overdue, or why it will not come due. A rule that
   * is simply counting down says so on its muted line and has no chip — a
   * column of green "ok" is a column nobody reads.
   */
  function chipFor(rule: MaintenanceRule, entry: MaintenanceDue | undefined) {
    if (entry?.overdue === true)
      return (
        <Pill tone="danger" dot>
          Overdue
        </Pill>
      );
    if (!rule.active) return <Pill>Off</Pill>;
    if (entry === undefined) return <Pill>Waiting on a meter</Pill>;
    return null;
  }

  return (
    <div className="flex flex-col gap-density">
      <LedgerHead
        facts={rules.length === 0 ? undefined : `${active} of ${rules.length} asking`}
        action={
          <Button variant="primary" onClick={onAdd}>
            Add rule
          </Button>
        }
      />

      {rules.length === 0 ? (
        <EmptyState
          title="No rules yet"
          detail="Nothing on this machine will ever come due. The manual is the usual source."
        />
      ) : (
        <KitList label="What it needs">
          {[...rules]
            .sort((left, right) => {
              const rank = (rule: MaintenanceRule) =>
                dueByRule.get(rule.id)?.overdue === true ? 0 : rule.active ? 1 : 2;
              return rank(left) - rank(right) || left.task.localeCompare(right.task);
            })
            .map((rule) => {
              const entry = dueByRule.get(rule.id);
              const every = [
                rule.everyHours === undefined ? undefined : `${num(rule.everyHours)} hrs`,
                rule.everyMiles === undefined ? undefined : `${num(rule.everyMiles)} mi`,
                rule.everyMonths === undefined ? undefined : `${num(rule.everyMonths)} months`,
              ]
                .filter(Boolean)
                .join(" or ");
              return (
                <KitRow
                  key={rule.id}
                  title={rule.task}
                  line={line(
                    entry === undefined ? undefined : `Next ${describeDue(entry)}`,
                    every === "" ? undefined : `every ${every}`,
                    rule.parts,
                  )}
                  chip={chipFor(rule, entry)}
                  trailing={
                    <Button variant="ghost" onClick={() => onRecord(rule)}>
                      Record
                    </Button>
                  }
                  onEdit={() => onEdit(rule)}
                  editLabel={`Edit ${rule.task}`}
                />
              );
            })}
        </KitList>
      )}
      {readings.length === 0 && rules.length > 0 ? (
        <p className="text-sm text-muted">
          Nothing here can come due on hours or miles until the meter has been read once.
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ service log */

export function ServiceTab({
  machine,
  rules,
  logs,
  onAdd,
  onEdit,
}: {
  readonly machine: Equipment;
  readonly rules: readonly MaintenanceRule[];
  readonly logs: readonly MaintenanceLog[];
  readonly onAdd: () => void;
  readonly onEdit: (log: MaintenanceLog) => void;
}) {
  const byRule = new Map(rules.map((rule) => [rule.id, rule]));
  const spent: Money = {
    cents: logs.reduce((total, log) => total + (log.cost?.cents ?? 0), 0),
  };

  return (
    <div className="flex flex-col gap-density">
      <LedgerHead
        facts={logs.length === 0 ? undefined : `${formatMoney(spent)} in service to date`}
        action={
          <Button variant="primary" onClick={onAdd}>
            Record service
          </Button>
        }
      />

      {logs.length === 0 ? (
        <EmptyState
          title="Nothing recorded"
          detail="A service history is what a rule counts from, and the first thing a buyer asks for."
        />
      ) : (
        <KitList label={`Service log for ${machine.name}`}>
          {[...logs]
            .sort((a, b) => b.performedOn.getTime() - a.performedOn.getTime())
            .map((log) => (
              <KitRow
                key={log.id}
                title={log.task}
                line={line(
                  formatDate(log.performedOn),
                  meterAt(log.hours, log.miles),
                  log.cost === undefined ? undefined : formatMoney(log.cost),
                  againstLabel(log, log.ruleId === undefined ? undefined : byRule.get(log.ruleId)),
                )}
                onOpen={() => onEdit(log)}
                openLabel={`Edit ${log.task} on ${formatDate(log.performedOn)}`}
              />
            ))}
        </KitList>
      )}
    </div>
  );
}

/**
 * Which rule an entry answered to — said only when the job's own words do not
 * already say it, so the line is not "Oil change · … · Oil change".
 */
function againstLabel(log: MaintenanceLog, rule: MaintenanceRule | undefined): string | undefined {
  if (log.ruleId === undefined) return "one-off";
  if (rule === undefined) return "a deleted rule";
  return rule.task === log.task ? undefined : `for ${rule.task}`;
}

/* ------------------------------------------------------------------- fuel */

export function FuelTab({
  machine,
  fuel,
  onAdd,
  onEdit,
}: {
  readonly machine: Equipment;
  readonly fuel: readonly FuelLog[];
  readonly onAdd: () => void;
  readonly onEdit: (log: FuelLog) => void;
}) {
  const mpg = fuelEfficiency(fuel, machine.id);
  // Priced fills only; a fill from the farm tank has gallons and no receipt.
  const spent: Money = { cents: fuel.reduce((total, log) => total + (log.cost?.cents ?? 0), 0) };
  const unpriced = fuel.filter((log) => log.cost === undefined).length;
  const burned = fuel.reduce((total, log) => total + log.gallons, 0);

  return (
    <div className="flex flex-col gap-density">
      <LedgerHead
        // The tiles this tab used to open with, as one line. Miles per gallon
        // is tank to tank, so it needs two fills with the odometer read.
        facts={
          fuel.length === 0
            ? undefined
            : line(
                formatMoney(spent),
                unpriced === 0 ? undefined : `${unpriced} without a price`,
                `${num(burned, 1)} gal`,
                `${fuel.length} fill${fuel.length === 1 ? "" : "s"}`,
                mpg === undefined ? "mpg after two fills with miles" : `${num(mpg, 1)} mpg`,
              )
        }
        action={
          <Button variant="primary" onClick={onAdd}>
            Record fill
          </Button>
        }
      />

      {fuel.length === 0 ? (
        <EmptyState
          title="No fuel recorded"
          detail="Cost of operation is fuel plus service. Half of it is missing until fills are written down."
        />
      ) : (
        <KitList label={`Fuel log for ${machine.name}`}>
          {[...fuel]
            .sort((a, b) => b.filledOn.getTime() - a.filledOn.getTime())
            .map((log) => (
              <KitRow
                key={log.id}
                title={
                  log.cost === undefined
                    ? `${num(log.gallons, 1)} gal`
                    : `${num(log.gallons, 1)} gal · ${formatMoney(log.cost)}`
                }
                line={line(
                  formatDate(log.filledOn),
                  log.cost === undefined
                    ? "no price"
                    : log.gallons <= 0
                      ? undefined
                      : `${formatMoney({ cents: Math.round(log.cost.cents / log.gallons) })}/gal`,
                  meterAt(log.hours, log.miles),
                )}
                onOpen={() => onEdit(log)}
                openLabel={`Edit the fill of ${formatDate(log.filledOn)}`}
              />
            ))}
        </KitList>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- details */

export function DetailsTab({
  machine,
  onEdit,
}: {
  readonly machine: Equipment;
  readonly onEdit: () => void;
}) {
  return (
    <div className="flex flex-col gap-density">
      <LedgerHead
        facts="What a parts counter or a buyer asks for"
        action={<Button onClick={onEdit}>Edit</Button>}
      />
      <div className="rounded-density border border-rule bg-panel p-density">
        <DetailList
          items={[
            { label: "Category", value: machine.category },
            { label: "Status", value: machine.status.replace(/_/g, " ") },
            { label: "Make", value: machine.make ?? "" },
            { label: "Model", value: machine.model ?? "" },
            { label: "Year", value: machine.year === undefined ? "" : String(machine.year) },
            { label: "VIN or serial", value: machine.vin ?? "" },
            { label: "Bought", value: formatDate(machine.purchasedOn) },
            {
              label: "Paid",
              value: machine.purchasePrice === undefined ? "" : formatMoney(machine.purchasePrice),
            },
            { label: "Notes", value: machine.notes ?? "", wide: true },
          ]}
          columns={3}
        />
      </div>
    </div>
  );
}
