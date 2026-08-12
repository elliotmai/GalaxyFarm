"use client";

import { useMemo, useState } from "react";

import {
  Button,
  Callout,
  Card,
  DataTable,
  EmptyState,
  Modal,
  PageBody,
  PageHeader,
  Pill,
  SearchSelect,
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
  allRegistrations,
  ASSOCIATIONS,
  canBe,
  externalAnimalSchema,
  filterAncestors,
  inferAncestorSexes,
  NO_FILTER,
  wouldCreateCycle,
  type AncestorFilter,
  type CattleProfile,
  type ExternalAnimal,
  type ParentRef,
} from "@galaxy-farm/module-cattle";

import { AncestorDetail } from "@/app/(admin)/admin/cattle/ancestors/_components/ancestor-detail";
import { DigitalBeefImport } from "@/app/(admin)/admin/cattle/ancestors/_components/import-panel";
import { MergeAncestors } from "@/app/(admin)/admin/cattle/ancestors/_components/merge-panel";
import { checkable, RefreshAllAncestors } from "@/app/(admin)/admin/cattle/ancestors/_components/refresh-all-panel";
import { RefreshFromAssociation } from "@/app/(admin)/admin/cattle/ancestors/_components/refresh-panel";
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
  readonly sex: string;
  readonly tattoo: string;
  readonly colour: string;
  readonly dob: string;
  readonly hornStatus: string;
  readonly sire: string;
  readonly dam: string;
  readonly notes: string;
}

