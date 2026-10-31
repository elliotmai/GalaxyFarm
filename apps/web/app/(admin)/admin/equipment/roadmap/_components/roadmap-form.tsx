"use client";

import { useState } from "react";

import { Button, Select, TextInput, useToast, optionLabel } from "@galaxy-farm/ui";
import {
  fromDollars,
  isRoadmapOpen,
  PRIORITIES,
  ROADMAP_ITEM_TYPES,
  ROADMAP_STATUSES,
  roadmapItemSchema,
  type Priority,
  type RoadmapItem,
  type RoadmapItemType,
  type RoadmapStatus,
  type Ulid,
} from "@galaxy-farm/core";

import { useMutations } from "@/lib/local/mutations";

import { KitFormPanel } from "../../_components/kit-controls";

/**
 * Adding or editing a line on the equipment roadmap, in a side panel (§5.6).
 *
 * Its own component so its draft is its own: it used to live in the roadmap
 * screen, which meant every keystroke in "What" re-rendered every line behind
 * the panel and re-added up the candidates under each one. It mounts fresh
 * each time it opens, so its state starts from the line being edited.
 *
 * Only the title is required. A budget, a date and a reason are what make a
 * want comparable, but a want written down without them is still worth more
 * than one kept in somebody's head.
 */
export function RoadmapForm({
  editing,
  propertyId,
  actorId,
  onClose,
  onDelete,
  onFinish,
}: {
  readonly editing?: RoadmapItem | undefined;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly onClose: () => void;
  /** Present when editing: closes the panel and asks to delete. */
  readonly onDelete?: (() => void) | undefined;
  /**
   * The one-press closes — achieved, dropped — present on an open line. They
   * write at once rather than waiting on Save: closing a line is a decision,
   * not an edit.
   */
  readonly onFinish?: ((status: RoadmapStatus) => void) | undefined;
}) {
  const api = useMutations<RoadmapItem>(
    "roadmapItems",
    "roadmapItems",
    roadmapItemSchema,
    propertyId,
    actorId,
  );
  const { show } = useToast();

  const [type, setType] = useState<RoadmapItemType>(editing?.type ?? "wishlist");
  const [title, setTitle] = useState(editing?.title ?? "");
  const [detail, setDetail] = useState(editing?.detail ?? "");
  const [priority, setPriority] = useState<Priority>(editing?.priority ?? "want");
  const [budget, setBudget] = useState(
    editing?.budgetEstimate === undefined ? "" : (editing.budgetEstimate.cents / 100).toFixed(2),
  );
  const [targetDate, setTargetDate] = useState(
    editing?.targetDate === undefined ? "" : editing.targetDate.toISOString().slice(0, 10),
  );
  const [targetSeason, setTargetSeason] = useState(editing?.targetSeason ?? "");
  const [status, setStatus] = useState<RoadmapStatus>(editing?.status ?? "open");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setBusy(true);

    try {
      const payload = {
        domain: "equipment" as const,
        type,
        title: title.trim(),
        detail: detail.trim() === "" ? undefined : detail.trim(),
        priority,
        // Blank is "no budget yet", not a budget of nothing.
        budgetEstimate: budget.trim() === "" ? undefined : fromDollars(Number(budget)),
        targetDate: targetDate === "" ? undefined : new Date(`${targetDate}T12:00:00`),
        targetSeason: targetSeason.trim() === "" ? undefined : targetSeason.trim(),
        status,
      };

      const result =
        editing === undefined
          ? await api.create(payload as never)
          : await api.update(editing.id, payload as Partial<RoadmapItem>);

      if (!result.ok) {
        setError(
          result.error.kind === "validation"
            ? (result.error.issues[0]?.message ?? "That is not valid")
            : "Could not save that",
        );
        return;
      }

      show({ message: editing === undefined ? "Added to the roadmap" : "Roadmap item updated" });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <KitFormPanel
      title={editing === undefined ? "Add to the roadmap" : `Edit ${editing.title}`}
      submitLabel={editing === undefined ? "Add to roadmap" : "Save item"}
      busy={busy}
      error={error}
      onSubmit={(event) => void submit(event)}
      onClose={onClose}
      onDelete={onDelete}
    >
      <TextInput
        label="What"
        className="sm:col-span-2"
        placeholder="Three-quarter-ton truck"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        required
      />
      <Select
        label="Priority"
        value={priority}
        onChange={(event) => setPriority(event.target.value as Priority)}
        options={PRIORITIES.map((value) => ({ value, label: optionLabel(value) }))}
      />
      <Select
        label="Status"
        value={status}
        onChange={(event) => setStatus(event.target.value as RoadmapStatus)}
        options={ROADMAP_STATUSES.map((value) => ({ value, label: optionLabel(value) }))}
      />
      <Select
        label="Kind"
        value={type}
        onChange={(event) => setType(event.target.value as RoadmapItemType)}
        options={ROADMAP_ITEM_TYPES.map((value) => ({ value, label: optionLabel(value) }))}
      />
      <TextInput
        label="Budget ($)"
        hint="What a candidate's all-in cost is measured against."
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        numeric
        value={budget}
        onChange={(event) => setBudget(event.target.value)}
      />
      <TextInput
        label="Target date"
        type="date"
        value={targetDate}
        onChange={(event) => setTargetDate(event.target.value)}
      />
      <TextInput
        label="…or season"
        placeholder="Before hay season"
        value={targetSeason}
        onChange={(event) => setTargetSeason(event.target.value)}
      />
      <TextInput
        label="Why"
        className="sm:col-span-2"
        value={detail}
        onChange={(event) => setDetail(event.target.value)}
      />
      {onFinish === undefined || editing === undefined || !isRoadmapOpen(editing) ? null : (
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button onClick={() => onFinish("achieved")}>Mark achieved</Button>
          <Button onClick={() => onFinish("dropped")}>Drop it</Button>
        </div>
      )}
    </KitFormPanel>
  );
}
