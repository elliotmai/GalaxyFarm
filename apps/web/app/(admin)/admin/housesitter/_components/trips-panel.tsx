"use client";

import { useState } from "react";

import {
  Button,
  EmptyState,
  Modal,
  Select,
  TextArea,
  TextInput,
  useConfirmDelete,
  useToast,
} from "@galaxy-farm/ui";
import type { CrudError, Ulid } from "@galaxy-farm/core";
import {
  TRIP_TRANSPORTS,
  awayWindow,
  legsInOrder,
  tripDatesAreOrdered,
  tripSchema,
  type Trip,
  type TripLeg,
  type TripTransport,
} from "@galaxy-farm/module-housesitting";

import { fromDateInput, toDateInput } from "@/lib/date-input";
import { useMutations } from "@/lib/local/mutations";

/**
 * The trips behind the housesitter board (spec §5.10, §4.5).
 *
 * Full CRUD, because §4.5 clause 1 admits three exceptions and "the owner
 * types it once a year" is not among them. The board this feeds is read by
 * somebody who cannot ask a follow-up question, so a wrong return date has to
 * be fixable in the ten seconds before they arrive.
 *
 * **A Wander trip is read-only here.** Once a connector owns a row, editing it
 * in this form would be editing something the next pull overwrites — a change
 * that appears to work and silently reverts. So `source: "wander"` disables
 * the fields and says where to make the change instead. Deleting is still
 * allowed: unlinking a trip the farm should not be showing is a decision this
 * app is entitled to make.
 */

interface LegDraft {
  transport: TripTransport;
  number: string;
  from: string;
  to: string;
  departAt: string;
  departTz: string;
  arriveAt: string;
  arriveTz: string;
}

interface TripDraft {
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  whoIsAway: string;
  reachableAt: string;
  notes: string;
  legs: LegDraft[];
}

/** The zone the farm is in, as the sensible default for a leg nobody has typed yet. */
function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago";
  } catch {
    return "America/Chicago";
  }
}

function emptyLeg(): LegDraft {
  return {
    transport: "flight",
    number: "",
    from: "",
    to: "",
    departAt: "",
    departTz: localZone(),
    arriveAt: "",
    arriveTz: localZone(),
  };
}

function draftFrom(trip: Trip | undefined): TripDraft {
  if (trip === undefined) {
    return {
      name: "",
      destination: "",
      startDate: "",
      endDate: "",
      whoIsAway: "",
      reachableAt: "",
      notes: "",
      legs: [],
    };
  }

  return {
    name: trip.name,
    destination: trip.destination ?? "",
    startDate: toDateInput(trip.startDate),
    endDate: toDateInput(trip.endDate),
    whoIsAway: trip.whoIsAway,
    reachableAt: trip.reachableAt ?? "",
    notes: trip.notes ?? "",
    legs: legsInOrder(trip).map((leg) => ({
      transport: leg.transport,
      number: leg.number ?? "",
      from: leg.from,
      to: leg.to,
      departAt: leg.departAt,
      departTz: leg.departTz,
      arriveAt: leg.arriveAt ?? "",
      arriveTz: leg.arriveTz ?? "",
    })),
  };
}

/** Drop the blanks: an optional field the owner left empty is absent, not "". */
function legsFrom(drafts: readonly LegDraft[]): TripLeg[] {
  return drafts
    .filter((leg) => leg.from.trim() !== "" && leg.to.trim() !== "" && leg.departAt !== "")
    .map((leg) => ({
      transport: leg.transport,
      ...(leg.number.trim() === "" ? {} : { number: leg.number.trim() }),
      from: leg.from.trim(),
      to: leg.to.trim(),
      departAt: leg.departAt,
      departTz: leg.departTz.trim(),
      ...(leg.arriveAt === "" ? {} : { arriveAt: leg.arriveAt }),
      ...(leg.arriveAt === "" || leg.arriveTz.trim() === ""
        ? {}
        : { arriveTz: leg.arriveTz.trim() }),
    }));
}

function windowLabel(trip: Trip, now: Date): string {
  const window = awayWindow(trip, now);
  if (window.status === "away") {
    return window.daysUntilReturn === 0
      ? "Away · back today"
      : `Away · ${window.daysUntilReturn}d left`;
  }
  if (window.status === "upcoming") return `In ${window.daysUntilDeparture}d`;
  return "Over";
}

