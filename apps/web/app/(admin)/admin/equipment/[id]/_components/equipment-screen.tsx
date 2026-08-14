"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import {
  Button,
  Callout,
  Card,
  Checkbox,
  DataTable,
  DetailList,
  EmptyState,
  PageBody,
  PageHeader,
  Pill,
  Section,
  Select,
  StatRow,
  Tabs,
  Tile,
  TextInput,
  useConfirmDelete,
  useToast,
  type Column,
} from "@galaxy-farm/ui";
import { formatMoney, fromDollars, type Money, type Ulid } from "@galaxy-farm/core";
import {
  costOfOwnership,
  currentMeter,
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_STATUSES,
  equipmentSchema,
  fuelEfficiency,
  fuelLogSchema,
  maintenanceDue,
  maintenanceLogSchema,
  maintenanceRuleSchema,
  METER_KINDS,
  meterReadingSchema,
  type Equipment,
  type EquipmentCategory,
  type EquipmentStatus,
  type FuelLog,
  type MaintenanceDue,
  type MaintenanceLog,
  type MaintenanceRule,
  type MeterKind,
  type MeterReading,
} from "@galaxy-farm/module-equipment";

import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

/**
 * One machine (spec §5.6, §7's `/admin/equipment/[id]`).
 *
 * Four ledgers and a record. The meters are the ones that matter, because
 * everything else derives from them: a rule that triggers on hours cannot come
 * due until somebody writes down what the hour meter says, so a machine with
 * rules and no readings is a machine with no maintenance schedule at all. The
 * meter tab says so rather than showing an empty table.
 *
 * Cost of ownership is fuel plus service, per §6, and is deliberately *not*
 * the purchase price plus those. What a truck cost to buy is a fact about the
 * year you bought it; what it costs to run is the number that decides whether
 * to keep running it.
 */

