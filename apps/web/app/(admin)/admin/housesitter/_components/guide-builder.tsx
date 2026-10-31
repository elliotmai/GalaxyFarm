"use client";

import { useState } from "react";

import {
  Button,
  Checkbox,
  EmptyState,
  Modal,
  Pill,
  Section,
  Select,
  TextArea,
  TextInput,
  useConfirmDelete,
  useToast,
} from "@galaxy-farm/ui";
import type { CrudError, Ulid } from "@galaxy-farm/core";
import {
  GUIDE_SECTION_KINDS,
  careGuideSchema,
  guideSectionSchema,
  type CareGuide,
  type GuideSection,
  type GuideSectionKind,
} from "@galaxy-farm/module-housesitting";

import { useMutations } from "@/lib/local/mutations";

/**
 * Writing the guide (spec §5.10).
 *
 * Two things are stored and nothing else: which auto-sections to compose, and
 * the sections written by hand. Everything the app already knows — who is in
 * which pen, what the routine is, who to ring — is composed at read time, so
 * there is deliberately no way to type it in here. A guide holding its own
 * copy of the pen list would be wrong the first time an animal moved, and
 * nobody would find out until it was being relied on.
 *
 * Rows rather than cards: the guide is one line with an edit button, each
 * written section is its heading and the start of its body, and the forms —
 * with their deletes — open in a side panel, so nothing here reflows while
 * somebody writes.
 */

const KIND_LABELS: Readonly<Record<GuideSectionKind, string>> = {
  pens: "Pens, who is in them, and how to handle them",
  cattle_feeding: "Cattle feeding plans — what goes out, and how much",
  chores: "The daily and weekly routine",
  emergency_contacts: "Who to ring",
  vet: "Vet",
  equipment_quirks: "Equipment quirks",
  pets: "The dogs and cats",
  custom: "Sections you write",
};

/** Composed from live records; the two below are not chosen here. */
const AUTO_KINDS = GUIDE_SECTION_KINDS.filter((kind) => kind !== "custom");

interface GuideDraft {
  readonly title: string;
  readonly intro: string;
  readonly active: boolean;
}

interface SectionDraft {
  readonly title: string;
  readonly bodyMarkdown: string;
  readonly order: string;
}

