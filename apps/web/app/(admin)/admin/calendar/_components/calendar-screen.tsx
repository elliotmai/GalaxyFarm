"use client";

import { useMemo, useState } from "react";

import {
  Button,
  Checkbox,
  Modal,
  PageBody,
  PageHeader,
  TextArea,
  TextInput,
  useConfirmDelete,
  useToast,
} from "@galaxy-farm/ui";
import {
  calendarEventSchema,
  dayKey,
  projectEvents,
  startOfDay,
  type Animal,
  type CalendarEntry,
  type CalendarEvent,
  type CalendarModule,
  type ChoreTemplate,
  type FeedingPlan,
  type PurchaseCandidate,
  type Task,
  type Ulid,
  type ZoneAssignment,
} from "@galaxy-farm/core";
import type {
  BreedingRecord,
  CalvingRecord,
  HealthRecord,
  MedInventory,
  SyncProtocol,
} from "@galaxy-farm/module-cattle";
import type {
  Equipment,
  MaintenanceLog,
  MaintenanceRule,
  MeterReading,
} from "@galaxy-farm/module-equipment";
import type { FeedConsumption, FeedPurchase, FeedType } from "@galaxy-farm/module-feed";

import { CalendarGrid } from "@/app/(admin)/admin/calendar/_components/calendar-grid";
import { EntryList } from "@/app/(admin)/admin/calendar/_components/entry-list";
import { modulesPresent, projectedCalendarEntries } from "@/lib/calendar";
import {
  CALENDAR_VIEWS,
  MODULE_LABELS,
  VIEW_LABELS,
  calendarPeriod,
  groupFromDay,
  groupOverSpan,
  stepPeriod,
  type CalendarView,
} from "@/lib/calendar-view";
import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

/**
 * The unified calendar (spec §6, §7 `/admin/calendar`).
 *
 * Everything on it except the manual events is derived. Each module projects
 * its own dated rows — `projectedCalendarEntries` is where they meet — and
 * `projectEvents` merges them with the stored half, windows them to what is on
 * screen, and applies §6's module filter. This screen owns none of that
 * arithmetic; it owns which fortnight you are looking at.
 *
 * Which is what makes the calendar honest about the thing §2 asks for: correct
 * the breeding date on the animal's page and the calving window here moves,
 * because there was never a second copy of it to go stale. Nothing on the
 * projected half has an edit button, and §4.5 puts it on the derived
 * read-model exception list precisely so that it never grows one.
 *
 * Every read comes from this device's own store, so it draws in the barn with
 * no signal, like every other screen (§4.2).
 *
 * The header is the period and its count; under it, the views and the module
 * filter are rows of chips, and whenever the filter narrows the calendar a
 * line says so with a way out. Adding or editing an event is a side panel, so
 * the grid never moves while somebody types.
 */

/** The pill toggle every chip row on this screen shares. */
function chipClass(on: boolean): string {
  return [
    "inline-flex min-h-target shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-sm",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action",
    on
      ? "bg-action/15 font-semibold text-action"
      : "font-medium text-muted hover:bg-raised hover:text-ink",
  ].join(" ");
}

interface Draft {
  readonly id?: Ulid | undefined;
  readonly title: string;
  readonly detail: string;
  readonly day: string;
  readonly time: string;
  readonly allDay: boolean;
  readonly endDay: string;
}

