"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  Badge,
  Button,
  Callout,
  Card,
  DetailList,
  EmptyState,
  Select,
  TextInput,
  PageBody,
  PageHeader,
  SafetyBadge,
  Section,
  TextArea,
  Stat,
  StatRow,
  Tabs,
  useConfirmDelete,
  useToast,
} from "@galaxy-farm/ui";
import {
  ageInMonths,
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
  cattleProfileSchema,
  describeComposition,
  describeCompositionSource,
  HORN_STATUSES,
  isPapered,
  type Association,
  type CattleProfile,
  type ExternalAnimal,
  type ResolvedComposition,
  type HealthRecord,
  type HornStatus,
  type Registration,
} from "@galaxy-farm/module-cattle";

import {
  BreedComposition,
  BreedField,
  BreedingTab,
  FinanceTab,
  HealthTab,
  Pedigree,
  WeightsTab,
} from "@/app/(admin)/admin/cattle/[id]/_components/animal-tabs";
import { GeneticsPanel } from "@/app/(admin)/admin/cattle/[id]/_components/genetics-panel";
import { animalSlug, animalTitle, resolveAnimalSlug } from "@/lib/animal-slug";
import { compositionLookup, compositionOfAnimal } from "@/lib/composition";
import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

/**
 * One animal, everything about her (spec §7, §5.2).
 *
 * §7 lists the tabs: overview · pedigree · breeding · health · weights ·
 * feeding · finance · photos. Overview and pedigree are real here; the rest
 * name what they will hold rather than pretending to be finished, because a
 * tab that renders an empty card teaches nobody whether it is empty or broken.
 *
 * The URL is a slug, not an id — see `lib/animal-slug.ts`. The record is found
 * by walking the herd on the device rather than by a keyed lookup, which is
 * cheap at this size and is what lets an old link keep resolving after a cow
 * is renamed or finally tagged.
 */

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
          detail="Nothing on this device answers to that tag, registration, or name. It may have been deleted, or the link may predate a rename."
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
  const months = ageInMonths(animal, new Date());

  // #15: a withdrawal must be unmissable here. Selling or slaughtering an
  // animal inside one is a residue violation, and the person about to do it is
  // usually looking at this page — so it gets a banner above the tabs rather
  // than a badge in a row of badges that already has six.
  const withdrawal = animalsUnderWithdrawal(health, new Date()).find(
    (entry) => entry.animalId === animal.id,
  );

  // The URL the record answers to now. Somebody who arrived by an old link
  // gets moved to the current one rather than being left on a stale address
  // that will stop working the next time something changes.
  const canonical = animalSlug(animal, registrationOf(animal));
  if (found.stale && canonical !== slug) {
    router.replace(`/admin/cattle/${canonical}`);
  }

  return (
    <PageBody>
      <PageHeader
        eyebrow={
          <span>
            <Link href="/admin/cattle" className="hover:text-ink">
              Cattle
            </Link>{" "}
            · Herd
          </span>
        }
        title={animalTitle(animal)}
        actions={
          // Two taps from her profile, which is what issue #13 asks for: this
          // link, then Record. The dam arrives prefilled, so nothing about the
          // cow has to be chosen again by somebody standing in a pen with her.
          animal.sex === "female" && animal.status === "active" ? (
            <Link
              href={`/admin/cattle/calving?dam=${animal.id}`}
              className="rounded-density border border-edge px-density py-2 text-sm font-medium text-ink hover:border-action"
            >
              Record a calving
            </Link>
          ) : undefined
        }
        subtitle={
          breeding.composition.length === 0
            ? undefined
            : `${describeComposition(breeding.composition)}${breeding.source === "parents" ? " (from its parents)" : ""}`
        }
        meta={
          <>
            <SafetyBadge level={animal.safetyLevel} />
            <Badge tone="neutral">{animal.status}</Badge>
            {animal.ownership === "client" ? <Badge tone="identity">Client calf</Badge> : null}
            {profile !== undefined && isPapered(profile) ? (
              <Badge tone="calm">Papered</Badge>
            ) : (
              <Badge tone="neutral">Unpapered</Badge>
            )}
            {standing.map((entry) =>
              entry.zone === undefined ? null : (
                <Badge key={entry.assignment.id} tone="action">
                  {entry.zone.name}
                </Badge>
              ),
            )}
          </>
        }
      />

      {withdrawal === undefined ? null : (
        <Callout
          tone="danger"
          title={`Under withdrawal for ${withdrawal.daysRemaining} more day${withdrawal.daysRemaining === 1 ? "" : "s"}`}
        >
          {withdrawal.product === undefined
            ? "Not clear for sale or slaughter until "
            : `${withdrawal.product}. Not clear for sale or slaughter until `}
          {withdrawal.clearsOn.toLocaleDateString(undefined, {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
          .
        </Callout>
      )}

      <StatRow>
        <Stat label="Tag" value={animal.tagNumber ?? "—"} />
        <Stat
          label="Age"
          value={months === undefined ? "—" : `${Math.floor(months / 12)}y ${months % 12}m`}
          hint={animal.dobIsEstimate ? "Date of birth is an estimate" : undefined}
        />
        <Stat label="Sex" value={animal.sex} />
        <Stat
          label="Where"
          value={outside?.zone?.name ?? inside?.zone?.name ?? "Unassigned"}
          {...(outside !== undefined && inside !== undefined
            ? { hint: `and ${inside.zone?.name ?? "inside"}` }
            : {})}
        />
      </StatRow>

      <AnimalTabs
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

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "registrations", label: "Registrations" },
  { id: "genetics", label: "Genetics" },
  { id: "pedigree", label: "Pedigree" },
  { id: "breeding", label: "Breeding" },
  { id: "health", label: "Health" },
  { id: "weights", label: "Weights" },
  { id: "feeding", label: "Feeding" },
  { id: "finance", label: "Finance" },
  { id: "photos", label: "Photos" },
] as const;

/**
 * §7's profile tabs: overview · pedigree · breeding · health · weights ·
 * feeding · finance · photos, plus registrations, which §5.2 asks for and
 * which is the first thing anybody wants off a papered animal.
 *
 * The unbuilt ones say so rather than rendering an empty card — somebody
 * looking at a blank panel cannot tell whether this cow has no health records
 * or whether the screen broke.
 */
function AnimalTabs({
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
  return (
    <Tabs label="Animal profile" tabs={[...TABS]}>
      {(active) => {
        if (active === "overview")
          return <Overview animal={animal} profile={profile} zone={zone} breeding={breeding} />;
        if (active === "registrations") {
          return (
            <>
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
            </>
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
        if (active === "pedigree") {
          return (
            <Pedigree animal={animal} profile={profile} propertyId={propertyId} actorId={actorId} />
          );
        }
        if (active === "breeding") return <BreedingTab animal={animal} propertyId={propertyId} />;
        if (active === "health") return <HealthTab animal={animal} propertyId={propertyId} />;
        if (active === "weights") return <WeightsTab animal={animal} propertyId={propertyId} />;
        if (active === "finance") return <FinanceTab animal={animal} propertyId={propertyId} />;

        const tab = TABS.find((entry) => entry.id === active);
        return <Pending what={tab?.label ?? "This"} />;
      }}
    </Tabs>
  );
}

function Overview({
  animal,
  profile,
  zone,
  breeding,
}: {
  readonly animal: Animal;
  readonly profile: CattleProfile | undefined;
  readonly zone: Zone | undefined;
  readonly breeding: ResolvedComposition;
}) {
  return (
    <div className="flex flex-col gap-density pt-density">
      <Section title="Identity">
        <DetailList
          items={[
            { label: "Name", value: animal.name },
            { label: "Tag number", value: animal.tagNumber },
            { label: "Sex", value: animal.sex },
            {
              label: "Date of birth",
              value:
                animal.dob === undefined
                  ? undefined
                  : `${animal.dob.toLocaleDateString()}${animal.dobIsEstimate ? " (estimated)" : ""}`,
            },
            { label: "Status", value: animal.status },
            { label: "Ownership", value: animal.ownership === "own" ? "Ours" : "Client" },
          ]}
        />
      </Section>

      <Section title="Description">
        <DetailList
          items={[
            {
              label: "Breed composition",
              value:
                breeding.composition.length === 0
                  ? undefined
                  : describeComposition(breeding.composition),
            },
            {
              // Said out loud, because "79.57% Maine, off the AMAA papers" and
              // "roughly three-quarters Maine, worked out from her parents"
              // are different claims, and the first is the one a buyer checks.
              label: "Where that comes from",
              value: describeCompositionSource(breeding),
              wide: true,
            },
            { label: "Horns", value: profile?.hornStatus },
            { label: "Color", value: profile?.colour },
            { label: "Markings", value: profile?.markings, wide: true },
          ]}
        />
      </Section>

      <Section
        title="Handling"
        description="What anyone working around this animal needs to know before they open a gate."
      >
        <DetailList
          columns={1}
          items={[
            {
              label: "Safety level",
              value: <SafetyBadge level={animal.safetyLevel} />,
            },
            { label: "Why", value: animal.safetyNotes, wide: true },
            { label: "Care instructions", value: animal.customInstructions, wide: true },
            { label: "Pen instructions", value: zone?.customInstructions, wide: true },
            { label: "Notes", value: animal.notes, wide: true },
          ]}
        />
      </Section>
    </div>
  );
}

/**
 * The papers, and what she looks like (spec §5.2, issue #15).
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
 * warning that matters (§4.5 clause 3).
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

  const [association, setAssociation] = useState<Association>("AMAA");
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
    setEditingKey(undefined);
    setAssociation("AMAA");
    setRegNumber("");
    setRegisteredName("");
    setTattoo("");
    setError(undefined);
  }

  function startEdit(entry: Registration) {
    setEditingKey(keyOf(entry));
    setAssociation(entry.association);
    setRegNumber(entry.regNumber);
    setRegisteredName(entry.registeredName ?? "");
    setTattoo(entry.tattoo ?? "");
    setError(undefined);
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

    if (keyOf(entry) === editingKey) reset();
    await profiles.update(profile.id, {
      registrations: registrations.filter((existing) => keyOf(existing) !== keyOf(entry)),
    } as Partial<CattleProfile>);
    show({ message: "Registration removed", tone: "danger" });
  }

  return (
    <div className="flex flex-col gap-density pt-density">
      <Section
        title="Registrations"
        description="§12 decision 1: the associations expose nothing programmatically, so these are entered by hand."
      >
        {registrations.length === 0 ? (
          <EmptyState
            title="No papers recorded"
            detail="Add an association and number below. An animal can be registered in more than one."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {registrations.map((entry) => (
              <Card key={keyOf(entry)}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <DetailList
                    columns={3}
                    items={[
                      { label: "Association", value: entry.association },
                      { label: "Number", value: entry.regNumber },
                      { label: "Registered name", value: entry.registeredName },
                      { label: "Tattoo", value: entry.tattoo },
                    ]}
                  />
                  <span className="flex gap-2">
                    <Button variant="ghost" onClick={() => startEdit(entry)}>
                      Edit
                    </Button>
                    <Button variant="ghost" onClick={() => void remove(entry)}>
                      Remove
                    </Button>
                  </span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Section title={editingKey === undefined ? "Add a registration" : "Edit this registration"}>
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-density">
          <div className="grid grid-cols-1 gap-density sm:grid-cols-2">
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
              hint="As it reads on the certificate, if that differs from the barn name."
              value={registeredName}
              onChange={(event) => setRegisteredName(event.target.value)}
            />
            <TextInput
              label="Tattoo"
              value={tattoo}
              onChange={(event) => setTattoo(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" busy={busy}>
              {editingKey === undefined ? "Add registration" : "Save registration"}
            </Button>
            {editingKey === undefined ? null : (
              <Button variant="ghost" onClick={reset}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </Section>

      {/*
        Keyed on the profile so the form remounts when one arrives. Its fields
        seed from `profile` at mount, and the profile is read from the local
        store a tick after the animal is — without this the description would
        seed from nothing and then quietly save a blank over what was there.
      */}
      <Description
        key={profile?.id ?? "new"}
        animal={animal}
        profile={profile}
        propertyId={propertyId}
        actorId={actorId}
      />
    </div>
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

  const [hornStatus, setHornStatus] = useState(profile?.hornStatus ?? "");
  const [colour, setColour] = useState(profile?.colour ?? "");
  const [markings, setMarkings] = useState(profile?.markings ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

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
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Description"
      description="How you pick this one out of a pen of eleven that look the same."
    >
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-density">
        <div className="grid grid-cols-1 gap-density sm:grid-cols-2">
          <Select
            label="Horn status"
            value={hornStatus}
            placeholder="Not recorded"
            onChange={(event) => setHornStatus(event.target.value as HornStatus | "")}
            options={HORN_STATUSES.map((value) => ({ value, label: value }))}
          />
          <TextInput
            label="Color"
            hint="Black, red, roan, black baldy — whatever you would say on the phone."
            value={colour}
            onChange={(event) => setColour(event.target.value)}
          />
        </div>
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

        <div>
          <Button type="submit" busy={busy}>
            Save description
          </Button>
        </div>
      </form>
    </Section>
  );
}

/**
 * A tab that is not built yet, saying so.
 *
 * Better than an empty card: somebody looking at a blank panel cannot tell
 * whether this animal has no health records or whether the screen failed.
 */
function Pending({ what }: { readonly what: string }) {
  return (
    <div className="pt-density">
      <EmptyState
        title={`${what} is not built yet`}
        detail={`The records behind ${what.toLowerCase()} exist in the cattle module and are tested; this tab is where they will be shown.`}
      />
    </div>
  );
}