const BLANK: Draft = {
  name: "",
  regNumber: "",
  association: "",
  sex: "",
  tattoo: "",
  colour: "",
  dob: "",
  hornStatus: "",
  sire: "",
  dam: "",
  notes: "",
};

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
  const [filter, setFilter] = useState<AncestorFilter>(NO_FILTER);
  /** The one being checked against its association, if any. */
  const [checking, setChecking] = useState<ExternalAnimal | undefined>();
  /** The one being kept, when two records for one animal are being joined. */
  const [merging, setMerging] = useState<ExternalAnimal | undefined>();
  /** Whether the check-them-all dialog is open. */
  const [checkingAll, setCheckingAll] = useState(false);
  /**
   * The ancestor being looked at, and how we got here.
   *
   * A trail rather than one id: following a line four generations up and then
   * wanting to come back one step is the ordinary way a pedigree gets read,
   * and a dialog that only knows where you are now makes you start again.
   */
  const [trail, setTrail] = useState<readonly Ulid[]>([]);
  const looking = outsiders.find((entry) => entry.id === trail.at(-1));
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

  /**
   * Which ancestors are bulls and which are cows.
   *
   * Almost never typed in — it follows from where an animal sits in a
   * pedigree, because a certificate has a sire column and a dam column rather
   * than a sex field. Computed once for the page: the two parent pickers, the
   * filter bar and the three lists all read it.
   */
  const sexes = useMemo(
    () => inferAncestorSexes(outsiders, [...profiles, ...outsiders]),
    [outsiders, profiles],
  );

  /**
   * Who can be a sire, and who can be a dam.
   *
   * Split, because one list of four hundred names with the cows in it is how a
   * cow gets recorded as a bull's sire — and every pedigree, relatedness figure
   * and colour prediction drawn afterwards is wrong in a way that looks
   * perfectly ordinary on screen. An ancestor nobody has placed yet appears in
   * both, since hiding the animal somebody is looking for is the worse failure.
   */
  const parentOptions = useMemo(() => {
    const build = (role: "male" | "female") => [
      ...animals
        .filter(
          (animal) =>
            animal.species === "cattle" && (animal.sex === role || animal.sex === "unknown"),
        )
        .map((animal) => ({
          value: `animal:${animal.id}`,
          label: displayName(animal),
          ...(animal.tagNumber === undefined ? {} : { detail: animal.tagNumber }),
          group: "Ours",
        })),
      ...[...outsiders]
        .filter((outsider) => canBe(sexes.get(outsider.id), role))
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((outsider) => {
          const papers = allRegistrations(outsider)
            .map((entry) => `${entry.association} ${entry.regNumber}`)
            .join(" · ");
          return {
            value: `external:${outsider.id}`,
            label: outsider.name,
            ...(papers === "" ? {} : { detail: papers }),
            group: sexes.get(outsider.id)?.sex === undefined ? "Not yet placed" : "On the papers",
          };
        }),
    ];

    return { male: build("male"), female: build("female") };
  }, [animals, outsiders, sexes]);

  /** The list the table shows, after the filter bar. */
  const shown = useMemo(
    () => filterAncestors(outsiders, filter, sexes, dependentsOf),
    [outsiders, filter, sexes, dependentsOf],
  );

  const bulls = shown.filter((animal) => sexes.get(animal.id)?.sex === "male");
  const cows = shown.filter((animal) => sexes.get(animal.id)?.sex === "female");
  const unplaced = shown.filter((animal) => sexes.get(animal.id)?.sex === undefined);
  const conflicted = outsiders.filter((animal) => sexes.get(animal.id)?.conflict === true);

  /**
   * The farm's own papered cattle.
   *
   * Their association pages are what carry the defect results of the sire and
   * dam sitting at the top of the ancestor tree — Digital Beef prints an
   * animal's genetic tests on its descendants' charts, never on its own page.
   */
  const ourRegistrations = useMemo(() => {
    const named = new Map(animals.map((entry) => [entry.id, displayName(entry)]));
    return profiles.flatMap((profile) =>
      profile.registrations.map((registration) => ({
        label: named.get(profile.animalId) ?? "an animal here",
        association: registration.association,
        regNumber: registration.regNumber,
      })),
    );
  }, [animals, profiles]);

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
      sex: outsider.sex ?? "",
      tattoo: outsider.tattoo ?? "",
      colour: outsider.colour ?? "",
      dob: outsider.dob === undefined ? "" : outsider.dob.toISOString().slice(0, 10),
      hornStatus: outsider.hornStatus ?? "",
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
        ...(draft.sex === "" ? {} : { sex: draft.sex }),
        ...(draft.tattoo.trim() === "" ? {} : { tattoo: draft.tattoo.trim() }),
        ...(draft.colour.trim() === "" ? {} : { colour: draft.colour.trim() }),
        ...(draft.dob === "" ? {} : { dob: new Date(`${draft.dob}T00:00:00`) }),
        ...(draft.hornStatus.trim() === "" ? {} : { hornStatus: draft.hornStatus.trim() }),
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
              sex: undefined,
              tattoo: undefined,
              colour: undefined,
              dob: undefined,
              hornStatus: undefined,
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
    {
      key: "name",
      header: "Name",
      primary: true,
      render: (row) => (
        <button
          type="button"
          onClick={() => setTrail([row.id])}
          className="text-left text-action underline decoration-edge underline-offset-4 hover:decoration-action"
        >
          {row.name}
        </button>
      ),
    },
    {
      key: "association",
      header: "Registered",
      render: (row) => {
        const papers = allRegistrations(row);
        return papers.length === 0 ? (
          <span className="text-muted">—</span>
        ) : (
          <span className="flex flex-wrap gap-1.5">
            {papers.map((entry) => (
              <Pill key={`${entry.association}-${entry.regNumber}`} tone="identity">
                {entry.association} {entry.regNumber}
              </Pill>
            ))}
          </span>
        );
      },
    },
    {
      key: "sex",
      header: "Bull or cow",
      render: (row) => {
        const verdict = sexes.get(row.id);
        if (verdict?.conflict === true) {
          // Two records disagree about this animal, so one of the pedigrees
          // hanging off it is wrong. Said out loud rather than resolved by
          // picking a winner, which would hide the mistake.
          return (
            <Pill tone="danger" dot>
              used as both
            </Pill>
          );
        }
        if (verdict?.sex === undefined) return <span className="text-muted">not yet placed</span>;
        return (
          <Pill tone={verdict.inferred ? "neutral" : "calm"}>
            {verdict.sex === "male" ? "bull" : "cow"}
            {verdict.inferred ? " (from the pedigree)" : ""}
          </Pill>
        );
      },
    },
    {
      key: "detail",
      header: "Off the papers",
      render: (row) => {
        const parts = [
          row.colour,
          row.hornStatus,
          row.dob === undefined ? undefined : row.dob.toLocaleDateString(),
          row.breedComposition === undefined || row.breedComposition.length === 0
            ? undefined
            : row.breedComposition.map((share) => `${share.percent}% ${share.breed}`).join(" "),
          row.coi === undefined ? undefined : `COI ${row.coi}%`,
        ].filter((part): part is string => part !== undefined && part !== "");

        const carries = (row.geneticTests ?? []).filter(
          (test) => test.status === "carrier" || test.status === "affected",
        );

        return (
          <span className="flex flex-wrap items-center gap-1.5">
            {parts.length === 0 ? <span className="text-muted">—</span> : parts.join(" · ")}
            {carries.length === 0 ? null : (
              <Pill tone="danger" dot>
                {carries.map((test) => test.defect).join(", ")} carrier
              </Pill>
            )}
          </span>
        );
      },
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
        // One way in. Everything that used to be four buttons on every row of
        // a four-hundred-row table lives on the record itself now, where the
        // rest of what it is can be read at the same time.
        <Button variant="ghost" onClick={() => setTrail([row.id])}>
          Open
        </Button>
      ),
    },
  ];

  const referenced = [...dependentsOf.keys()].length;
  const sireCount = outsiders.filter((animal) => sexes.get(animal.id)?.sex === "male").length;
  const damCount = outsiders.filter((animal) => sexes.get(animal.id)?.sex === "female").length;

  return (
    <PageBody>
      <PageHeader
        eyebrow="Cattle"
        title="Ancestors"
        subtitle="Animals on the papers that are not ours. Entered by hand, because no association exposes them any other way."
        actions={
          <span className="flex flex-wrap gap-2">
            {checkable(outsiders).length === 0 ? null : (
              <Button variant="ghost" onClick={() => setCheckingAll(true)}>
                Check all against the associations
              </Button>
            )}
            <Button variant="primary" onClick={startCreate}>
              Add an ancestor
            </Button>
          </span>
        }
      />

      {checking === undefined ? null : (
        <Modal
          // Keyed, so picking a second animal rebuilds it. Without it React
          // reuses the instance and the "check against" dropdown keeps the
          // *previous* animal's registration number — which would quietly
          // compare one animal against another animal's page.
          key={checking.id}
          size="wide"
          title={`Check ${checking.name} against the association`}
          description="A registry is not a snapshot. This reads the page again and shows what has moved."
          onClose={() => setChecking(undefined)}
        >
          <RefreshFromAssociation
            animal={checking}
            everyone={outsiders}
            propertyId={propertyId}
            actorId={actorId}
            onDone={() => setChecking(undefined)}
          />
        </Modal>
      )}

      {looking === undefined ? null : (
        <Modal
          key={looking.id}
          size="wide"
          title={looking.name}
          {...(trail.length > 1
            ? { description: `Followed from ${outsiders.find((entry) => entry.id === trail[0])?.name ?? "the list"}.` }
            : {})}
          onClose={() => setTrail([])}
          footer={
            trail.length <= 1 ? undefined : (
              <Button variant="ghost" onClick={() => setTrail(trail.slice(0, -1))}>
                ← Back to{" "}
                {outsiders.find((entry) => entry.id === trail.at(-2))?.name ?? "the last one"}
              </Button>
            )
          }
        >
          <AncestorDetail
            animal={looking}
            outsiders={outsiders}
            animals={animals}
            profiles={profiles}
            source={source}
            sexes={sexes}
            onOpen={(next) => setTrail([...trail, next.id])}
            onEdit={() => {
              startEdit(looking);
              setTrail([]);
            }}
            onRefresh={() => {
              setChecking(looking);
              setTrail([]);
            }}
            onMerge={() => {
              setMerging(looking);
              setTrail([]);
            }}
            onDelete={() => {
              setTrail([]);
              void remove(looking);
            }}
          />
        </Modal>
      )}

      {!checkingAll ? null : (
        <Modal
          size="wide"
          title="Check every papered ancestor"
          description="For a herd whose papers were read months ago and have been quietly going stale since."
          onClose={() => setCheckingAll(false)}
        >
          <RefreshAllAncestors
            animals={outsiders}
            ourRegistrations={ourRegistrations}
            propertyId={propertyId}
            actorId={actorId}
            onDone={() => setCheckingAll(false)}
          />
        </Modal>
      )}

      {merging === undefined ? null : (
        <Modal
          key={merging.id}
          size="wide"
          title={`Merge another record into ${merging.name}`}
          description="For when one animal was imported from two associations before anything could join them — two records, two numbers, half the descendants on each."
          onClose={() => setMerging(undefined)}
        >
          <MergeAncestors
            keep={merging}
            others={outsiders.filter((entry) => entry.id !== merging.id)}
            profiles={profiles}
            animalNames={new Map(animals.map((entry) => [entry.id, displayName(entry)]))}
            propertyId={propertyId}
            actorId={actorId}
            onDone={() => setMerging(undefined)}
          />
        </Modal>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="On file" value={outsiders.length} tone="identity" />
        <Tile label="Bulls" value={sireCount} />
        <Tile label="Cows" value={damCount} />
        <Tile
          label="Unused"
          value={outsiders.length - referenced}
          hint={outsiders.length - referenced > 0 ? "Safe to delete" : undefined}
        />
      </div>

      {conflicted.length === 0 ? null : (
        <Callout
          tone="danger"
          title={`${conflicted.length} used as both a sire and a dam`}
        >
          {conflicted.map((animal) => animal.name).join(", ")} — one record names each of these as
          a sire and another as a dam. They cannot be both, so one of the pedigrees hanging off
          them is wrong. Set the sex by hand to say which, then fix the record that disagrees.
        </Callout>
      )}

      {draft === undefined ? null : (
        <Modal
          key={editing?.id ?? "new"}
          size="wide"
          title={editing === undefined ? "New ancestor" : `Editing ${editing.name}`}
          description="Off the certificate. Everything here is optional except the name."
          onClose={() => setDraft(undefined)}
        >
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
                label="Bull or cow"
                hint="Usually left alone — it follows from where the animal sits in a pedigree. Set it when nothing places them yet, or to settle a disagreement."
                value={draft.sex}
                placeholder="Work it out from the pedigree"
                options={[
                  { value: "male", label: "Bull" },
                  { value: "female", label: "Cow" },
                ]}
                onChange={(event) => setDraft({ ...draft, sex: event.target.value })}
              />
              <TextInput
                label="Tattoo"
                value={draft.tattoo}
                onChange={(event) => setDraft({ ...draft, tattoo: event.target.value })}
              />
              <TextInput
                label="Colour"
                hint="Feeds the calf-colour prediction, which is the only reason it is worth typing."
                value={draft.colour}
                onChange={(event) => setDraft({ ...draft, colour: event.target.value })}
              />
              <TextInput
                label="Date of birth"
                type="date"
                value={draft.dob}
                onChange={(event) => setDraft({ ...draft, dob: event.target.value })}
              />
              <TextInput
                label="Horns"
                hint="As the association prints it — polled, horned, scurred."
                value={draft.hornStatus}
                onChange={(event) => setDraft({ ...draft, hornStatus: event.target.value })}
              />
              <SearchSelect
                label="Sire"
                hint="Bulls only. Type any part of a name or a registration number."
                value={draft.sire}
                placeholder="Unknown"
                clearLabel="Unknown"
                options={parentOptions.male.filter(
                  (option) => option.value !== `external:${editing?.id ?? ""}`,
                )}
                onChange={(next) => setDraft({ ...draft, sire: next })}
              />
              <SearchSelect
                label="Dam"
                hint="Cows only."
                value={draft.dam}
                placeholder="Unknown"
                clearLabel="Unknown"
                options={parentOptions.female.filter(
                  (option) => option.value !== `external:${editing?.id ?? ""}`,
                )}
                onChange={(next) => setDraft({ ...draft, dam: next })}
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

            <div className="flex flex-wrap gap-2 border-t border-edge pt-density">
              <Button type="submit" busy={busy}>
                {editing === undefined ? "Add ancestor" : "Save ancestor"}
              </Button>
              <Button variant="ghost" onClick={() => setDraft(undefined)}>
                Cancel
              </Button>
            </div>
          </form>
        </Modal>
      )}

      <DigitalBeefImport existing={outsiders} propertyId={propertyId} actorId={actorId} />

      <Section
        title="On file"
        description="Bulls and cows kept apart, because that is the distinction every question on this page turns on."
      >
        <Card>
          <div className="flex flex-col gap-density">
            <TextInput
              label="Search"
              hint="Name, registration number, tattoo, colour or breeder. Any part, in any order."
              value={filter.search}
              onChange={(event) => setFilter({ ...filter, search: event.target.value })}
              placeholder="sull tina, or 4157771"
            />
            <div className="grid grid-cols-1 gap-density sm:grid-cols-4">
              <Select
                label="Bull or cow"
                value={filter.sex}
                options={[
                  { value: "all", label: "Both" },
                  { value: "male", label: "Bulls" },
                  { value: "female", label: "Cows" },
                  { value: "unknown", label: "Not yet placed" },
                ]}
                onChange={(event) =>
                  setFilter({ ...filter, sex: event.target.value as AncestorFilter["sex"] })
                }
              />
              <Select
                label="Association"
                hint="Matches any number the animal holds."
                value={filter.association}
                placeholder="Any"
                options={ASSOCIATIONS.map((value) => ({ value, label: value }))}
                onChange={(event) => setFilter({ ...filter, association: event.target.value })}
              />
              <Select
                label="Used"
                value={filter.usage}
                options={[
                  { value: "all", label: "Any" },
                  { value: "used", label: "Named by a pedigree" },
                  { value: "unused", label: "Nothing points at it" },
                ]}
                onChange={(event) =>
                  setFilter({ ...filter, usage: event.target.value as AncestorFilter["usage"] })
                }
              />
              <Select
                label="Papers"
                value={filter.papers}
                options={[
                  { value: "all", label: "Any" },
                  { value: "registered", label: "Has a number" },
                  { value: "multiple", label: "In two registries" },
                  { value: "unregistered", label: "Name only" },
                ]}
                onChange={(event) =>
                  setFilter({ ...filter, papers: event.target.value as AncestorFilter["papers"] })
                }
              />
            </div>

            <p className="text-sm text-muted">
              Showing {shown.length} of {outsiders.length}.{" "}
              {shown.length === outsiders.length ? null : (
                <button
                  type="button"
                  onClick={() => setFilter(NO_FILTER)}
                  className="text-action underline underline-offset-2"
                >
                  Clear the filters
                </button>
              )}
            </p>
          </div>
        </Card>

        {loading ? (
          <p className="text-muted">Looking…</p>
        ) : outsiders.length === 0 ? (
          <Card>
            <EmptyState
              title="No ancestors on file"
              detail="Add the sire and dam off a certificate, then their parents, and the tree goes back as far as the papers do. Or import a Digital Beef page above and get thirty at once."
            />
          </Card>
        ) : shown.length === 0 ? (
          <Card>
            <EmptyState
              title="Nothing matches"
              detail="Every ancestor is filtered out. Widen the search or clear the filters above."
            />
          </Card>
        ) : (
          <>
            <Group title="Bulls" rows={bulls} columns={columns} />
            <Group title="Cows" rows={cows} columns={columns} />
            <Group
              title="Not yet placed"
              rows={unplaced}
              columns={columns}
              note="Nothing names these as a sire or a dam yet, so which they are is unknown. They show in both parent lists until something places them."
            />
          </>
        )}
      </Section>
    </PageBody>
  );
}

/**
 * One of the three lists.
 *
 * A heading with a count rather than one table with a sortable column: the
 * question on this page is nearly always "which bull was that" or "which cow
 * was that", and two shorter lists answer it faster than one long one sorted
 * the right way. An empty group is not drawn at all — a heading over nothing
 * reads as a loading failure.
 */
function Group({
  title,
  rows,
  columns,
  note,
}: {
  readonly title: string;
  readonly rows: readonly ExternalAnimal[];
  readonly columns: readonly Column<ExternalAnimal>[];
  readonly note?: string;
}) {
  if (rows.length === 0) return null;

  return (
    <Card title={`${title} — ${rows.length}`}>
      <div className="flex flex-col gap-density">
        {note === undefined ? null : <p className="text-sm text-muted">{note}</p>}
        <DataTable
          caption={title}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          empty={null}
        />
      </div>
    </Card>
  );
}