export function CalendarScreen({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const query = { propertyId };

  const { records: events, loading } = useRecords<CalendarEvent>("calendarEvents", query);
  const { records: animals } = useRecords<Animal>("animals", query);
  const { records: breedings } = useRecords<BreedingRecord>("breedingRecords", query);
  // A calving closes the attempt it came of: no window, no preg check, and
  // next year's dates belong to next year's service.
  const { records: calvings } = useRecords<CalvingRecord>("calvingRecords", query);
  const { records: protocols } = useRecords<SyncProtocol>("syncProtocols", query);
  const { records: health } = useRecords<HealthRecord>("healthRecords", query);
  const { records: meds } = useRecords<MedInventory>("medInventory", query);
  const { records: candidates } = useRecords<PurchaseCandidate>("purchaseCandidates", query);
  const { records: feeds } = useRecords<FeedType>("feedTypes", query);
  const { records: purchases } = useRecords<FeedPurchase>("feedPurchases", query);
  const { records: consumption } = useRecords<FeedConsumption>("feedConsumption", query);
  const { records: plans } = useRecords<FeedingPlan>("feedingPlans", query);
  const { records: assignments } = useRecords<ZoneAssignment>("zoneAssignments", query);
  const { records: equipment } = useRecords<Equipment>("equipment", query);
  const { records: maintenanceRules } = useRecords<MaintenanceRule>("maintenanceRules", query);
  const { records: maintenanceLogs } = useRecords<MaintenanceLog>("maintenanceLogs", query);
  const { records: meterReadings } = useRecords<MeterReading>("meterReadings", query);
  const { records: tasks } = useRecords<Task>("tasks", query);
  const { records: choreTemplates } = useRecords<ChoreTemplate>("choreTemplates", query);

  const calendarEvents = useMutations<CalendarEvent>(
    "calendarEvents",
    "calendarEvents",
    calendarEventSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [view, setView] = useState<CalendarView>("month");
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));
  const [modules, setModules] = useState<readonly CalendarModule[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | undefined>();
  const [draft, setDraft] = useState<Draft | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});

  /**
   * When the screen was opened, held still.
   *
   * Only the accruing projections read it — how much feed the plans imply has
   * gone out since the barn was last counted — and a `new Date()` per render
   * would move that by milliseconds every time React redrew, recomputing every
   * row for a difference nobody can see. Which day is on screen comes from the
   * anchor below, not from this.
   */
  const now = useMemo(() => new Date(), []);
  const period = useMemo(() => calendarPeriod(view, anchor), [view, anchor]);

  const projected = useMemo(
    () =>
      projectedCalendarEntries(
        {
          propertyId,
          animals,
          breedings,
          calvings,
          protocols,
          health,
          meds,
          candidates,
          feeds,
          purchases,
          consumption,
          plans,
          assignments,
          equipment,
          maintenanceRules,
          maintenanceLogs,
          meterReadings,
          tasks,
          choreTemplates,
        },
        { from: period.from, days: period.days, now },
      ),
    [
      propertyId,
      animals,
      breedings,
      calvings,
      protocols,
      health,
      meds,
      candidates,
      feeds,
      purchases,
      consumption,
      plans,
      assignments,
      equipment,
      maintenanceRules,
      maintenanceLogs,
      meterReadings,
      tasks,
      choreTemplates,
      period,
      now,
    ],
  );

  const window = useMemo(() => ({ from: period.from, to: period.to }), [period]);

  /**
   * Everything in the period, before the filter.
   *
   * The chips are built from this rather than from the filtered list, so
   * turning one off does not make the others disappear along with the rows —
   * a filter you cannot switch back off is worse than no filter.
   */
  const everything = useMemo(
    () => projectEvents({ manual: events, projected }, window),
    [events, projected, window],
  );

  const entries = useMemo(
    () =>
      projectEvents(
        { manual: events, projected },
        window,
        modules.length === 0 ? undefined : modules,
      ),
    [events, projected, window, modules],
  );

  /**
   * Two groupings, because a grid and an agenda ask different questions.
   *
   * The agenda asks what starts on each day — plus whatever is already under
   * way when it opens. A grid
   * cell asks what is *happening* on its day, so a calving window fills the
   * fortnight it covers rather than marking the 10th and leaving the 18th
   * looking empty.
   */
  const byStartDay = useMemo(() => groupFromDay(entries, period.from), [entries, period]);
  const byGridDay = useMemo(
    () => groupOverSpan(entries, period.from, period.days),
    [entries, period],
  );
  const available = useMemo(() => modulesPresent(everything), [everything]);

  const dayEntries = selectedDay === undefined ? [] : (byGridDay.get(selectedDay) ?? []);

  return (
    // Bottom clearance on a phone, for the floating add button.
    <div className="pb-20 sm:pb-0">
      <PageBody>
        <PageHeader
          title="Calendar"
          subtitle={`${entries.length} ${entries.length === 1 ? "entry" : "entries"}${modules.length === 0 ? "" : " shown"}`}
          actions={
            // Hidden on a phone by a wrapper, not a class on the button: the
            // button's own `inline-flex` wins over a `hidden` passed in.
            <span className="hidden sm:block">
              <Button variant="primary" onClick={() => setDraft(blankDraft(period.from, now))}>
                <span aria-hidden="true">+</span> Add event
              </Button>
            </span>
          }
        />

        {/* Where you are, and the way to move: the period's own name between
          the arrows, so a step always says where it landed. */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button aria-label="Previous" onClick={() => setAnchor(stepPeriod(view, anchor, -1))}>
              ‹
            </Button>
            <Button aria-label="Next" onClick={() => setAnchor(stepPeriod(view, anchor, 1))}>
              ›
            </Button>
          </div>
          <h2 className="min-w-0 text-ink">{period.title}</h2>
          <Button
            variant="ghost"
            onClick={() => {
              setAnchor(startOfDay(new Date()));
              setSelectedDay(undefined);
            }}
          >
            Today
          </Button>
        </div>

        <div
          className="-mx-1 flex items-center gap-1 overflow-x-auto px-1"
          role="group"
          aria-label="Which view of the calendar"
        >
          {CALENDAR_VIEWS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === view}
              className={chipClass(option === view)}
              onClick={() => {
                setView(option);
                setSelectedDay(undefined);
              }}
            >
              {VIEW_LABELS[option]}
            </button>
          ))}
        </div>

        <ModuleFilter available={available} selected={modules} onChange={setModules} />

        {/* A narrowed calendar that does not say so is a farrier who seems
          not to be coming. */}
        {modules.length === 0 ? null : (
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted" aria-live="polite">
            <span>
              Showing {entries.length} of {everything.length}
            </span>
            <span aria-hidden="true">·</span>
            <span>{modules.map((module) => MODULE_LABELS[module]).join(", ")}</span>
            <button
              type="button"
              onClick={() => setModules([])}
              className="inline-flex min-h-target items-center font-semibold text-action underline-offset-2 hover:underline"
            >
              Clear
            </button>
          </p>
        )}

        {loading ? (
          <p className="text-muted">Loading…</p>
        ) : view === "agenda" ? (
          <AgendaDays byDay={byStartDay} onEdit={startEdit} />
        ) : (
          <div className="flex flex-col gap-density">
            <CalendarGrid
              period={period}
              byDay={byGridDay}
              today={now}
              selected={selectedDay}
              onSelect={(day) => setSelectedDay(day === selectedDay ? undefined : day)}
            />

            {selectedDay === undefined ? (
              <p className="text-sm text-muted">Pick a day to read it in full.</p>
            ) : (
              // Labelled, so the panel is a landmark that names the day it is
              // about — it changes under the grid as days are picked, and a
              // reader arriving by keyboard needs to know which one it landed on.
              <section aria-label={longDay(selectedDay)} className="flex flex-col gap-2">
                <h2 className="text-ink">{longDay(selectedDay)}</h2>
                <EntryList
                  entries={dayEntries}
                  emptyTitle="Nothing on this day"
                  onEdit={startEdit}
                />
              </section>
            )}
          </div>
        )}

        {/* On a phone the add button floats where a thumb already is. */}
        <button
          type="button"
          onClick={() => setDraft(blankDraft(period.from, now))}
          className="fixed right-4 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-20 inline-flex h-14 items-center gap-2 rounded-full bg-action pl-4 pr-5 font-semibold text-action-ink shadow-lg hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action sm:hidden"
        >
          <span aria-hidden="true" className="text-xl leading-none">
            +
          </span>
          Add event
        </button>

        {draft === undefined ? null : (
          <Modal
            key={draft.id ?? "new"}
            placement="side"
            title={draft.id === undefined ? "New event" : "Edit event"}
            description="For what nothing else knows about — the farrier, a sale. Everything derived arrives on its own."
            onClose={() => setDraft(undefined)}
            footer={
              <>
                <Button variant="primary" onClick={() => void save()}>
                  {draft.id === undefined ? "Add event" : "Save changes"}
                </Button>
                <Button onClick={() => setDraft(undefined)}>Cancel</Button>
                {draft.id === undefined ? null : (
                  // Closed first, so the confirmation is the only dialog.
                  <Button
                    variant="danger"
                    className="ml-auto"
                    onClick={() => {
                      const entry = entries.find((held) => held.id === draft.id);
                      setDraft(undefined);
                      if (entry !== undefined) void remove(entry);
                    }}
                  >
                    Delete
                  </Button>
                )}
              </>
            }
          >
            <div className="flex flex-col gap-density">
              <TextInput
                label="What is happening"
                required
                value={draft.title}
                error={errors["title"]}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
              <TextArea
                label="Detail"
                rows={3}
                value={draft.detail}
                onChange={(event) => setDraft({ ...draft, detail: event.target.value })}
              />
              <div className="grid grid-cols-1 gap-density sm:grid-cols-2">
                <TextInput
                  label="Day"
                  type="date"
                  required
                  value={draft.day}
                  error={errors["at"]}
                  onChange={(event) => setDraft({ ...draft, day: event.target.value })}
                />
                <TextInput
                  label="Time"
                  type="time"
                  disabled={draft.allDay}
                  value={draft.time}
                  onChange={(event) => setDraft({ ...draft, time: event.target.value })}
                />
              </div>
              <Checkbox
                label="All day"
                checked={draft.allDay}
                onChange={(event) => setDraft({ ...draft, allDay: event.target.checked })}
              />
              <TextInput
                label="Runs until"
                type="date"
                hint="Empty for one day."
                value={draft.endDay}
                error={errors["endAt"]}
                onChange={(event) => setDraft({ ...draft, endDay: event.target.value })}
              />
            </div>
          </Modal>
        )}
      </PageBody>
    </div>
  );

  function startEdit(entry: CalendarEntry) {
    const event = events.find((candidate) => candidate.id === entry.id);
    if (event === undefined) return;

    setErrors({});
    setDraft({
      id: event.id,
      title: event.title,
      detail: event.detail ?? "",
      day: dayKey(event.at),
      time: timeValue(event.at),
      allDay: event.allDay,
      endDay: event.endAt === undefined ? "" : dayKey(event.endAt),
    });
  }

  async function save() {
    if (draft === undefined) return;

    const at = instantFrom(draft.day, draft.allDay ? "00:00" : draft.time);
    if (at === undefined) {
      setErrors({ at: "Pick a day" });
      return;
    }

    const fields = {
      title: draft.title.trim(),
      ...(draft.detail.trim() === "" ? {} : { detail: draft.detail.trim() }),
      at,
      ...(draft.endDay === "" ? {} : { endAt: instantFrom(draft.endDay, "23:59") as Date }),
      allDay: draft.allDay,
    };

    const result =
      draft.id === undefined
        ? await calendarEvents.create(fields)
        : await calendarEvents.update(draft.id, fields);

    if (!result.ok) {
      setErrors(
        result.error.kind === "validation"
          ? Object.fromEntries(
              result.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
            )
          : { title: "Could not save. Check the fields and try again." },
      );
      return;
    }

    show({ message: draft.id === undefined ? "Event added" : "Event saved", tone: "success" });
    setDraft(undefined);
  }

  async function remove(entry: CalendarEntry) {
    const confirmed = await confirmDelete({
      // Standard tier: one event, nothing hangs off it, and the toast puts it
      // straight back (§4.5 clause 3).
      tier: "standard",
      recordName: entry.title,
      entity: "calendar event",
      dependents: [],
    });
    if (!confirmed) return;

    const id = entry.id as Ulid;
    const result = await calendarEvents.remove(id);
    if (!result.ok) {
      show({ message: "Could not delete that event", tone: "danger" });
      return;
    }

    show({
      message: `${entry.title} deleted`,
      action: { label: "Undo", onAct: () => void calendarEvents.restoreRecord(id) },
    });
  }
}