export function TripsPanel({
  trips,
  propertyId,
  actorId,
}: {
  readonly trips: readonly Trip[];
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const mutations = useMutations<Trip>("trips", "trips", tripSchema, propertyId, actorId);
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [draft, setDraft] = useState<TripDraft | undefined>();
  const [editing, setEditing] = useState<Trip | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const now = new Date();
  const ordered = [...trips].sort((a, b) => b.startDate.getTime() - a.startDate.getTime());

  function reportErrors(error: CrudError) {
    // §4.5 clause 2: on the field that caused it, never as one opaque banner.
    setErrors(
      error.kind === "validation"
        ? Object.fromEntries(error.issues.map((issue) => [String(issue.path[0]), issue.message]))
        : { name: "Could not save. Check the fields and try again." },
    );
  }

  function start(existing?: Trip) {
    setEditing(existing);
    setDraft(draftFrom(existing));
    setErrors({});
  }

  async function save() {
    if (draft === undefined) return;

    const startDate = fromDateInput(draft.startDate);
    const endDate = fromDateInput(draft.endDate);
    if (startDate === undefined || endDate === undefined) {
      setErrors({
        ...(startDate === undefined ? { startDate: "When do they leave?" } : {}),
        ...(endDate === undefined ? { endDate: "When are they back?" } : {}),
      });
      return;
    }
    if (!tripDatesAreOrdered({ startDate, endDate })) {
      // A domain invariant rather than a Zod rule — it relates two fields.
      setErrors({ endDate: "They cannot be back before they have left" });
      return;
    }

    const fields = {
      name: draft.name.trim(),
      ...(draft.destination.trim() === "" ? {} : { destination: draft.destination.trim() }),
      startDate,
      endDate,
      whoIsAway: draft.whoIsAway.trim(),
      ...(draft.reachableAt.trim() === "" ? {} : { reachableAt: draft.reachableAt.trim() }),
      ...(draft.notes.trim() === "" ? {} : { notes: draft.notes.trim() }),
      legs: legsFrom(draft.legs),
      source: "manual" as const,
    };

    setBusy(true);
    const result =
      editing === undefined
        ? await mutations.create(fields)
        : await mutations.update(editing.id, fields);
    setBusy(false);

    if (!result.ok) {
      reportErrors(result.error);
      return;
    }

    setDraft(undefined);
    setEditing(undefined);
    show({ message: editing === undefined ? "Trip added" : "Trip saved", tone: "success" });
  }

  async function remove(trip: Trip) {
    const confirmed = await confirmDelete({
      // Elevated rather than standard: this is what a kiosk leads with, and
      // §4.5 puts anything reaching a kiosk at least one tier up.
      tier: "elevated",
      recordName: trip.name,
      entity: "trip",
      dependents: [],
      consequence:
        "The housesitter board stops showing when you are back. Nothing else is touched, and it is restorable from Trash.",
    });
    if (!confirmed) return;

    const result = await mutations.remove(trip.id);
    if (!result.ok) {
      show({ message: "Could not delete that trip", tone: "danger" });
      return;
    }

    show({
      message: `${trip.name} deleted`,
      action: { label: "Undo", onAct: () => void mutations.restoreRecord(trip.id) },
    });
  }

  const locked = editing?.source === "wander";

  return (
    <div className="flex flex-col gap-density">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          What the housesitter board leads with: when you are away, and how to reach you.
        </p>
        <Button variant="primary" onClick={() => start()}>
          Add a trip
        </Button>
      </div>

      {ordered.length === 0 ? (
        <EmptyState
          title="No trips"
          detail="Add one and the housesitter board starts saying when you are back. Later this is filled from Wander instead of typed here."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {ordered.map((trip) => (
            <li
              key={trip.id}
              className="flex flex-wrap items-baseline justify-between gap-2 border border-edge bg-panel p-density"
            >
              <span className="min-w-0">
                <strong>{trip.name}</strong>
                {trip.destination === undefined ? null : (
                  <span className="text-muted"> · {trip.destination}</span>
                )}
                <span className="block text-sm text-muted">
                  {trip.whoIsAway} · {toDateInput(trip.startDate)} → {toDateInput(trip.endDate)} ·{" "}
                  {windowLabel(trip, now)}
                  {trip.legs.length === 0 ? null : ` · ${trip.legs.length} legs`}
                  {trip.source === "wander" ? " · from Wander" : ""}
                </span>
              </span>
              <span className="flex gap-2">
                <Button onClick={() => start(trip)}>
                  {trip.source === "wander" ? "View" : "Edit"}
                </Button>
                <Button variant="danger" onClick={() => void remove(trip)}>
                  Delete
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {draft === undefined ? null : (
        <Modal
          title={editing === undefined ? "Add a trip" : locked ? "Trip from Wander" : "Edit trip"}
          onClose={() => setDraft(undefined)}
        >
          <div className="flex flex-col gap-density">
            {!locked ? null : (
              <p className="text-sm text-muted">
                Wander owns this trip, so the next pull would overwrite anything changed here. Edit
                it in Wander instead — it arrives back on its own.
              </p>
            )}

            <TextInput
              label="Trip"
              required
              disabled={locked}
              value={draft.name}
              error={errors.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
            <TextInput
              label="Where"
              disabled={locked}
              value={draft.destination}
              error={errors.destination}
              onChange={(event) => setDraft({ ...draft, destination: event.target.value })}
            />
            <TextInput
              label="Who is away"
              required
              hint="As a sitter would say it — “Elliot and Mai”"
              disabled={locked}
              value={draft.whoIsAway}
              error={errors.whoIsAway}
              onChange={(event) => setDraft({ ...draft, whoIsAway: event.target.value })}
            />

            <div className="grid grid-cols-2 gap-2">
              <TextInput
                label="Leaving"
                type="date"
                required
                disabled={locked}
                value={draft.startDate}
                error={errors.startDate}
                onChange={(event) => setDraft({ ...draft, startDate: event.target.value })}
              />
              <TextInput
                label="Back"
                type="date"
                required
                disabled={locked}
                value={draft.endDate}
                error={errors.endDate}
                onChange={(event) => setDraft({ ...draft, endDate: event.target.value })}
              />
            </div>

            <TextInput
              label="Reach us on"
              hint="Shown at the top of the housesitter board"
              disabled={locked}
              value={draft.reachableAt}
              error={errors.reachableAt}
              onChange={(event) => setDraft({ ...draft, reachableAt: event.target.value })}
            />
            <TextArea
              label="Anything else"
              rows={3}
              disabled={locked}
              value={draft.notes}
              error={errors.notes}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            />

            <fieldset className="flex flex-col gap-2 border border-edge p-density">
              <legend className="px-1 text-sm text-muted">The journey</legend>

              {draft.legs.map((leg, index) => (
                <div key={index} className="flex flex-col gap-2 border-l-2 border-edge pl-3">
                  <div className="grid grid-cols-2 gap-2">
                    <Select
                      label="How"
                      disabled={locked}
                      value={leg.transport}
                      options={TRIP_TRANSPORTS.map((value) => ({ value, label: value }))}
                      onChange={(event) => {
                        const legs = [...draft.legs];
                        legs[index] = {
                          ...leg,
                          transport: event.target.value as TripTransport,
                        };
                        setDraft({ ...draft, legs });
                      }}
                    />
                    <TextInput
                      label="Number"
                      disabled={locked}
                      value={leg.number}
                      onChange={(event) => {
                        const legs = [...draft.legs];
                        legs[index] = { ...leg, number: event.target.value };
                        setDraft({ ...draft, legs });
                      }}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <TextInput
                      label="From"
                      disabled={locked}
                      value={leg.from}
                      onChange={(event) => {
                        const legs = [...draft.legs];
                        legs[index] = { ...leg, from: event.target.value };
                        setDraft({ ...draft, legs });
                      }}
                    />
                    <TextInput
                      label="To"
                      disabled={locked}
                      value={leg.to}
                      onChange={(event) => {
                        const legs = [...draft.legs];
                        legs[index] = { ...leg, to: event.target.value };
                        setDraft({ ...draft, legs });
                      }}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {/* `datetime-local`, not `date`: a leg is a clock face in a
                        place, stored as typed with its zone beside it. */}
                    <TextInput
                      label="Departs"
                      type="datetime-local"
                      disabled={locked}
                      value={leg.departAt}
                      onChange={(event) => {
                        const legs = [...draft.legs];
                        legs[index] = { ...leg, departAt: event.target.value };
                        setDraft({ ...draft, legs });
                      }}
                    />
                    <TextInput
                      label="Departure zone"
                      hint="America/Chicago"
                      disabled={locked}
                      value={leg.departTz}
                      onChange={(event) => {
                        const legs = [...draft.legs];
                        legs[index] = { ...leg, departTz: event.target.value };
                        setDraft({ ...draft, legs });
                      }}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <TextInput
                      label="Arrives"
                      type="datetime-local"
                      disabled={locked}
                      value={leg.arriveAt}
                      onChange={(event) => {
                        const legs = [...draft.legs];
                        legs[index] = { ...leg, arriveAt: event.target.value };
                        setDraft({ ...draft, legs });
                      }}
                    />
                    <TextInput
                      label="Arrival zone"
                      hint="America/New_York"
                      disabled={locked}
                      value={leg.arriveTz}
                      onChange={(event) => {
                        const legs = [...draft.legs];
                        legs[index] = { ...leg, arriveTz: event.target.value };
                        setDraft({ ...draft, legs });
                      }}
                    />
                  </div>

                  {locked ? null : (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          legs: draft.legs.filter((_, at) => at !== index),
                        })
                      }
                    >
                      Remove this leg
                    </Button>
                  )}
                </div>
              ))}

              {locked ? null : (
                <Button onClick={() => setDraft({ ...draft, legs: [...draft.legs, emptyLeg()] })}>
                  Add a leg
                </Button>
              )}
            </fieldset>

            <div className="flex gap-2">
              {locked ? null : (
                <Button variant="primary" busy={busy} onClick={() => void save()}>
                  Save
                </Button>
              )}
              <Button onClick={() => setDraft(undefined)}>{locked ? "Close" : "Cancel"}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
