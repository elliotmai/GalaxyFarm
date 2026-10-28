"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import type { ReactNode } from "react";

import {
  Button,
  DetailList,
  EmptyState,
  Modal,
  Pill,
  Select,
  TextInput,
  PageBody,
  SafetyBadge,
  Section,
  TextArea,
  useConfirmDelete,
  useToast,
} from "@galaxy-farm/ui";
import {
  animalsWithoutOutside,
  effectiveSlot,
  openAssignments,
  type Animal,
  type Ulid,
  type Zone,
  type ZoneAssignment,
} from "@galaxy-farm/core";
import {
  animalsUnderWithdrawal,
  ASSOCIATIONS,
  awaitingCalving,
  CATTLE_CLASS_SINGULAR,
  cattleClass,
  cattleProfileSchema,
  damsThatHaveCalved,
  describeComposition,
  describeCompositionSource,
  HORN_STATUSES,
  isPapered,
  projectedDueDate,
  type Association,
  type BreedingRecord,
  type CalvingRecord,
  type CattleProfile,
  type ExternalAnimal,
  type ResolvedComposition,
  type HealthRecord,
  type HeatRecord,
  type HornStatus,
  type Registration,
  type WeightRecord,
} from "@galaxy-farm/module-cattle";

import { AnimalActions } from "@/app/(admin)/admin/cattle/[id]/_components/animal-actions";
import {
  comingUp,
  history,
  type TimelineInputs,
  type TimelineRow,
} from "@/app/(admin)/admin/cattle/[id]/_components/animal-history";
import {
  BreedComposition,
  BreedField,
  BreedingTab,
  FinanceTab,
  Pedigree,
  WeightsTab,
} from "@/app/(admin)/admin/cattle/[id]/_components/animal-tabs";
import { Chip, ChipRow, Row, Rows } from "@/app/(admin)/admin/cattle/[id]/_components/record-rows";
import { GeneticsPanel } from "@/app/(admin)/admin/cattle/[id]/_components/genetics-panel";
import { ageLabel, flagFor } from "@/app/(admin)/admin/cattle/_components/herd-row";
import { PhotoPanel } from "@/app/_components/photo-panel";
import { animalSlug, animalTitle, resolveAnimalSlug } from "@/lib/animal-slug";
import { compositionLookup, compositionOfAnimal } from "@/lib/composition";
import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

/**
 * One animal (spec §7, §5.2; V2 Animal).
 *
 * Read top to bottom it answers, in order: who is she, what do I want to
 * record about her, what is coming, and what has happened. The top is the
 * same anatomy as her row in the herd — tag, name, one line, at most one chip
 * — so the page reads as that row opened. Then eight big buttons that open the
 * Log flow with her already chosen; then "Coming up"; then one History list,
 * newest first, merging what used to sit under three tabs. Everything a
 * working week does not reach for — pedigree, papers, genetics, money — is one
 * disclosure at the bottom, and every one of those views still works there.
 *
 * The URL is a slug, not an id — see `lib/animal-slug.ts`. The record is found
 * by walking the herd on the device rather than by a keyed lookup, which is
 * cheap at this size and is what lets an old link keep resolving after a cow
 * is renamed or finally tagged.
 */

/** How much History shows before "Show all" — about a phone screen. */
const HISTORY_PAGE = 12;