/**
 * §6's "filter by module", as chips.
 *
 * Only the modules with something in the period get one. Offering a chip for a
 * module that projects nothing yet gives somebody a filter that can only empty
 * the screen, which reads as the calendar being broken rather than the module
 * being unbuilt.
 */
function ModuleFilter({
  available,
  selected,
  onChange,
}: {
  readonly available: readonly CalendarModule[];
  readonly selected: readonly CalendarModule[];
  readonly onChange: (next: readonly CalendarModule[]) => void;
}) {
  if (available.length < 2) return null;

  return (
    <div
      className="-mx-1 flex items-center gap-1 overflow-x-auto px-1"
      role="group"
      aria-label="Filter by module"
    >
      <button
        type="button"
        aria-pressed={selected.length === 0}
        className={chipClass(selected.length === 0)}
        onClick={() => onChange([])}
      >
        Everything
      </button>
      {available.map((module) => {
        const on = selected.includes(module);
        return (
          <button
            key={module}
            type="button"
            aria-pressed={on}
            className={chipClass(on)}
            onClick={() =>
              onChange(on ? selected.filter((other) => other !== module) : [...selected, module])
            }
          >
            {MODULE_LABELS[module]}
          </button>
        );
      })}
    </div>
  );
}

/** The agenda: a heading per day that has something, and nothing for the rest. */
function AgendaDays({
  byDay,
  onEdit,
}: {
  readonly byDay: ReadonlyMap<string, CalendarEntry[]>;
  readonly onEdit: (entry: CalendarEntry) => void;
}) {
  if (byDay.size === 0) {
    return <EntryList entries={[]} emptyTitle="Nothing ahead" />;
  }

  // A heading and a list per day, not a card per day: a page of outlines is
  // a page somebody has to read the boxes of before the days.
  return (
    <div className="flex flex-col gap-density">
      {[...byDay.entries()].map(([day, entries]) => (
        <section key={day} aria-label={longDay(day)} className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-muted">{longDay(day)}</h2>
          <EntryList entries={entries} emptyTitle="Nothing on this day" onEdit={onEdit} />
        </section>
      ))}
    </div>
  );
}

/** "Tuesday, 11 August" from a `YYYY-MM-DD` key. */
function longDay(key: string): string {
  // Midday rather than midnight: a `Date` built from a bare key is parsed as
  // UTC, and midnight UTC is the previous evening for everyone west of it.
  return new Date(`${key}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function timeValue(at: Date): string {
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/** A local instant from the two controls, or nothing if the day is blank. */
function instantFrom(day: string, time: string): Date | undefined {
  if (day === "") return undefined;
  const at = new Date(`${day}T${time === "" ? "00:00" : time}:00`);
  return Number.isNaN(at.getTime()) ? undefined : at;
}

function blankDraft(from: Date, now: Date): Draft {
  // The day the person is looking at, unless today is inside it — adding an
  // event while looking at November and having it land on today's date is the
  // one thing a date field defaulted to `now` reliably gets wrong.
  const day = now >= from ? now : from;

  return {
    title: "",
    detail: "",
    day: dayKey(day),
    time: "08:00",
    allDay: true,
    endDay: "",
  };
}
