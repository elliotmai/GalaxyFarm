"use client";

import { useMemo, useState } from "react";

import {
  Button,
  Card,
  DataTable,
  EmptyState,
  PageBody,
  PageHeader,
  Pill,
  Section,
  Select,
  TextArea,
  TextInput,
  Tile,
  useConfirmDelete,
  useToast,
  type Column,
} from "@galaxy-farm/ui";
import { displayName, type Animal, type Ulid } from "@galaxy-farm/core";
import {
  ASSOCIATIONS,
  externalAnimalSchema,
  wouldCreateCycle,
  type CattleProfile,
  type ExternalAnimal,
  type ParentRef,
} from "@galaxy-farm/module-cattle";

import { useMutations } from "@/lib/local/mutations";
import { usePedigreeSource } from "@/lib/pedigree-source";
import { useRecords } from "@/lib/local/use-records";

/**
 * Ancestors that are not ours (spec §5.2, issue #16).
 *
 * A five-generation pedigree has thirty ancestors and this farm will own two
 * of them. The other twenty-eight are names on a certificate — they have no
 * pen, no weight, and no health history, and making them `Animal` records
 * would mean thirty rows on the herd screen for cattle nobody has ever seen.
 *
 * They are entered by hand off paper, which means they will contain typos,
 * which is why this screen exists at all: an ancestor with a mistyped
 * registration number has to be fixable without deleting the tree that hangs
 * off it.
 */

function refKey(ref: ParentRef | undefined): string {
  return ref === undefined ? "" : `${ref.kind}:${ref.id}`;
}

function parseRef(value: string): ParentRef | undefined {
  if (value === "") return undefined;
  const [kind, id] = value.split(":");
  return kind === "animal" || kind === "external" ? { kind, id: id as Ulid } : undefined;
}

interface Draft {
  readonly name: string;
  readonly regNumber: string;
  readonly association: string;
  readonly sire: string;
  readonly dam: string;
  readonly notes: string;
}

const BLANK: Draft = { name: "", regNumber: "", association: "", sire: "", dam: "", notes: "" };