function formatDate(value: Date | undefined): string {
  return value === undefined
    ? "—"
    : value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function num(value: number | undefined, decimals = 0): string {
  return value === undefined
    ? "—"
    : value.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** A date input's value is a day; the record wants an instant inside it. */
function atNoon(day: string): Date {
  return new Date(`${day}T12:00:00`);
}

function errorMessage(error: { kind: string; issues?: readonly { message: string }[] }): string {
  return error.kind === "validation"
    ? (error.issues?.[0]?.message ?? "That is not valid")
    : "Could not save that";
}

/** What a rule is waiting on, in the words the rule was written in. */
function describeDue(entry: MaintenanceDue): string {
  return entry.reason === "months"
    ? `due ${formatDate(entry.dueAt)}`
    : entry.reason === "hours"
      ? `at ${num(entry.dueAtHours, 1)} hrs`
      : `at ${num(entry.dueAtMiles)} mi`;
}

const TABS = [
  { id: "meters", label: "Meters" },
  { id: "maintenance", label: "Maintenance" },
  { id: "service", label: "Service log" },
  { id: "fuel", label: "Fuel" },
  { id: "details", label: "Details" },
] as const;

export function EquipmentScreen({
  equipmentId,
  propertyId,
  actorId,
}: {
  readonly equipmentId: string;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const query = { propertyId };
  const { records: fleet, loading } = useRecords<Equipment>("equipment", query);
  const { records: allReadings } = useRecords<MeterReading>("meterReadings", query);
  const { records: allRules } = useRecords<MaintenanceRule>("maintenanceRules", query);
  const { records: allLogs } = useRecords<MaintenanceLog>("maintenanceLogs", query);
  const { records: allFuel } = useRecords<FuelLog>("fuelLogs", query);

  const [tab, setTab] = useState<string>("meters");
  /** Set by "Log it" on a due rule, read once by the service form. */
  const [prefill, setPrefill] = useState<MaintenanceRule | undefined>();

  const machine = fleet.find((entry) => entry.id === equipmentId);

  const readings = useMemo(
    () => allReadings.filter((entry) => entry.equipmentId === equipmentId),
    [allReadings, equipmentId],
  );
  const rules = useMemo(
    () => allRules.filter((entry) => entry.equipmentId === equipmentId),
    [allRules, equipmentId],
  );
  const logs = useMemo(
    () => allLogs.filter((entry) => entry.equipmentId === equipmentId),
    [allLogs, equipmentId],
  );
  const fuel = useMemo(
    () => allFuel.filter((entry) => entry.equipmentId === equipmentId),
    [allFuel, equipmentId],
  );

  if (loading) return <p className="text-muted">Looking…</p>;

  if (machine === undefined) {
    return (
      <PageBody>
        <EmptyState
          title="No machine here"
          detail="Nothing on this device has that id. It may have been deleted — deleted records are restorable from Trash for thirty days."
          action={
            <Link href="/admin/equipment" className="text-action underline">
              Back to the fleet
            </Link>
          }
        />
      </PageBody>
    );
  }

  const now = new Date();
  const hours = currentMeter(readings, machine.id, "hours");
  const miles = currentMeter(readings, machine.id, "miles");
  const due = maintenanceDue(rules, logs, readings, now);
  const overdue = due.filter((entry) => entry.overdue);
  const mpg = fuelEfficiency(fuel, machine.id);
  const running = costOfOwnership(machine.id, logs, fuel);

  /**
   * "Record this job", from a rule that is due.
   *
   * The rule is handed to the service form as its opening state rather than
   * pushed into it: `Tabs` renders only the panel that is open, so moving to
   * the service tab mounts that form fresh and its initialisers read the
   * prefill once. Reaching the tab any other way clears it first — a form that
   * silently refills itself with last week's oil change is worse than one that
   * asks.
   */
  function logService(rule: MaintenanceRule) {
    setPrefill(rule);
    setTab("service");
  }

  function chooseTab(id: string) {
    setPrefill(undefined);
    setTab(id);
  }

  return (
    <PageBody>
      <PageHeader
        eyebrow={
          <span>
            <Link href="/admin/equipment" className="hover:text-ink">
              Kit
            </Link>{" "}
            · Equipment
          </span>
        }
        title={machine.name}
        subtitle={[machine.year, machine.make, machine.model].filter(Boolean).join(" ")}
        meta={
          <>
            <Pill tone="identity">{machine.category}</Pill>
            <Pill tone={machine.status === "in_service" ? "calm" : "danger"}>
              {machine.status.replace(/_/g, " ")}
            </Pill>
            {machine.vin === undefined ? null : <Pill>#{machine.vin}</Pill>}
          </>
        }
      />

      <StatRow>
        <Tile label="Hours" value={num(hours, 1)} hint={hours === undefined ? "Never read" : ""} />
        <Tile label="Miles" value={num(miles)} hint={miles === undefined ? "Never read" : ""} />
        <Tile
          label="Fuel and service"
          value={formatMoney(running)}
          hint="What it has cost to run"
        />
        <Tile
          label="Miles per gallon"
          value={mpg === undefined ? "—" : num(mpg, 1)}
          hint={mpg === undefined ? "Two fills with odometer readings" : "Tank to tank"}
        />
      </StatRow>

      {overdue.length === 0 ? null : (
        <Callout
          tone="danger"
          title={`${overdue.length} job${overdue.length === 1 ? "" : "s"} overdue`}
        >
          {overdue.map((entry) => `${entry.rule.task} (on ${entry.reason})`).join("; ")}. Recording
          the work resets the interval from the meter you enter with it.
        </Callout>
      )}

      <Tabs tabs={TABS} label="This machine" activeTab={tab} onTabChange={chooseTab}>
        {(active) =>
          active === "meters" ? (
            <Meters
              machine={machine}
              readings={readings}
              rules={rules}
              propertyId={propertyId}
              actorId={actorId}
            />
          ) : active === "maintenance" ? (
            <Maintenance
              machine={machine}
              rules={rules}
              due={due}
              readings={readings}
              onLogService={logService}
              propertyId={propertyId}
              actorId={actorId}
            />
          ) : active === "service" ? (
            <ServiceLog
              machine={machine}
              rules={rules}
              logs={logs}
              hours={hours}
              miles={miles}
              prefill={prefill}
              propertyId={propertyId}
              actorId={actorId}
            />
          ) : active === "fuel" ? (
            <Fuel
              machine={machine}
              fuel={fuel}
              miles={miles}
              hours={hours}
              propertyId={propertyId}
              actorId={actorId}
            />
          ) : (
            <Details machine={machine} propertyId={propertyId} actorId={actorId} />
          )
        }
      </Tabs>
    </PageBody>
  );
}

/* ----------------------------------------------------------------- meters */

function Meters({
  machine,
  readings,
  rules,
  propertyId,
  actorId,
}: {
  readonly machine: Equipment;
  readonly readings: readonly MeterReading[];
  readonly rules: readonly MaintenanceRule[];
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const api = useMutations<MeterReading>(
    "meterReadings",
    "meterReadings",
    meterReadingSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [editing, setEditing] = useState<MeterReading | undefined>();
  const [kind, setKind] = useState<MeterKind>("hours");
  const [value, setValue] = useState("");
  const [readOn, setReadOn] = useState(today);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const latest = currentMeter(readings, machine.id, kind);
  // A meter does not run backwards on its own. It does when one is replaced,
  // which is worth a sentence rather than a rejection — the domain allows it
  // and the note is what makes the history readable a year later.
  const wentBackwards =
    latest !== undefined && value !== "" && Number(value) < latest && editing === undefined;

  /** Rules that will never come due while this meter is unread. */
  const waiting = rules.filter(
    (rule) =>
      rule.active &&
      ((rule.everyHours !== undefined &&
        currentMeter(readings, machine.id, "hours") === undefined) ||
        (rule.everyMiles !== undefined &&
          currentMeter(readings, machine.id, "miles") === undefined)),
  );

  function reset() {
    setEditing(undefined);
    setValue("");
    setNotes("");
    setError(undefined);
  }

  function startEdit(reading: MeterReading) {
    setEditing(reading);
    setKind(reading.kind);
    setValue(String(reading.value));
    setReadOn(reading.readOn.toISOString().slice(0, 10));
    setNotes(reading.notes ?? "");
    setError(undefined);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setBusy(true);

    try {
      const payload = {
        equipmentId: machine.id,
        kind,
        value: Number(value),
        readOn: atNoon(readOn),
        notes: notes.trim() === "" ? undefined : notes.trim(),
      };

      const result =
        editing === undefined
          ? await api.create(payload as never)
          : await api.update(editing.id, payload as Partial<MeterReading>);

      if (!result.ok) {
        setError(errorMessage(result.error));
        return;
      }

      show({ message: editing === undefined ? "Meter read" : "Reading updated" });
      reset();
    } finally {
      setBusy(false);
    }
  }

  async function remove(reading: MeterReading) {
    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: `${num(reading.value, 1)} ${reading.kind} on ${formatDate(reading.readOn)}`,
      entity: "meter reading",
      dependents: [{ entity: "Maintenance due", label: "recomputed", effect: "deleted" as const }],
      consequence:
        "The latest reading is what every hours or miles rule measures against. Deleting this one moves them back to the reading before it.",
    });
    if (!confirmed) return;

    if (editing?.id === reading.id) reset();
    await api.remove(reading.id, "Removed from the meter log");
    show({ message: "Reading deleted", tone: "danger" });
  }

  const columns: readonly Column<MeterReading>[] = [
    { key: "when", header: "Read", primary: true, render: (row) => formatDate(row.readOn) },
    { key: "kind", header: "Meter", render: (row) => <Pill>{row.kind}</Pill> },
    { key: "value", header: "Reading", numeric: true, render: (row) => num(row.value, 1) },
    { key: "notes", header: "Note", render: (row) => row.notes ?? "—" },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <span className="flex gap-2">
          <Button variant="ghost" onClick={() => startEdit(row)}>
            Edit
          </Button>
          <Button variant="ghost" onClick={() => void remove(row)}>
            Delete
          </Button>
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-density">
      {waiting.length === 0 ? null : (
        <Callout tone="action" title="Rules waiting on a meter">
          {waiting.map((rule) => rule.task).join(", ")} — a rule that triggers on hours or miles
          cannot come due until the meter has been read at least once.
        </Callout>
      )}

      <Section
        title={editing === undefined ? "Read the meter" : "Edit this reading"}
        description="Whatever the gauge says, whenever you happen to look. Nothing else has to be true for it to be worth writing down."
      >
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-density">
          <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-4">
            <Select
              label="Meter"
              value={kind}
              onChange={(event) => setKind(event.target.value as MeterKind)}
              options={METER_KINDS.map((option) => ({ value: option, label: option }))}
            />
            <TextInput
              label="Reading"
              type="number"
              inputMode="decimal"
              step="0.1"
              numeric
              value={value}
              onChange={(event) => setValue(event.target.value)}
              hint={latest === undefined ? "First reading" : `Last: ${num(latest, 1)}`}
              required
            />
            <TextInput
              label="Read on"
              type="date"
              value={readOn}
              onChange={(event) => setReadOn(event.target.value)}
              required
            />
            <TextInput
              label="Note"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          {wentBackwards ? (
            <p className="text-sm text-muted">
              That is lower than the last {kind} reading. Usually that means the meter was replaced
              — worth saying so in the note, because every interval from here measures against it.
            </p>
          ) : null}

          {error === undefined ? null : (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" busy={busy}>
              {editing === undefined ? "Record reading" : "Save reading"}
            </Button>
            {editing === undefined ? null : (
              <Button variant="ghost" onClick={reset}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </Section>

      <Section title="Readings">
        <Card>
          <DataTable
            caption={`Meter readings for ${machine.name}`}
            columns={columns}
            rows={[...readings].sort((a, b) => b.readOn.getTime() - a.readOn.getTime())}
            rowKey={(row) => row.id}
            empty={
              <EmptyState
                title="Never read"
                detail="Hours and miles are what the maintenance rules count against. Until one is written down, a rule that triggers on either cannot come due."
              />
            }
          />
        </Card>
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------ maintenance */

function Maintenance({
  machine,
  rules,
  due,
  readings,
  onLogService,
  propertyId,
  actorId,
}: {
  readonly machine: Equipment;
  readonly rules: readonly MaintenanceRule[];
  readonly due: readonly MaintenanceDue[];
  readonly readings: readonly MeterReading[];
  readonly onLogService: (rule: MaintenanceRule) => void;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const api = useMutations<MaintenanceRule>(
    "maintenanceRules",
    "maintenanceRules",
    maintenanceRuleSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [editing, setEditing] = useState<MaintenanceRule | undefined>();
  const [task, setTask] = useState("");
  const [everyHours, setEveryHours] = useState("");
  const [everyMiles, setEveryMiles] = useState("");
  const [everyMonths, setEveryMonths] = useState("");
  const [parts, setParts] = useState("");
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const dueByRule = new Map(due.map((entry) => [entry.rule.id, entry]));

  function reset() {
    setEditing(undefined);
    setTask("");
    setEveryHours("");
    setEveryMiles("");
    setEveryMonths("");
    setParts("");
    setActive(true);
    setError(undefined);
  }

  function startEdit(rule: MaintenanceRule) {
    setEditing(rule);
    setTask(rule.task);
    setEveryHours(rule.everyHours === undefined ? "" : String(rule.everyHours));
    setEveryMiles(rule.everyMiles === undefined ? "" : String(rule.everyMiles));
    setEveryMonths(rule.everyMonths === undefined ? "" : String(rule.everyMonths));
    setParts(rule.parts ?? "");
    setActive(rule.active);
    setError(undefined);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setBusy(true);

    try {
      const payload = {
        equipmentId: machine.id,
        task: task.trim(),
        everyHours: everyHours === "" ? undefined : Number(everyHours),
        everyMiles: everyMiles === "" ? undefined : Number(everyMiles),
        everyMonths: everyMonths === "" ? undefined : Number(everyMonths),
        parts: parts.trim() === "" ? undefined : parts.trim(),
        active,
      };

      const result =
        editing === undefined
          ? await api.create(payload as never)
          : await api.update(editing.id, payload as Partial<MaintenanceRule>);

      if (!result.ok) {
        setError(errorMessage(result.error));
        return;
      }

      show({ message: editing === undefined ? "Rule added" : "Rule updated" });
      reset();
    } finally {
      setBusy(false);
    }
  }

  async function remove(rule: MaintenanceRule) {
    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: rule.task,
      entity: "maintenance rule",
      dependents: [],
      // The history is what the money and the resale conversation are made of.
      consequence:
        "The service already recorded against it stays. Only the rule that keeps asking goes.",
    });
    if (!confirmed) return;

    if (editing?.id === rule.id) reset();
    await api.remove(rule.id, "Removed from the maintenance rules");
    show({ message: "Rule deleted", tone: "danger" });
  }

  return (
    <div className="flex flex-col gap-density">
      <Section
        title={editing === undefined ? "Add a rule" : `Edit ${editing.task}`}
        description="Hours, miles, months, or any combination. A rule with two triggers comes due at whichever arrives first, which is what keeps oil in an engine that sits all winter."
      >
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-density">
          <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-3">
            <TextInput
              label="Job"
              hint="&ldquo;Engine oil and filter&rdquo;, &ldquo;Repack wheel bearings&rdquo;"
              value={task}
              onChange={(event) => setTask(event.target.value)}
              required
            />
            <TextInput
              label="Every N hours"
              type="number"
              inputMode="decimal"
              numeric
              value={everyHours}
              onChange={(event) => setEveryHours(event.target.value)}
            />
            <TextInput
              label="Every N miles"
              type="number"
              inputMode="decimal"
              numeric
              value={everyMiles}
              onChange={(event) => setEveryMiles(event.target.value)}
            />
            <TextInput
              label="Every N months"
              type="number"
              inputMode="decimal"
              numeric
              value={everyMonths}
              onChange={(event) => setEveryMonths(event.target.value)}
            />
            <TextInput
              label="Parts"
              hint="The filter number, so nobody looks it up twice."
              value={parts}
              onChange={(event) => setParts(event.target.value)}
            />
            <Checkbox
              label="Still asking"
              hint="Turn off to stop a rule coming due without losing what it recorded."
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
            />
          </div>

          {error === undefined ? null : (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" busy={busy}>
              {editing === undefined ? "Add rule" : "Save rule"}
            </Button>
            {editing === undefined ? null : (
              <Button variant="ghost" onClick={reset}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </Section>

      <Section title="What it needs">
        {rules.length === 0 ? (
          <EmptyState
            title="No rules yet"
            detail="Nothing on this machine will ever come due. The manual is the usual source — oil by hours, bearings by miles, and the ones that go by the calendar whether it moves or not."
          />
        ) : (
          <div className="grid grid-cols-1 gap-density md:grid-cols-2">
            {[...rules]
              .sort((left, right) => {
                const rank = (rule: MaintenanceRule) =>
                  dueByRule.get(rule.id)?.overdue === true ? 0 : rule.active ? 1 : 2;
                return rank(left) - rank(right) || left.task.localeCompare(right.task);
              })
              .map((rule) => {
                const entry = dueByRule.get(rule.id);
                const triggers = [
                  rule.everyHours === undefined ? undefined : `${num(rule.everyHours)} hrs`,
                  rule.everyMiles === undefined ? undefined : `${num(rule.everyMiles)} mi`,
                  rule.everyMonths === undefined ? undefined : `${num(rule.everyMonths)} months`,
                ].filter(Boolean);

                return (
                  <Card
                    key={rule.id}
                    title={rule.task}
                    actions={
                      entry === undefined ? (
                        <Pill tone="neutral">{rule.active ? "waiting on a meter" : "off"}</Pill>
                      ) : (
                        <Pill tone={entry.overdue ? "danger" : "calm"} dot={entry.overdue}>
                          {entry.overdue ? "overdue" : describeDue(entry)}
                        </Pill>
                      )
                    }
                  >
                    <div className="flex flex-col gap-3">
                      <DetailList
                        items={[
                          { label: "Every", value: triggers.join(" · ") },
                          { label: "Parts", value: rule.parts ?? "" },
                          ...(entry === undefined
                            ? []
                            : [{ label: "Next", value: describeDue(entry) }]),
                        ]}
                        columns={2}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button variant="secondary" onClick={() => onLogService(rule)}>
                          Record this job
                        </Button>
                        <Button variant="ghost" onClick={() => startEdit(rule)}>
                          Edit
                        </Button>
                        <Button variant="ghost" onClick={() => void remove(rule)}>
                          Delete
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              })}
          </div>
        )}
        {readings.length === 0 && rules.length > 0 ? (
          <p className="text-sm text-muted">
            Nothing here can come due on hours or miles until the meter has been read once.
          </p>
        ) : null}
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------ service log */

function ServiceLog({
  machine,
  rules,
  logs,
  hours,
  miles,
  prefill,
  propertyId,
  actorId,
}: {
  readonly machine: Equipment;
  readonly rules: readonly MaintenanceRule[];
  readonly logs: readonly MaintenanceLog[];
  readonly hours: number | undefined;
  readonly miles: number | undefined;
  readonly prefill: MaintenanceRule | undefined;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const api = useMutations<MaintenanceLog>(
    "maintenanceLogs",
    "maintenanceLogs",
    maintenanceLogSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [editing, setEditing] = useState<MaintenanceLog | undefined>();
  const [ruleId, setRuleId] = useState(prefill?.id ?? "");
  const [task, setTask] = useState(prefill?.task ?? "");
  const [performedOn, setPerformedOn] = useState(today);
  const [cost, setCost] = useState("");
  const [parts, setParts] = useState(prefill?.parts ?? "");
  // Prefilled from the latest reading: the meter at the time of the work is
  // what the next interval measures from, and typing it again from memory is
  // how an interval ends up two hundred hours out.
  const [atHours, setAtHours] = useState(hours === undefined ? "" : String(hours));
  const [atMiles, setAtMiles] = useState(miles === undefined ? "" : String(miles));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  function reset() {
    setEditing(undefined);
    setRuleId("");
    setTask("");
    setCost("");
    setParts("");
    setNotes("");
    setError(undefined);
  }

  function startEdit(log: MaintenanceLog) {
    setEditing(log);
    setRuleId(log.ruleId ?? "");
    setTask(log.task);
    setPerformedOn(log.performedOn.toISOString().slice(0, 10));
    setCost(log.cost === undefined ? "" : (log.cost.cents / 100).toFixed(2));
    setParts(log.parts ?? "");
    setAtHours(log.hours === undefined ? "" : String(log.hours));
    setAtMiles(log.miles === undefined ? "" : String(log.miles));
    setNotes(log.notes ?? "");
    setError(undefined);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setBusy(true);

    try {
      const payload = {
        equipmentId: machine.id,
        ruleId: ruleId === "" ? undefined : (ruleId as Ulid),
        task: task.trim(),
        performedOn: atNoon(performedOn),
        cost: cost === "" ? undefined : fromDollars(Number(cost)),
        parts: parts.trim() === "" ? undefined : parts.trim(),
        hours: atHours === "" ? undefined : Number(atHours),
        miles: atMiles === "" ? undefined : Number(atMiles),
        notes: notes.trim() === "" ? undefined : notes.trim(),
      };

      const result =
        editing === undefined
          ? await api.create(payload as never)
          : await api.update(editing.id, payload as Partial<MaintenanceLog>);

      if (!result.ok) {
        setError(errorMessage(result.error));
        return;
      }

      show({
        message:
          ruleId === "" ? "Service recorded" : "Service recorded — the rule counts from here now",
        tone: "success",
      });
      reset();
    } finally {
      setBusy(false);
    }
  }

  async function remove(log: MaintenanceLog) {
    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: `${log.task} on ${formatDate(log.performedOn)}`,
      entity: "service entry",
      dependents: [
        { entity: "Cost of ownership", label: "recomputed", effect: "deleted" as const },
        ...(log.ruleId === undefined
          ? []
          : [{ entity: "Next service due", label: "recomputed", effect: "deleted" as const }]),
      ],
      consequence:
        log.ruleId === undefined
          ? undefined
          : "Its rule measures the next interval from the most recent entry. Deleting this one moves that back to the entry before it.",
      action: "Delete",
    });
    if (!confirmed) return;

    if (editing?.id === log.id) reset();
    await api.remove(log.id, "Removed from the service log");
    show({ message: "Entry deleted", tone: "danger" });
  }

  const byRule = new Map(rules.map((rule) => [rule.id, rule]));

  const columns: readonly Column<MaintenanceLog>[] = [
    { key: "task", header: "Job", primary: true, render: (row) => row.task },
    { key: "when", header: "Done", render: (row) => formatDate(row.performedOn) },
    {
      key: "meter",
      header: "At",
      numeric: true,
      render: (row) =>
        [
          row.hours === undefined ? undefined : `${num(row.hours, 1)} hrs`,
          row.miles === undefined ? undefined : `${num(row.miles)} mi`,
        ]
          .filter(Boolean)
          .join(" · ") || "—",
    },
    {
      key: "cost",
      header: "Cost",
      numeric: true,
      render: (row) => (row.cost === undefined ? "—" : formatMoney(row.cost)),
    },
    {
      key: "rule",
      header: "Against",
      render: (row) =>
        row.ruleId === undefined ? (
          <span className="text-muted">one-off</span>
        ) : (
          (byRule.get(row.ruleId)?.task ?? <span className="text-muted">a deleted rule</span>)
        ),
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <span className="flex gap-2">
          <Button variant="ghost" onClick={() => startEdit(row)}>
            Edit
          </Button>
          <Button variant="ghost" onClick={() => void remove(row)}>
            Delete
          </Button>
        </span>
      ),
    },
  ];

  const spent: Money = {
    cents: logs.reduce((total, log) => total + (log.cost?.cents ?? 0), 0),
  };

  return (
    <div className="flex flex-col gap-density">
      <Section
        title={editing === undefined ? "Record work done" : "Edit this entry"}
        description="Naming the rule it satisfies is what resets the interval. Work that answers to no rule — a repair, a tyre — is recorded the same way with the rule left blank."
      >
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-density">
          <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-3">
            <Select
              label="Against a rule"
              value={ruleId}
              placeholder="A one-off"
              onChange={(event) => {
                setRuleId(event.target.value);
                const rule = rules.find((entry) => entry.id === event.target.value);
                // The rule's own words, unless somebody has already typed
                // theirs — a job description overwritten mid-form is worse
                // than one that has to be typed.
                if (rule !== undefined && task.trim() === "") setTask(rule.task);
              }}
              options={rules.map((rule) => ({ value: rule.id, label: rule.task }))}
            />
            <TextInput
              label="Job"
              value={task}
              onChange={(event) => setTask(event.target.value)}
              required
            />
            <TextInput
              label="Done"
              type="date"
              value={performedOn}
              onChange={(event) => setPerformedOn(event.target.value)}
              required
            />
            <TextInput
              label="Hours at the time"
              hint="What the next interval counts from."
              type="number"
              inputMode="decimal"
              step="0.1"
              numeric
              value={atHours}
              onChange={(event) => setAtHours(event.target.value)}
            />
            <TextInput
              label="Miles at the time"
              type="number"
              inputMode="decimal"
              numeric
              value={atMiles}
              onChange={(event) => setAtMiles(event.target.value)}
            />
            <TextInput
              label="Cost ($)"
              type="number"
              inputMode="decimal"
              step="0.01"
              numeric
              value={cost}
              onChange={(event) => setCost(event.target.value)}
            />
            <TextInput
              label="Parts"
              value={parts}
              onChange={(event) => setParts(event.target.value)}
            />
            <TextInput
              label="Notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          {error === undefined ? null : (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" busy={busy}>
              {editing === undefined ? "Record service" : "Save entry"}
            </Button>
            {editing === undefined ? null : (
              <Button variant="ghost" onClick={reset}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </Section>

      <Section title="What has been done" description={`${formatMoney(spent)} in service to date.`}>
        <Card>
          <DataTable
            caption={`Service log for ${machine.name}`}
            columns={columns}
            rows={[...logs].sort((a, b) => b.performedOn.getTime() - a.performedOn.getTime())}
            rowKey={(row) => row.id}
            empty={
              <EmptyState
                title="Nothing recorded"
                detail="A service history is what a rule counts from, what cost of ownership is made of, and the first thing a buyer asks for."
              />
            }
          />
        </Card>
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------- fuel */

function Fuel({
  machine,
  fuel,
  miles,
  hours,
  propertyId,
  actorId,
}: {
  readonly machine: Equipment;
  readonly fuel: readonly FuelLog[];
  readonly miles: number | undefined;
  readonly hours: number | undefined;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const api = useMutations<FuelLog>("fuelLogs", "fuelLogs", fuelLogSchema, propertyId, actorId);
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [editing, setEditing] = useState<FuelLog | undefined>();
  const [gallons, setGallons] = useState("");
  const [cost, setCost] = useState("");
  const [filledOn, setFilledOn] = useState(today);
  const [atHours, setAtHours] = useState(hours === undefined ? "" : String(hours));
  const [atMiles, setAtMiles] = useState(miles === undefined ? "" : String(miles));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const mpg = fuelEfficiency(fuel, machine.id);
  const spent: Money = { cents: fuel.reduce((total, log) => total + log.cost.cents, 0) };
  const burned = fuel.reduce((total, log) => total + log.gallons, 0);

  function reset() {
    setEditing(undefined);
    setGallons("");
    setCost("");
    setNotes("");
    setError(undefined);
  }

  function startEdit(log: FuelLog) {
    setEditing(log);
    setGallons(String(log.gallons));
    setCost((log.cost.cents / 100).toFixed(2));
    setFilledOn(log.filledOn.toISOString().slice(0, 10));
    setAtHours(log.hours === undefined ? "" : String(log.hours));
    setAtMiles(log.miles === undefined ? "" : String(log.miles));
    setNotes(log.notes ?? "");
    setError(undefined);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setBusy(true);

    try {
      const payload = {
        equipmentId: machine.id,
        gallons: Number(gallons),
        cost: fromDollars(Number(cost)),
        filledOn: atNoon(filledOn),
        hours: atHours === "" ? undefined : Number(atHours),
        miles: atMiles === "" ? undefined : Number(atMiles),
        notes: notes.trim() === "" ? undefined : notes.trim(),
      };

      const result =
        editing === undefined
          ? await api.create(payload as never)
          : await api.update(editing.id, payload as Partial<FuelLog>);

      if (!result.ok) {
        setError(errorMessage(result.error));
        return;
      }

      show({ message: editing === undefined ? "Fill recorded" : "Fill updated" });
      reset();
    } finally {
      setBusy(false);
    }
  }

  async function remove(log: FuelLog) {
    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: `${num(log.gallons, 1)} gal on ${formatDate(log.filledOn)}`,
      entity: "fuel entry",
      dependents: [
        { entity: "Cost of ownership", label: "recomputed", effect: "deleted" as const },
        { entity: "Miles per gallon", label: "recomputed", effect: "deleted" as const },
      ],
      action: "Delete",
    });
    if (!confirmed) return;

    if (editing?.id === log.id) reset();
    await api.remove(log.id, "Removed from the fuel log");
    show({ message: "Fill deleted", tone: "danger" });
  }

  const columns: readonly Column<FuelLog>[] = [
    { key: "when", header: "Filled", primary: true, render: (row) => formatDate(row.filledOn) },
    { key: "gallons", header: "Gallons", numeric: true, render: (row) => num(row.gallons, 1) },
    { key: "cost", header: "Cost", numeric: true, render: (row) => formatMoney(row.cost) },
    {
      key: "each",
      header: "Per gallon",
      numeric: true,
      render: (row) =>
        row.gallons <= 0 ? "—" : formatMoney({ cents: Math.round(row.cost.cents / row.gallons) }),
    },
    {
      key: "meter",
      header: "At",
      numeric: true,
      render: (row) =>
        [
          row.hours === undefined ? undefined : `${num(row.hours, 1)} hrs`,
          row.miles === undefined ? undefined : `${num(row.miles)} mi`,
        ]
          .filter(Boolean)
          .join(" · ") || "—",
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <span className="flex gap-2">
          <Button variant="ghost" onClick={() => startEdit(row)}>
            Edit
          </Button>
          <Button variant="ghost" onClick={() => void remove(row)}>
            Delete
          </Button>
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-density">
      <StatRow>
        <Tile label="Spent on fuel" value={formatMoney(spent)} />
        <Tile label="Gallons" value={num(burned, 1)} />
        <Tile
          label="Miles per gallon"
          value={mpg === undefined ? "—" : num(mpg, 1)}
          hint="Tank to tank, so the first fill is excluded"
        />
        <Tile
          label="Fills"
          value={fuel.length}
          hint={fuel.length < 2 ? "Two with odometer readings gives a figure" : ""}
        />
      </StatRow>

      <Section
        title={editing === undefined ? "Record a fill" : "Edit this fill"}
        description="The odometer at the pump is what turns a list of fills into miles per gallon. Without it this is only a record of what fuel cost."
      >
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-density">
          <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-3">
            <TextInput
              label="Gallons"
              type="number"
              inputMode="decimal"
              step="0.01"
              numeric
              value={gallons}
              onChange={(event) => setGallons(event.target.value)}
              required
            />
            <TextInput
              label="Cost ($)"
              type="number"
              inputMode="decimal"
              step="0.01"
              numeric
              value={cost}
              onChange={(event) => setCost(event.target.value)}
              required
            />
            <TextInput
              label="Filled"
              type="date"
              value={filledOn}
              onChange={(event) => setFilledOn(event.target.value)}
              required
            />
            <TextInput
              label="Miles at the pump"
              type="number"
              inputMode="decimal"
              numeric
              value={atMiles}
              onChange={(event) => setAtMiles(event.target.value)}
            />
            <TextInput
              label="Hours at the pump"
              type="number"
              inputMode="decimal"
              step="0.1"
              numeric
              value={atHours}
              onChange={(event) => setAtHours(event.target.value)}
            />
            <TextInput
              label="Notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          {error === undefined ? null : (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" busy={busy}>
              {editing === undefined ? "Record fill" : "Save fill"}
            </Button>
            {editing === undefined ? null : (
              <Button variant="ghost" onClick={reset}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </Section>

      <Section title="Every fill">
        <Card>
          <DataTable
            caption={`Fuel log for ${machine.name}`}
            columns={columns}
            rows={[...fuel].sort((a, b) => b.filledOn.getTime() - a.filledOn.getTime())}
            rowKey={(row) => row.id}
            empty={
              <EmptyState
                title="No fuel recorded"
                detail="Cost of operation is fuel plus service. Half of it is missing until fills are written down."
              />
            }
          />
        </Card>
      </Section>
    </div>
  );
}

/* ---------------------------------------------------------------- details */

function Details({
  machine,
  propertyId,
  actorId,
}: {
  readonly machine: Equipment;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const api = useMutations<Equipment>(
    "equipment",
    "equipment",
    equipmentSchema,
    propertyId,
    actorId,
  );
  const { show } = useToast();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(machine.name);
  const [category, setCategory] = useState<EquipmentCategory>(machine.category);
  const [status, setStatus] = useState<EquipmentStatus>(machine.status);
  const [make, setMake] = useState(machine.make ?? "");
  const [model, setModel] = useState(machine.model ?? "");
  const [year, setYear] = useState(machine.year === undefined ? "" : String(machine.year));
  const [vin, setVin] = useState(machine.vin ?? "");
  const [purchasedOn, setPurchasedOn] = useState(
    machine.purchasedOn === undefined ? "" : machine.purchasedOn.toISOString().slice(0, 10),
  );
  const [price, setPrice] = useState(
    machine.purchasePrice === undefined ? "" : (machine.purchasePrice.cents / 100).toFixed(2),
  );
  const [notes, setNotes] = useState(machine.notes ?? "");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setBusy(true);

    try {
      const result = await api.update(machine.id, {
        name: name.trim(),
        category,
        status,
        make: make.trim() === "" ? undefined : make.trim(),
        model: model.trim() === "" ? undefined : model.trim(),
        year: year === "" ? undefined : Number(year),
        vin: vin.trim() === "" ? undefined : vin.trim(),
        purchasedOn: purchasedOn === "" ? undefined : atNoon(purchasedOn),
        purchasePrice: price === "" ? undefined : fromDollars(Number(price)),
        notes: notes.trim() === "" ? undefined : notes.trim(),
      } as Partial<Equipment>);

      if (!result.ok) {
        setError(errorMessage(result.error));
        return;
      }

      show({ message: "Machine updated" });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <Section title="What it is" description="Everything a parts counter or a buyer asks for.">
        <Card actions={<Button onClick={() => setEditing(true)}>Edit</Button>}>
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
                value:
                  machine.purchasePrice === undefined ? "" : formatMoney(machine.purchasePrice),
              },
              { label: "Notes", value: machine.notes ?? "", wide: true },
            ]}
            columns={3}
          />
        </Card>
      </Section>
    );
  }

  return (
    <Section title={`Edit ${machine.name}`}>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-density">
        <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-3">
          <TextInput
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
          <Select
            label="Category"
            value={category}
            onChange={(event) => setCategory(event.target.value as EquipmentCategory)}
            options={EQUIPMENT_CATEGORIES.map((value) => ({ value, label: value }))}
          />
          <Select
            label="Status"
            value={status}
            onChange={(event) => setStatus(event.target.value as EquipmentStatus)}
            options={EQUIPMENT_STATUSES.map((value) => ({
              value,
              label: value.replace(/_/g, " "),
            }))}
          />
          <TextInput label="Make" value={make} onChange={(event) => setMake(event.target.value)} />
          <TextInput
            label="Model"
            value={model}
            onChange={(event) => setModel(event.target.value)}
          />
          <TextInput
            label="Year"
            type="number"
            inputMode="numeric"
            numeric
            value={year}
            onChange={(event) => setYear(event.target.value)}
          />
          <TextInput
            label="VIN or serial"
            value={vin}
            onChange={(event) => setVin(event.target.value)}
          />
          <TextInput
            label="Bought"
            type="date"
            value={purchasedOn}
            onChange={(event) => setPurchasedOn(event.target.value)}
          />
          <TextInput
            label="Paid ($)"
            type="number"
            inputMode="decimal"
            step="0.01"
            numeric
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
          <TextInput
            label="Notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>

        {error === undefined ? null : (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" busy={busy}>
            Save machine
          </Button>
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Section>
  );
}