export function AnimalScreen({
  slug,
  propertyId,
  actorId,
}: {
  readonly slug: string;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const router = useRouter();
  const { records: animals, loading } = useRecords<Animal>("animals", { propertyId });
  const { records: profiles } = useRecords<CattleProfile>("cattleProfiles", { propertyId });
  const { records: outsiders } = useRecords<ExternalAnimal>("externalAnimals", { propertyId });
  const { records: zones } = useRecords<Zone>("zones", { propertyId });
  const { records: placements } = useRecords<ZoneAssignment>("zoneAssignments", { propertyId });
  const { records: health } = useRecords<HealthRecord>("healthRecords", { propertyId });
  const { records: breedings } = useRecords<BreedingRecord>("breedingRecords", { propertyId });
  const { records: calvings } = useRecords<CalvingRecord>("calvingRecords", { propertyId });
  const { records: weights } = useRecords<WeightRecord>("weightRecords", { propertyId });
  const { records: heats } = useRecords<HeatRecord>("heatRecords", { propertyId });

  const [showAll, setShowAll] = useState(false);

  // One clock for the whole render, so the age, the class and the due date
  // cannot disagree with each other on the morning of a birthday.
  const asOf = useMemo(() => new Date(), []);

  const registrationOf = useMemo(() => {
    const byAnimal = new Map(profiles.map((profile) => [profile.animalId, profile]));
    return (animal: { id: Ulid }) => byAnimal.get(animal.id)?.registrations[0]?.regNumber;
  }, [profiles]);

  const found = useMemo(
    () => resolveAnimalSlug(slug, animals, registrationOf),
    [slug, animals, registrationOf],
  );

  if (loading) return <p className="text-muted">Looking…</p>;

  if (found === undefined) {
    return (
      <PageBody>
        <EmptyState
          title="No animal by that name"
          detail="Nothing on this device answers to that tag, registration, or name."
          action={
            <Link href="/admin/cattle" className="text-action underline">
              Back to the herd
            </Link>
          }
        />
      </PageBody>
    );
  }

  const animal = found.animal;
  const profile = profiles.find((entry) => entry.animalId === animal.id);

  /**
   * What breed she is, and where that answer came from.
   *
   * The papers win. Where there are none it is worked out from the parents,
   * walked back until something *is* papered — so a commercial cow out of two
   * registered animals still gets a real makeup rather than a blank.
   */
  const breeding = compositionOfAnimal(animal.id, compositionLookup(profiles, outsiders));
  // Both slots, not just one. `currentAssignment` defaults to the legacy
  // `primary` slot, so a cow standing in the barn — an `inside` assignment —
  // read as unassigned on her own page while the pen board showed her in it.
  const indoorZoneIds = new Set(zones.filter((entry) => entry.indoor).map((entry) => entry.id));
  const standing = openAssignments(placements, animal.id).map((entry) => ({
    assignment: entry,
    zone: zones.find((candidate) => candidate.id === entry.zoneId),
    slot: effectiveSlot(entry, indoorZoneIds),
  }));

  // The outside pen is the one people mean by "where is she", so it leads.
  const outside = standing.find((entry) => entry.slot === "outside");
  const inside = standing.find((entry) => entry.slot === "inside");
  const zone = (outside ?? inside)?.zone;

  // #15: a withdrawal must be unmissable here. Selling or slaughtering an
  // animal inside one is a residue violation, and the person about to do it is
  // usually looking at this page — so it takes the header's one chip, and
  // leads "Coming up" with the date she clears and what put her there.
  const withdrawn = animalsUnderWithdrawal(health, asOf).some(
    (entry) => entry.animalId === animal.id,
  );

  // The same class and the same chip her herd row shows, worked out the same
  // way, so the list and the page never describe one cow two ways.
  const kind = cattleClass(animal, asOf, {
    hasCalved: damsThatHaveCalved(calvings, breedings).has(animal.id),
  });
  const due = awaitingCalving(breedings, calvings, asOf)
    .filter((record) => record.damId === animal.id)
    .map(projectedDueDate)
    .sort((left, right) => left.getTime() - right.getTime())[0];
  const flag = flagFor({
    animal,
    withdrawn,
    unplaced: animalsWithoutOutside([animal], placements, indoorZoneIds).length > 0,
    due,
    now: asOf,
  });

  const where = [outside?.zone?.name, inside?.zone?.name].filter(Boolean).join(" and ");
  const facts = [
    breeding.composition.length === 0
      ? undefined
      : `${describeComposition(breeding.composition)}${breeding.source === "parents" ? " (from parents)" : ""}`,
    kind === undefined ? animal.sex : CATTLE_CLASS_SINGULAR[kind],
    ageLabel(animal, asOf),
    where,
    animal.ownership === "client" ? "Client calf" : undefined,
  ]
    .filter((part) => part !== undefined && part !== "")
    .join(" · ");

  // The URL the record answers to now. Somebody who arrived by an old link
  // gets moved to the current one rather than being left on a stale address
  // that will stop working the next time something changes.
  const canonical = animalSlug(animal, registrationOf(animal));
  if (found.stale && canonical !== slug) {
    router.replace(`/admin/cattle/${canonical}`);
  }

  const timeline: TimelineInputs = {
    animal,
    animals,
    outsiders,
    zones,
    placements,
    health,
    weights,
    breedings,
    calvings,
    heats,
    now: asOf,
  };
  const ahead = comingUp(timeline);
  const past = history(timeline);
  const pastShown = showAll ? past : past.slice(0, HISTORY_PAGE);

  const tag = animal.tagNumber;

  return (
    <PageBody>
      <header className="flex flex-col gap-2">
        {/* The trail. On a phone the tab bar already says where this is, but
            the way back to the whole list is worth a line. */}
        <p className="text-xs font-medium text-muted">
          <Link
            href="/admin/animals"
            className="inline-flex min-h-target items-center hover:text-ink md:min-h-0"
          >
            <span aria-hidden="true">‹</span>&nbsp;Animals
          </Link>
        </p>
        <div className="flex min-w-0 items-center gap-3">
          {/* The ear tag, as on her row: what somebody at the chute reads
              off her ear, so it is the first thing on the page. */}
          <span
            aria-hidden={tag === undefined || tag === "" ? true : undefined}
            className="gf-numeric flex h-14 min-w-[3.5rem] max-w-[7rem] shrink-0 items-center justify-center rounded-full bg-raised px-2 font-semibold text-action"
          >
            <span className="truncate">{tag === undefined || tag === "" ? "–" : tag}</span>
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-ink">{animalTitle(animal)}</h1>
              {flag === undefined ? null : flag.kind === "safety" ? (
                <SafetyBadge level={flag.level} size="compact" />
              ) : (
                <Pill tone={flag.tone}>{flag.label}</Pill>
              )}
            </div>
            {facts === "" ? null : <p className="text-sm text-muted">{facts}</p>}
          </div>
        </div>
        {/* Why she is a handful, said before anybody opens her gate — the one
            part of the old Overview that cannot wait behind a disclosure. */}
        {animal.safetyLevel >= 4 &&
        animal.safetyNotes !== undefined &&
        animal.safetyNotes !== "" ? (
          <p className="text-sm text-danger">{animal.safetyNotes}</p>
        ) : null}
      </header>

      <AnimalActions animalId={animal.id} propertyId={propertyId} actorId={actorId} />

      <Section title="Coming up">
        {ahead.length === 0 ? (
          <p className="text-sm text-muted">Nothing coming up.</p>
        ) : (
          <Rows label="Coming up">
            {ahead.map((row) => (
              <TimelineItem key={row.key} row={row} />
            ))}
          </Rows>
        )}
      </Section>

      <Section
        title="History"
        description={past.length === 0 ? undefined : `${past.length} on file`}
      >
        {past.length === 0 ? (
          <p className="text-sm text-muted">Nothing recorded yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <Rows label={`History for ${animalTitle(animal)}`}>
              {pastShown.map((row) => (
                <TimelineItem key={row.key} row={row} />
              ))}
            </Rows>
            {past.length > HISTORY_PAGE ? (
              <button
                type="button"
                onClick={() => setShowAll((was) => !was)}
                className="inline-flex min-h-target items-center self-start text-sm font-semibold text-action underline-offset-2 hover:underline"
              >
                {showAll ? "Show fewer" : `Show all ${past.length}`}
              </button>
            ) : null}
          </div>
        )}
      </Section>

      <Deeper
        animal={animal}
        profile={profile}
        profiles={profiles}
        outsiders={outsiders}
        zone={zone}
        breeding={breeding}
        propertyId={propertyId}
        actorId={actorId}
      />
    </PageBody>
  );
}

function TimelineItem({ row }: { readonly row: TimelineRow }) {
  return (
    <Row
      title={row.title}
      line={row.line}
      chip={row.chip === undefined ? undefined : <Pill tone={row.chip.tone}>{row.chip.label}</Pill>}
    />
  );
}

/**
 * The views a working week does not reach for, behind one disclosure.
 *
 * Pedigree, papers, genetics and money are reached for when somebody is
 * selling or registering her; the description and handling details, the
 * weight figures (gain, 205-day) and the calving interval sit here too, since
 * History carries the records themselves. Nothing went: every view the old
 * tab strip had is still here, one tap after the disclosure.
 */
const DEEPER = [
  { id: "pedigree", label: "Pedigree" },
  { id: "papers", label: "Papers" },
  { id: "genetics", label: "Genetics" },
  { id: "finance", label: "Money" },
  { id: "details", label: "Details" },
  { id: "weights", label: "Weights" },
  { id: "breeding", label: "Breeding" },
  { id: "photos", label: "Photos" },
] as const;

type DeeperView = (typeof DEEPER)[number]["id"];

function Deeper({
  animal,
  profile,
  profiles,
  outsiders,
  zone,
  breeding,
  propertyId,
  actorId,
}: {
  readonly animal: Animal;
  readonly profile: CattleProfile | undefined;
  /** Everything on file, so the parents can settle what this animal is. */
  readonly profiles: readonly CattleProfile[];
  readonly outsiders: readonly ExternalAnimal[];
  readonly zone: Zone | undefined;
  readonly breeding: ResolvedComposition;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<DeeperView>("pedigree");
  const panelId = useId();

  function render(active: DeeperView): ReactNode {
    if (active === "pedigree") {
      return (
        <Pedigree animal={animal} profile={profile} propertyId={propertyId} actorId={actorId} />
      );
    }
    if (active === "papers") {
      return (
        <div className="flex flex-col gap-density">
          <Registrations
            animal={animal}
            profile={profile}
            propertyId={propertyId}
            actorId={actorId}
          />
          {/* The papers and what it is are the same conversation (#15). */}
          <BreedField
            animal={animal}
            profile={profile}
            profiles={profiles}
            propertyId={propertyId}
            actorId={actorId}
          />
          <BreedComposition
            animal={animal}
            profile={profile}
            propertyId={propertyId}
            actorId={actorId}
          />
        </div>
      );
    }
    if (active === "genetics") {
      return (
        <GeneticsPanel
          profile={profile}
          animalId={animal.id}
          profiles={profiles}
          outsiders={outsiders}
          propertyId={propertyId}
          actorId={actorId}
        />
      );
    }
    if (active === "finance") return <FinanceTab animal={animal} propertyId={propertyId} />;
    if (active === "details") {
      return (
        <Overview
          animal={animal}
          profile={profile}
          zone={zone}
          breeding={breeding}
          propertyId={propertyId}
          actorId={actorId}
        />
      );
    }
    if (active === "weights") return <WeightsTab animal={animal} propertyId={propertyId} />;
    if (active === "breeding") return <BreedingTab animal={animal} propertyId={propertyId} />;
    return (
      <PhotoPanel
        propertyId={propertyId}
        actorId={actorId}
        ownerEntity="Animal"
        ownerId={animal.id}
        recordName={animalTitle(animal)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-density">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((was) => !was)}
        className="flex min-h-target w-full items-center justify-between gap-3 rounded-density border border-rule bg-panel px-4 py-3 text-left font-semibold text-ink hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
      >
        Pedigree, papers, genetics, money
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
          className={`shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`}
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
      {open ? (
        <div id={panelId} className="flex flex-col gap-density">
          <ChipRow label="More about this animal">
            {DEEPER.map((entry) => (
              <Chip key={entry.id} on={view === entry.id} onClick={() => setView(entry.id)}>
                {entry.label}
              </Chip>
            ))}
          </ChipRow>
          {render(view)}
        </div>
      ) : null}
    </div>
  );
}

/**
 * What anyone needs before they open her gate, then what she looks like.
 *
 * Handling leads because it is the part of this page that keeps people safe.
 * Name, tag and sex are not repeated here — the header already says them —
 * and an empty field is left out rather than drawn as a dash, so what is on
 * screen is only what somebody has actually said.
 */
function Overview({
  animal,
  profile,
  zone,
  breeding,
  propertyId,
  actorId,
}: {
  readonly animal: Animal;
  readonly profile: CattleProfile | undefined;
  readonly zone: Zone | undefined;
  readonly breeding: ResolvedComposition;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const [editing, setEditing] = useState(false);

  const handling = [
    { label: "Why", value: animal.safetyNotes },
    { label: "Care instructions", value: animal.customInstructions },
    { label: "Pen instructions", value: zone?.customInstructions },
  ].filter((item) => item.value !== undefined && item.value !== "");

  const details = [
    {
      label: "Date of birth",
      value:
        animal.dob === undefined
          ? undefined
          : `${animal.dob.toLocaleDateString()}${animal.dobIsEstimate ? " (estimated)" : ""}`,
    },
    { label: "Status", value: animal.status },
    { label: "Ownership", value: animal.ownership === "own" ? "Ours" : "Client" },
    {
      label: "Breed",
      value:
        breeding.composition.length === 0 ? undefined : (
          <span className="flex flex-col gap-0.5">
            <span>{describeComposition(breeding.composition)}</span>
            {/* Said out loud, because "79.57% Maine, off the AMAA papers" and
                "roughly three-quarters Maine, worked out from her parents"
                are different claims, and the first is the one a buyer checks. */}
            <span className="text-sm text-muted">{describeCompositionSource(breeding)}</span>
          </span>
        ),
    },
    { label: "Papers", value: profile !== undefined && isPapered(profile) ? "Papered" : "None" },
    { label: "Horns", value: profile?.hornStatus },
    { label: "Color", value: profile?.colour },
    { label: "Markings", value: profile?.markings, wide: true },
    { label: "Notes", value: animal.notes, wide: true },
  ].filter((item) => item.value !== undefined && item.value !== "");

  return (
    <div className="flex flex-col gap-density">
      <Section title="Handling">
        <div className="flex flex-col gap-3">
          <SafetyBadge level={animal.safetyLevel} />
          {handling.length === 0 ? null : <DetailList columns={1} items={handling} />}
        </div>
      </Section>

      <Section
        title="Details"
        actions={
          <Button variant="ghost" aria-haspopup="dialog" onClick={() => setEditing(true)}>
            Edit description
          </Button>
        }
      >
        <DetailList items={details} />
      </Section>

      {editing ? (
        <Description
          // Keyed on the profile so the form remounts when one arrives. Its
          // fields seed from `profile` at mount, and the profile is read from
          // the local store a tick after the animal is — without this the
          // description would seed from nothing and then quietly save a
          // blank over what was there.
          key={profile?.id ?? "new"}
          animal={animal}
          profile={profile}
          propertyId={propertyId}
          actorId={actorId}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * The papers (spec §5.2, issue #15).
 *
 * An animal can be registered in several associations at once, which is
 * ordinary for show cattle, so this is a list rather than a pair of fields.
 * Adding one creates the profile record if there is not one yet — nobody
 * should have to know that a sidecar exists.
 *
 * Registrations are editable in place rather than remove-and-re-add. A
 * transposed digit in a registration number is the single likeliest mistake
 * on this screen, and making the fix go through a delete confirmation that
 * warns about phone calls to the association trains people to click past the
 * warning that matters (§4.5 clause 3). The form is a side panel, so opening
 * it never pushes the list down the page.
 */
function Registrations({
  animal,
  profile,
  propertyId,
  actorId,
}: {
  readonly animal: Animal;
  readonly profile: CattleProfile | undefined;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const profiles = useMutations<CattleProfile>(
    "cattleProfiles",
    "cattleProfiles",
    cattleProfileSchema,
    propertyId,
    actorId,
  );
  const { show } = useToast();
  const confirmDelete = useConfirmDelete();

  /** Whether the panel is open. */
  const [open, setOpen] = useState(false);
  const [association, setAssociation] = useState<Association>("Maine-Anjou");
  const [regNumber, setRegNumber] = useState("");
  const [registeredName, setRegisteredName] = useState("");
  const [tattoo, setTattoo] = useState("");
  /** The registration being edited, keyed as it is stored. Absent while adding. */
  const [editingKey, setEditingKey] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const registrations = profile?.registrations ?? [];
  const keyOf = (entry: Registration) => `${entry.association}:${entry.regNumber}`;

  function reset() {
    setOpen(false);
    setEditingKey(undefined);
    setAssociation("Maine-Anjou");
    setRegNumber("");
    setRegisteredName("");
    setTattoo("");
    setError(undefined);
  }

  function startAdd() {
    reset();
    setOpen(true);
  }

  function startEdit(entry: Registration) {
    setEditingKey(keyOf(entry));
    setAssociation(entry.association);
    setRegNumber(entry.regNumber);
    setRegisteredName(entry.registeredName ?? "");
    setTattoo(entry.tattoo ?? "");
    setError(undefined);
    setOpen(true);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);

    if (regNumber.trim() === "") {
      setError("A registration needs its number");
      return;
    }

    // One set of papers per association. On an edit, the row being edited is
    // not its own duplicate.
    const clash = registrations.find(
      (existing) => existing.association === association && keyOf(existing) !== editingKey,
    );
    if (clash !== undefined) {
      setError(`Already registered with ${association}. Remove that one first.`);
      return;
    }

    const entry: Registration = {
      association,
      regNumber: regNumber.trim(),
      ...(registeredName.trim() === "" ? {} : { registeredName: registeredName.trim() }),
      ...(tattoo.trim() === "" ? {} : { tattoo: tattoo.trim() }),
    };

    setBusy(true);
    try {
      const next =
        editingKey === undefined
          ? [...registrations, entry]
          : // The EPD snapshot is not on this form, so it is carried across
            // rather than dropped: an EPD is what was true on the day it was
            // quoted, and losing it to a typo fix loses the day too.
            registrations.map((existing) =>
              keyOf(existing) === editingKey ? { ...existing, ...entry } : existing,
            );

      const result =
        profile === undefined
          ? await profiles.create({
              animalId: animal.id,
              breedComposition: [],
              registrations: next,
            } as never)
          : await profiles.update(profile.id, {
              registrations: next,
            } as Partial<CattleProfile>);

      if (!result.ok) {
        setError(
          result.error.kind === "validation"
            ? (result.error.issues[0]?.message ?? "That is not valid")
            : "Could not save that",
        );
        return;
      }

      show({
        message:
          editingKey === undefined
            ? `${association} registration added`
            : `${association} registration updated`,
        tone: "success",
      });
      reset();
    } finally {
      setBusy(false);
    }
  }

  /**
   * Dropping a set of papers (§4.5 clause 3).
   *
   * Confirmed, and worded so the consequence is the one that actually
   * matters: the record here goes, the certificate in the folder does not,
   * and getting a registration reinstated with an association is a phone call
   * rather than an undo.
   */
  async function remove(entry: Registration) {
    if (profile === undefined) return;

    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: `${entry.association} ${entry.regNumber}`,
      entity: "registration",
      dependents: [],
      action: "Remove",
      consequence: `${animal.name ?? "This animal"} will no longer show as registered with ${entry.association}. The paper certificate is unaffected.`,
    });
    if (!confirmed) return;

    await profiles.update(profile.id, {
      registrations: registrations.filter((existing) => keyOf(existing) !== keyOf(entry)),
    } as Partial<CattleProfile>);
    show({ message: "Registration removed", tone: "danger" });
  }

  const editing = registrations.find((entry) => keyOf(entry) === editingKey);
  const formId = useId();

  return (
    <Section
      title="Registrations"
      // §12 decision 1: the associations expose nothing programmatically, so
      // these are typed in by hand — which is why editing them is cheap.
      description={registrations.length === 0 ? undefined : `${registrations.length} on file`}
      actions={
        <Button aria-haspopup="dialog" onClick={startAdd}>
          <span aria-hidden="true">+</span> Add registration
        </Button>
      }
    >
      {registrations.length === 0 ? (
        <p className="text-sm text-muted">No papers recorded.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-rule overflow-hidden rounded-density border border-rule bg-panel">
          {registrations.map((entry) => (
            <li key={keyOf(entry)} className="flex items-center gap-2 py-2 pl-4 pr-1">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-semibold text-ink">
                  {entry.association} <span className="gf-numeric">{entry.regNumber}</span>
                </span>
                {entry.registeredName === undefined && entry.tattoo === undefined ? null : (
                  <span className="truncate text-sm text-muted">
                    {[
                      entry.registeredName,
                      entry.tattoo === undefined ? undefined : `Tattoo ${entry.tattoo}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
              </span>
              <Button
                variant="ghost"
                aria-haspopup="dialog"
                aria-label={`Edit ${entry.association} ${entry.regNumber}`}
                onClick={() => startEdit(entry)}
              >
                Edit
              </Button>
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <Modal
          placement="side"
          title={editingKey === undefined ? "Add a registration" : "Edit this registration"}
          onClose={reset}
          footer={
            <>
              <Button variant="primary" type="submit" form={formId} busy={busy}>
                {editingKey === undefined ? "Add registration" : "Save registration"}
              </Button>
              <Button onClick={reset}>Cancel</Button>
              {editing === undefined ? null : (
                // The panel closes first, so the confirmation is the only
                // dialog on screen rather than a second one stacked on this.
                <Button
                  variant="danger"
                  className="ml-auto"
                  onClick={() => {
                    reset();
                    void remove(editing);
                  }}
                >
                  Remove
                </Button>
              )}
            </>
          }
        >
          <form
            id={formId}
            onSubmit={(event) => void submit(event)}
            className="flex flex-col gap-density"
          >
            <Select
              label="Association"
              value={association}
              onChange={(event) => setAssociation(event.target.value as Association)}
              options={ASSOCIATIONS.map((value) => ({ value, label: value }))}
            />
            <TextInput
              label="Registration number"
              numeric
              value={regNumber}
              onChange={(event) => setRegNumber(event.target.value)}
              {...(error === undefined ? {} : { error })}
              required
            />
            <TextInput
              label="Registered name"
              hint="Only if it differs from the barn name."
              value={registeredName}
              onChange={(event) => setRegisteredName(event.target.value)}
            />
            <TextInput
              label="Tattoo"
              value={tattoo}
              onChange={(event) => setTattoo(event.target.value)}
            />
          </form>
        </Modal>
      ) : null}
    </Section>
  );
}

/**
 * Horn status, colour and markings (§5.2).
 *
 * These are how you tell one black baldy from the next black baldy in a pen of
 * eleven, which is why they are here rather than in a notes field. Horn status
 * is the one with consequences — a horned animal is a different proposition in
 * a trailer and at a show — so it is a field, not a sentence in the markings.
 */
function Description({
  animal,
  profile,
  propertyId,
  actorId,
  onClose,
}: {
  readonly animal: Animal;
  readonly profile: CattleProfile | undefined;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly onClose: () => void;
}) {
  const profiles = useMutations<CattleProfile>(
    "cattleProfiles",
    "cattleProfiles",
    cattleProfileSchema,
    propertyId,
    actorId,
  );
  const { show } = useToast();

  const [hornStatus, setHornStatus] = useState(profile?.hornStatus ?? "");
  const [colour, setColour] = useState(profile?.colour ?? "");
  const [markings, setMarkings] = useState(profile?.markings ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // The save button sits in the panel's footer, outside the form, and names
  // the form so Enter in a field and the button are the same submit.
  const formId = useId();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setBusy(true);

    // Blank clears the field rather than storing an empty string: "" and
    // "nobody has said" read identically on the page but sort and filter
    // differently everywhere else.
    const patch = {
      hornStatus: hornStatus === "" ? undefined : (hornStatus as HornStatus),
      colour: colour.trim() === "" ? undefined : colour.trim(),
      markings: markings.trim() === "" ? undefined : markings.trim(),
    };

    try {
      const result =
        profile === undefined
          ? await profiles.create({
              animalId: animal.id,
              breedComposition: [],
              registrations: [],
              ...patch,
            } as never)
          : await profiles.update(profile.id, patch as Partial<CattleProfile>);

      if (!result.ok) {
        setError(
          result.error.kind === "validation"
            ? (result.error.issues[0]?.message ?? "That is not valid")
            : "Could not save that",
        );
        return;
      }
      show({ message: "Description saved", tone: "success" });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      placement="side"
      title="Description"
      onClose={onClose}
      footer={
        <>
          <Button variant="primary" type="submit" form={formId} busy={busy}>
            Save description
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-density"
      >
        <Select
          label="Horn status"
          value={hornStatus}
          placeholder="Not recorded"
          onChange={(event) => setHornStatus(event.target.value as HornStatus | "")}
          options={HORN_STATUSES.map((value) => ({ value, label: value }))}
        />
        <TextInput
          label="Color"
          hint="Black, red, roan, black baldy."
          value={colour}
          onChange={(event) => setColour(event.target.value)}
        />
        <TextArea
          label="Markings"
          rows={3}
          hint="White face, four socks, the scar over the left hip."
          value={markings}
          onChange={(event) => setMarkings(event.target.value)}
        />

        {error === undefined ? null : (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