export function AncestorsScreen({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const query = { propertyId };
  const { records: outsiders, loading } = useRecords<ExternalAnimal>("externalAnimals", query);
  const { records: animals } = useRecords<Animal>("animals", query);
  const { records: profiles } = useRecords<CattleProfile>("cattleProfiles", query);

  const api = useMutations<ExternalAnimal>(
    "externalAnimals",
    "externalAnimals",
    externalAnimalSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();
  const source = usePedigreeSource({ animals, profiles, outsiders });

  const [editing, setEditing] = useState<ExternalAnimal | undefined>();
  const [draft, setDraft] = useState<Draft | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  /**
   * Who names each ancestor as a parent.
   *
   * Built once for the whole screen and keyed by reference, because it is what
   * both the "used by" column and the restrict rule on delete read — and
   * recomputing it per row would walk every profile once per ancestor.
   */
  const dependentsOf = useMemo(() => {
    const map = new Map<string, string[]>();
    const note = (ref: ParentRef | undefined, label: string) => {
      if (ref === undefined || ref.kind !== "external") return;
      const key = refKey(ref);
      map.set(key, [...(map.get(key) ?? []), label]);
    };

    const named = new Map(animals.map((animal) => [animal.id, displayName(animal)]));
    for (const profile of profiles) {
      const label = named.get(profile.animalId) ?? "an animal";
      note(profile.sire, label);
      note(profile.dam, label);
    }
    for (const outsider of outsiders) {
      note(outsider.sire, outsider.name);
      note(outsider.dam, outsider.name);
    }
    return map;
  }, [animals, profiles, outsiders]);

  /** Every animal and ancestor that could be somebody's parent, as one list. */
  const parentOptions = useMemo(
    () => [
      ...animals
        .filter((animal) => animal.species === "cattle")
        .map((animal) => ({
          value: `animal:${animal.id}`,
          label: `${displayName(animal)} (ours)`,
        })),
      ...[...outsiders]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((outsider) => ({ value: `external:${outsider.id}`, label: outsider.name })),
    ],
    [animals, outsiders],
  );

  function startCreate() {
    setEditing(undefined);
    setDraft(BLANK);
    setError(undefined);
  }

  function startEdit(outsider: ExternalAnimal) {
    setEditing(outsider);
    setDraft({
      name: outsider.name,
      regNumber: outsider.regNumber ?? "",
      association: outsider.association ?? "",
      sire: refKey(outsider.sire),
      dam: refKey(outsider.dam),
      notes: outsider.notes ?? "",
    });
    setError(undefined);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (draft === undefined) return;
    setError(undefined);

    if (draft.name.trim() === "") {
      setError("An ancestor needs a name");
      return;
    }

    const sire = parseRef(draft.sire);
    const dam = parseRef(draft.dam);

    // §5.2: a loop is rejected at the write, not tolerated by the reader. One
    // mistyped registration number is all it takes to make an animal its own
    // great-grandsire, and a tree that contains a loop is wrong whether or not
    // anything survives walking it.
    if (editing !== undefined) {
      const self: ParentRef = { kind: "external", id: editing.id };
      const loop = [sire, dam].find(
        (parent) => parent !== undefined && wouldCreateCycle(self, parent, source),
      );
      if (loop !== undefined) {
        setError(`${draft.name.trim()} already appears above that animal — that would be a loop.`);
        return;
      }
    }

    setBusy(true);
    try {
      const payload = {
        name: draft.name.trim(),
        ...(draft.regNumber.trim() === "" ? {} : { regNumber: draft.regNumber.trim() }),
        ...(draft.association === "" ? {} : { association: draft.association }),
        ...(sire === undefined ? {} : { sire }),
        ...(dam === undefined ? {} : { dam }),
        ...(draft.notes.trim() === "" ? {} : { notes: draft.notes.trim() }),
      };

      const result =
        editing === undefined
          ? await api.create(payload as never)
          : // Cleared fields are sent as undefined rather than omitted, so
            // removing a sire actually removes it instead of leaving the old
            // one in place.
            await api.update(editing.id, {
              sire: undefined,
              dam: undefined,
              regNumber: undefined,
              association: undefined,
              notes: undefined,
              ...payload,
            } as Partial<ExternalAnimal>);

      if (!result.ok) {
        setError(
          result.error.kind === "validation"
            ? (result.error.issues[0]?.message ?? "That is not valid")
            : "Could not save that",
        );
        return;
      }

      show({
        message: editing === undefined ? `${draft.name.trim()} added` : "Ancestor updated",
        tone: "success",
      });
      setDraft(undefined);
      setEditing(undefined);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Deleting an ancestor (§4.5 clause 3, #16).
   *
   * Restrict, not cascade: an ancestor named by a pedigree cannot be deleted
   * while it is named, and the descendants are listed by name rather than
   * counted. "3 records affected" is not something anybody can act on; "Star's
   * pedigree and Comet's pedigree" is.
   */
  async function remove(outsider: ExternalAnimal) {
    const named = dependentsOf.get(`external:${outsider.id}`) ?? [];

    if (named.length > 0) {
      show({
        message: `${outsider.name} is an ancestor of ${[...new Set(named)].join(", ")}. Clear that first.`,
        tone: "warning",
      });
      return;
    }

    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: outsider.name,
      entity: "ancestor",
      dependents: [],
      consequence:
        "Nothing points at this ancestor. Re-entering one off the papers is a certificate and five minutes.",
      action: "Delete",
    });
    if (!confirmed) return;

    await api.remove(outsider.id, "Removed from the ancestors");
    show({ message: `${outsider.name} deleted`, tone: "danger" });
  }

  const columns: readonly Column<ExternalAnimal>[] = [
    { key: "name", header: "Name", primary: true, render: (row) => row.name },
    {
      key: "reg",
      header: "Registration",
      numeric: true,
      render: (row) =>
        row.regNumber === undefined ? <span className="text-muted">—</span> : row.regNumber,
    },
    {
      key: "association",
      header: "Association",
      render: (row) =>
        row.association === undefined ? (
          <span className="text-muted">—</span>
        ) : (
          <Pill tone="identity">{row.association}</Pill>
        ),
    },
    {
      key: "parents",
      header: "Parents",
      render: (row) => {
        const parents = [row.sire, row.dam]
          .filter((ref): ref is ParentRef => ref !== undefined)
          .map((ref) => source.describe(ref)?.name ?? "unknown");
        return parents.length === 0 ? <span className="text-muted">—</span> : parents.join(" × ");
      },
    },
    {
      key: "used",
      header: "Ancestor of",
      render: (row) => {
        const named = [...new Set(dependentsOf.get(`external:${row.id}`) ?? [])];
        return named.length === 0 ? (
          <span className="text-muted">nobody yet</span>
        ) : (
          <span className="flex flex-wrap gap-1.5">
            {named.map((label) => (
              <Pill key={label}>{label}</Pill>
            ))}
          </span>
        );
      },
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

  const referenced = [...dependentsOf.keys()].length;

  return (
    <PageBody>
      <PageHeader
        eyebrow="Cattle"
        title="Ancestors"
        subtitle="Animals on the papers that are not ours. Entered by hand, because no association exposes them any other way."
        actions={
          <Button variant="primary" onClick={startCreate}>
            Add an ancestor
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Tile label="On file" value={outsiders.length} tone="identity" />
        <Tile label="Named by a pedigree" value={referenced} tone="calm" />
        <Tile
          label="Unused"
          value={outsiders.length - referenced}
          hint={outsiders.length - referenced > 0 ? "Safe to delete" : undefined}
        />
      </div>

      {draft === undefined ? null : (
        <Card title={editing === undefined ? "New ancestor" : `Editing ${editing.name}`}>
          <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-density">
            <div className="grid grid-cols-1 gap-density sm:grid-cols-2">
              <TextInput
                label="Name"
                hint="As it reads on the certificate."
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                required
              />
              <TextInput
                label="Registration number"
                numeric
                value={draft.regNumber}
                onChange={(event) => setDraft({ ...draft, regNumber: event.target.value })}
              />
              <Select
                label="Association"
                value={draft.association}
                placeholder="Not recorded"
                options={ASSOCIATIONS.map((value) => ({ value, label: value }))}
                onChange={(event) => setDraft({ ...draft, association: event.target.value })}
              />
              <Select
                label="Sire"
                value={draft.sire}
                placeholder="Unknown"
                options={parentOptions.filter(
                  (option) => option.value !== `external:${editing?.id ?? ""}`,
                )}
                onChange={(event) => setDraft({ ...draft, sire: event.target.value })}
              />
              <Select
                label="Dam"
                value={draft.dam}
                placeholder="Unknown"
                options={parentOptions.filter(
                  (option) => option.value !== `external:${editing?.id ?? ""}`,
                )}
                onChange={(event) => setDraft({ ...draft, dam: event.target.value })}
              />
            </div>
            <TextArea
              label="Notes"
              rows={2}
              value={draft.notes}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            />

            {error === undefined ? null : (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" busy={busy}>
                {editing === undefined ? "Add ancestor" : "Save ancestor"}
              </Button>
              <Button variant="ghost" onClick={() => setDraft(undefined)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Section title="On file">
        {loading ? (
          <p className="text-muted">Looking…</p>
        ) : (
          <Card>
            <DataTable
              caption="External animals"
              columns={columns}
              rows={[...outsiders].sort((left, right) => left.name.localeCompare(right.name))}
              rowKey={(row) => row.id}
              empty={
                <EmptyState
                  title="No ancestors on file"
                  detail="Add the sire and dam off a certificate, then their parents, and the tree goes back as far as the papers do."
                />
              }
            />
          </Card>
        )}
      </Section>
    </PageBody>
  );
}