export function GuideBuilder({
  guides,
  sections,
  chosen,
  onChoose,
  counts,
  loading,
  propertyId,
  actorId,
}: {
  readonly guides: readonly CareGuide[];
  readonly sections: readonly GuideSection[];
  readonly chosen: CareGuide | undefined;
  readonly onChoose: (id: Ulid) => void;
  /** How much each auto-section would actually have in it, right now. */
  readonly counts: Readonly<Record<string, number>>;
  readonly loading: boolean;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const guideMutations = useMutations<CareGuide>(
    "careGuides",
    "careGuides",
    careGuideSchema,
    propertyId,
    actorId,
  );
  const sectionMutations = useMutations<GuideSection>(
    "guideSections",
    "guideSections",
    guideSectionSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [guideDraft, setGuideDraft] = useState<GuideDraft | undefined>();
  const [editingGuide, setEditingGuide] = useState<CareGuide | undefined>();
  const [sectionDraft, setSectionDraft] = useState<SectionDraft | undefined>();
  const [editingSection, setEditingSection] = useState<GuideSection | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  function reportErrors(error: CrudError) {
    // §4.5 clause 2: on the field, not in a banner.
    setErrors(
      error.kind === "validation"
        ? Object.fromEntries(error.issues.map((issue) => [String(issue.path[0]), issue.message]))
        : { title: "Could not save. Check the fields and try again." },
    );
  }

  function startGuide(existing?: CareGuide) {
    setEditingGuide(existing);
    setGuideDraft(
      existing === undefined
        ? { title: "While we are away", intro: "", active: true }
        : { title: existing.title, intro: existing.intro ?? "", active: existing.active },
    );
    setErrors({});
  }

  async function saveGuide() {
    if (guideDraft === undefined) return;
    setErrors({});
    setBusy(true);

    try {
      const fields = {
        title: guideDraft.title.trim(),
        intro: guideDraft.intro.trim() === "" ? undefined : guideDraft.intro.trim(),
        active: guideDraft.active,
        // A new guide starts with everything that has something in it. The
        // alternative — starting empty — produces a blank document somebody
        // has to assemble before they can see whether it is any good.
        includes: editingGuide?.includes ?? AUTO_KINDS.filter((kind) => (counts[kind] ?? 0) > 0),
      };

      const result =
        editingGuide === undefined
          ? await guideMutations.create(fields as never)
          : await guideMutations.update(editingGuide.id, fields as Partial<CareGuide>);

      if (!result.ok) {
        reportErrors(result.error);
        return;
      }

      if (editingGuide === undefined) onChoose(result.value.id);
      show({
        message: editingGuide === undefined ? "Guide started" : "Guide saved",
        tone: "success",
      });
      setGuideDraft(undefined);
      setEditingGuide(undefined);
    } finally {
      setBusy(false);
    }
  }

  async function toggleKind(kind: GuideSectionKind) {
    if (chosen === undefined) return;

    const next = chosen.includes.includes(kind)
      ? chosen.includes.filter((held) => held !== kind)
      : [...chosen.includes, kind];

    const result = await guideMutations.update(chosen.id, { includes: next });
    if (!result.ok) show({ message: "Could not change that section", tone: "danger" });
  }

  async function removeGuide(guide: CareGuide) {
    const confirmed = await confirmDelete({
      // The guide is the aggregate: its hand-written sections point at it and
      // are of no use without it (§4.5 clause 3).
      tier: "typed",
      recordName: guide.title,
      entity: "care guide",
      dependents: sections.map((section) => ({
        entity: "Section",
        label: section.title,
        effect: "deleted" as const,
      })),
      consequence:
        "The sections you wrote go to Trash with it. Nothing composed from live records is touched — those are the farm's own records.",
    });
    if (!confirmed) return;

    const result = await guideMutations.remove(guide.id);
    if (!result.ok) {
      show({ message: "Could not delete that guide", tone: "danger" });
      return;
    }

    show({
      message: `${guide.title} deleted`,
      action: { label: "Undo", onAct: () => void guideMutations.restoreRecord(guide.id) },
    });
  }

  function startSection(existing?: GuideSection) {
    setEditingSection(existing);
    setSectionDraft(
      existing === undefined
        ? {
            title: "",
            bodyMarkdown: "",
            order: String((sections[sections.length - 1]?.order ?? -10) + 10),
          }
        : {
            title: existing.title,
            bodyMarkdown: existing.bodyMarkdown,
            order: String(existing.order),
          },
    );
    setErrors({});
  }

  async function saveSection() {
    if (sectionDraft === undefined || chosen === undefined) return;
    setErrors({});
    setBusy(true);

    try {
      const fields = {
        careGuideId: chosen.id,
        title: sectionDraft.title.trim(),
        bodyMarkdown: sectionDraft.bodyMarkdown.trim(),
        order: Number(sectionDraft.order),
      };

      const result =
        editingSection === undefined
          ? await sectionMutations.create(fields as never)
          : await sectionMutations.update(editingSection.id, fields as Partial<GuideSection>);

      if (!result.ok) {
        reportErrors(result.error);
        return;
      }

      show({ message: "Section saved", tone: "success" });
      setSectionDraft(undefined);
      setEditingSection(undefined);
    } finally {
      setBusy(false);
    }
  }

  async function removeSection(section: GuideSection) {
    const confirmed = await confirmDelete({
      // Standard tier: a section of a document, with nothing hanging off it.
      tier: "standard",
      recordName: section.title,
      entity: "guide section",
      dependents: [],
      consequence: "It comes off the guide. Restorable from Trash.",
      action: "Delete",
    });
    if (!confirmed) return;

    const result = await sectionMutations.remove(section.id);
    if (!result.ok) {
      show({ message: "Could not delete that section", tone: "danger" });
      return;
    }

    show({
      message: "Section deleted",
      action: { label: "Undo", onAct: () => void sectionMutations.restoreRecord(section.id) },
    });
  }

  function guideModal() {
    if (guideDraft === undefined) return null;

    return (
      <Modal
        placement="side"
        title={editingGuide === undefined ? "Start a guide" : `Editing ${editingGuide.title}`}
        onClose={() => {
          setGuideDraft(undefined);
          setEditingGuide(undefined);
          setErrors({});
        }}
        footer={
          <div className="flex w-full flex-wrap gap-2">
            <Button variant="primary" busy={busy} onClick={() => void saveGuide()}>
              {editingGuide === undefined ? "Start it" : "Save changes"}
            </Button>
            <Button
              onClick={() => {
                setGuideDraft(undefined);
                setEditingGuide(undefined);
              }}
            >
              Cancel
            </Button>
            {editingGuide === undefined ? null : (
              // Closed first, so the typed confirmation is the only dialog.
              <Button
                variant="danger"
                className="ml-auto"
                onClick={() => {
                  const guide = editingGuide;
                  setGuideDraft(undefined);
                  setEditingGuide(undefined);
                  void removeGuide(guide);
                }}
              >
                Delete
              </Button>
            )}
          </div>
        }
      >
        <div className="flex flex-col gap-density">
          <TextInput
            label="Title"
            required
            value={guideDraft.title}
            error={errors["title"]}
            onChange={(event) => setGuideDraft({ ...guideDraft, title: event.target.value })}
          />
          <TextArea
            label="Opening"
            rows={4}
            hint="Where the key is, when you are back, who else knows."
            value={guideDraft.intro}
            error={errors["intro"]}
            onChange={(event) => setGuideDraft({ ...guideDraft, intro: event.target.value })}
          />
          <Checkbox
            label="In use"
            hint="Retire an old guide without losing it."
            checked={guideDraft.active}
            onChange={(event) => setGuideDraft({ ...guideDraft, active: event.target.checked })}
          />
        </div>
      </Modal>
    );
  }

  if (loading) return <p className="text-muted">Loading guides…</p>;

  if (chosen === undefined) {
    return (
      <>
        <EmptyState
          title="No guide yet"
          detail="A title and an opening. The pens, routine and numbers come from the farm's records."
          action={
            <Button variant="primary" onClick={() => startGuide()}>
              Start one
            </Button>
          }
        />
        {guideModal()}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-density">
      {/*
        The guide itself, as one row: its title, its opening, and the way to
        edit both. More than one is allowed — a weekend and a fortnight ask for
        different things — so the picker appears once there are two.
      */}
      <div className="flex flex-wrap items-end gap-2">
        {guides.length < 2 ? null : (
          <div className="min-w-0 flex-1">
            <Select
              label="Guide"
              hideLabel
              value={chosen.id}
              options={guides.map((guide) => ({
                value: guide.id,
                label: guide.active ? guide.title : `${guide.title} (retired)`,
              }))}
              onChange={(event) => onChoose(event.target.value as Ulid)}
            />
          </div>
        )}
        <Button onClick={() => startGuide()}>New guide</Button>
      </div>

      <div className="flex overflow-hidden rounded-density border border-rule bg-panel">
        <button
          type="button"
          onClick={() => startGuide(chosen)}
          className="flex min-h-[60px] min-w-0 flex-1 items-center gap-3 py-2 pl-4 pr-3 text-left text-ink hover:bg-canvas focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-action"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate font-semibold">{chosen.title}</span>
            <span className="line-clamp-2 text-sm text-muted">
              {chosen.intro ?? "No opening yet — where the key is, when you are back."}
            </span>
          </span>
          {chosen.active ? null : <Pill tone="neutral">Retired</Pill>}
          <EditGlyph />
        </button>
      </div>

      <Section
        title="What to compose"
        description="Built from the farm's own records each time the guide is opened, so nothing here goes stale. Pens lead with their effective safety level — the higher of the pen's own and its worst occupant."
      >
        <div className="grid grid-cols-1 gap-x-density sm:grid-cols-2">
          {AUTO_KINDS.map((kind) => {
            const count = counts[kind] ?? 0;

            return (
              <Checkbox
                key={kind}
                label={KIND_LABELS[kind]}
                hint={
                  kind === "equipment_quirks"
                    ? "Not available yet"
                    : count === 0
                      ? "Nothing to show — prints empty"
                      : `${count} to show`
                }
                checked={chosen.includes.includes(kind)}
                disabled={kind === "equipment_quirks"}
                onChange={() => void toggleKind(kind)}
              />
            );
          })}
        </div>
      </Section>

      <Section
        title="Sections you write"
        description="What the app cannot know: the alarm code, who has the spare key."
        actions={<Button onClick={() => startSection()}>Add a section</Button>}
      >
        {sections.length === 0 ? (
          <EmptyState
            title="Nothing written yet"
            action={<Button onClick={() => startSection()}>Write one</Button>}
          />
        ) : (
          <ul className="flex flex-col divide-y divide-rule overflow-hidden rounded-density border border-rule bg-panel">
            {sections.map((section) => (
              <li key={section.id} className="flex items-center">
                {/* The whole row edits: the panel it opens is where delete is. */}
                <button
                  type="button"
                  onClick={() => startSection(section)}
                  className="flex min-h-[60px] min-w-0 flex-1 items-center gap-3 py-2 pl-4 pr-3 text-left text-ink hover:bg-canvas focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-action"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate font-semibold">{section.title}</span>
                    <span className="truncate text-sm text-muted">{section.bodyMarkdown}</span>
                  </span>
                  <EditGlyph />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {guideModal()}

      {sectionDraft === undefined ? null : (
        <Modal
          placement="side"
          title={
            editingSection === undefined
              ? "A section of your own"
              : `Editing ${editingSection.title}`
          }
          description="Plain text, or Markdown if you like. It prints as written."
          onClose={() => {
            setSectionDraft(undefined);
            setEditingSection(undefined);
            setErrors({});
          }}
          footer={
            <div className="flex w-full flex-wrap gap-2">
              <Button variant="primary" busy={busy} onClick={() => void saveSection()}>
                Save section
              </Button>
              <Button
                onClick={() => {
                  setSectionDraft(undefined);
                  setEditingSection(undefined);
                }}
              >
                Cancel
              </Button>
              {editingSection === undefined ? null : (
                <Button
                  variant="danger"
                  className="ml-auto"
                  onClick={() => {
                    const section = editingSection;
                    setSectionDraft(undefined);
                    setEditingSection(undefined);
                    void removeSection(section);
                  }}
                >
                  Delete
                </Button>
              )}
            </div>
          }
        >
          <div className="flex flex-col gap-density">
            <div className="grid grid-cols-1 gap-density sm:grid-cols-[3fr_1fr]">
              <TextInput
                label="Heading"
                required
                value={sectionDraft.title}
                error={errors["title"]}
                onChange={(event) =>
                  setSectionDraft({ ...sectionDraft, title: event.target.value })
                }
              />
              <TextInput
                label="Order"
                type="number"
                numeric
                hint="Low first."
                value={sectionDraft.order}
                error={errors["order"]}
                onChange={(event) =>
                  setSectionDraft({ ...sectionDraft, order: event.target.value })
                }
              />
            </div>
            <TextArea
              label="Body"
              rows={10}
              required
              error={errors["bodyMarkdown"]}
              value={sectionDraft.bodyMarkdown}
              onChange={(event) =>
                setSectionDraft({ ...sectionDraft, bodyMarkdown: event.target.value })
              }
            />
          </div>
        </Modal>
      )}
    </div>
  );
}

/** The pencil at the end of a row that opens its editor. Decoration only. */
function EditGlyph() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-muted"
    >
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  );
}
