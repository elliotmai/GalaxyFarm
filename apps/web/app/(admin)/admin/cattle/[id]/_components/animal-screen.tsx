"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  Badge,
  Button,
  Card,
  DetailList,
  EmptyState,
  Select,
  TextInput,
  PageBody,
  PageHeader,
  SafetyBadge,
  Section,
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
  ASSOCIATIONS,
  cattleProfileSchema,
  describeComposition,
  HORN_STATUSES,
  isPapered,
  registrationIn,
  type Association,
  type CattleProfile,
} from "@galaxy-farm/module-cattle";

import { animalSlug, animalTitle, resolveAnimalSlug } from "@/lib/animal-slug";
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
  const { records: zones } = useRecords<Zone>("zones", { propertyId });
  const { records: placements } = useRecords<ZoneAssignment>("zoneAssignments", { propertyId });

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
          profile === undefined || profile.breedComposition.length === 0
            ? undefined
            : describeComposition(profile.breedComposition)
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
        zone={zone}
        propertyId={propertyId}
        actorId={actorId}
      />
    </PageBody>
  );
}

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "registrations", label: "Registrations" },
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
  zone,
  propertyId,
  actorId,
}: {
  readonly animal: Animal;
  readonly profile: CattleProfile | undefined;
  readonly zone: Zone | undefined;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  return (
    <Tabs label="Animal profile" tabs={[...TABS]}>
      {(active) => {
        if (active === "overview")
          return <Overview animal={animal} profile={profile} zone={zone} />;
        if (active === "registrations") {
          return (
            <Registrations
              animal={animal}
              profile={profile}
              propertyId={propertyId}
              actorId={actorId}
            />
          );
        }
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
}: {
  readonly animal: Animal;
  readonly profile: CattleProfile | undefined;
  readonly zone: Zone | undefined;
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
                profile === undefined ? undefined : describeComposition(profile.breedComposition),
            },
            { label: "Horns", value: profile?.hornStatus },
            { label: "Colour", value: profile?.colour },
            { label: "Markings", value: profile?.markings, wide: true },
          ]}
        />
      </Section>

      <Section
        title="Handling"
        description="What anyone working around her needs to know before they open a gate."
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
 * The papers (spec §5.2).
 *
 * An animal can be registered in several associations at once, which is
 * ordinary for show cattle, so this is a list rather than a pair of fields.
 * Adding one creates the profile record if there is not one yet — nobody
 * should have to know that a sidecar exists.
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
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);

    if (regNumber.trim() === "") {
      setError("A registration needs its number");
      return;
    }
    if (profile !== undefined && registrationIn(profile, association) !== undefined) {
      setError(`Already registered with ${association}. Remove that one first.`);
      return;
    }

    const entry = {
      association,
      regNumber: regNumber.trim(),
      ...(registeredName.trim() === "" ? {} : { registeredName: registeredName.trim() }),
      ...(tattoo.trim() === "" ? {} : { tattoo: tattoo.trim() }),
    };

    setBusy(true);
    try {
      const result =
        profile === undefined
          ? await profiles.create({
              animalId: animal.id,
              breedComposition: [],
              registrations: [entry],
            })
          : await profiles.update(profile.id, {
              registrations: [...profile.registrations, entry],
            });

      if (!result.ok) {
        setError(
          result.error.kind === "validation"
            ? (result.error.issues[0]?.message ?? "That is not valid")
            : "Could not save that",
        );
        return;
      }

      setRegNumber("");
      setRegisteredName("");
      setTattoo("");
      show({ message: `${association} registration added` });
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
  async function remove(entry: { association: string; regNumber: string }) {
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
      registrations: profile.registrations.filter(
        (existing) => existing.regNumber !== entry.regNumber,
      ),
    });
    show({ message: "Registration removed" });
  }

  const registrations = profile?.registrations ?? [];

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
              <Card key={`${entry.association}:${entry.regNumber}`}>
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
                  <Button variant="ghost" onClick={() => void remove(entry)}>
                    Remove
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Section title="Add a registration">
        <form onSubmit={(event) => void add(event)} className="flex flex-col gap-density">
          <div className="grid grid-cols-1 gap-density sm:grid-cols-2">
            <Select
              label="Association"
              value={association}
              onChange={(event) => setAssociation(event.target.value as Association)}
              options={ASSOCIATIONS.map((value) => ({ value, label: value }))}
            />
            <TextInput
              label="Registration number"
              value={regNumber}
              onChange={(event) => setRegNumber(event.target.value)}
              {...(error === undefined ? {} : { error })}
              required
            />
            <TextInput
              label="Registered name"
              hint="As it reads on the certificate, if that differs from her barn name."
              value={registeredName}
              onChange={(event) => setRegisteredName(event.target.value)}
            />
            <TextInput
              label="Tattoo"
              value={tattoo}
              onChange={(event) => setTattoo(event.target.value)}
            />
          </div>
          <div>
            <Button type="submit" busy={busy}>
              Add registration
            </Button>
          </div>
        </form>
      </Section>

      <Section title="Description">
        <p className="max-w-prose text-sm text-muted">
          Horn status ({HORN_STATUSES.join(", ")}), colour, markings and breed composition are
          edited on the herd screen for now.
        </p>
      </Section>
    </div>
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
