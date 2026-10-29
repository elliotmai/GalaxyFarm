"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";

import {
  Button,
  DetailList,
  EmptyState,
  PageBody,
  Pill,
  SafetyBadge,
  Section,
  optionLabel,
} from "@galaxy-farm/ui";
import {
  displayName,
  formatMoney,
  isOnFarm,
  primaryPhone,
  type Animal,
  type Contact,
  type FeedingPlan,
  type Ulid,
} from "@galaxy-farm/core";
import type { HealthRecord, HealthRecordType } from "@galaxy-farm/module-cattle";
import type { FeedType } from "@galaxy-farm/module-feed";
import { isPet, outstandingPetCare, petBriefing, petsOnFarm } from "@galaxy-farm/module-pets";

import {
  ActionButton,
  ActionGrid,
  ActionLink,
  AnimalHeader,
  ComingUpSection,
  HistorySection,
  MoreDisclosure,
  PhotoAction,
  noteRows,
  undatedNotes,
  type TimelineRow,
} from "@/app/(admin)/_components/animal-page";
import { formatDate } from "@/app/(admin)/admin/cattle/[id]/_components/animal-history";
import { facts } from "@/app/(admin)/admin/cattle/[id]/_components/record-rows";
import { logHref } from "@/app/(admin)/admin/log/_components/log-kinds";
import { RationEditor, RationRows } from "@/app/(admin)/admin/pets/_components/pet-feeding-panel";
import {
  EditVisit,
  PET_HEALTH_LABELS,
  RecordVisit,
} from "@/app/(admin)/admin/pets/_components/pet-health-panel";
import {
  PetEditor,
  petAgeLabel,
  petSpeciesLabel,
} from "@/app/(admin)/admin/pets/_components/pet-panel";
import { PhotoPanel } from "@/app/_components/photo-panel";
import { PET_SECTION_SEGMENTS, petHref, petSlug, resolveAnimalSlug } from "@/lib/animal-slug";
import { careRecordsFor, currentMedicinesFor, feedingLinesFor, plansFeeding } from "@/lib/pet-care";
import { useRecords } from "@/lib/local/use-records";

/**
 * One dog or one cat (spec §7, §5.8; V2 Animal).
 *
 * The cow's page, with the household's priorities. Straight under the name is
 * what a sitter — or the other owner, standing at the back door — checks on
 * the spot: whether he bites, what he eats, what he is on, and anything else
 * the guide says. It is `petBriefing`, the function the housesitter guide
 * itself calls, so what is read here is word for word what a helper will read.
 *
 * Then the buttons. A shot, a medicine, a worming and a vet visit open the
 * pets screen's own visit form in a side panel, already on this pet; the
 * ration opens the feeding form; Note goes to the ＋ Log, which writes notes for
 * every animal; Photo is the camera. None of them is a new write path — the
 * Log's treatment form is cattle-shaped (withdrawal, the medicine fridge), so
 * a dog's shot stays on the form that asks for its next-due date instead.
 *
 * Then Coming up (care the vet said would come round), one History newest
 * first, the photos, and the rest — rations in full, the vet, the details —
 * behind one disclosure.
 */

/**
 * How far ahead "Coming up" looks on a pet's own page.
 *
 * The pets list nags a fortnight out; on the pet's page the question is
 * "when is his next rabies shot", and a year answers it.
 */
const LOOK_AHEAD_DAYS = 365;

/** The page's own panels: at most one open at a time. */
type Panel =
  | { readonly kind: "visit"; readonly type: HealthRecordType }
  | { readonly kind: "edit-visit"; readonly entry: HealthRecord }
  | { readonly kind: "ration"; readonly plan: FeedingPlan | undefined }
  | { readonly kind: "pet" };

export function PetScreen({
  slug,
  propertyId,
  actorId,
}: {
  readonly slug: string;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const query = { propertyId };
  const { records: animals, loading } = useRecords<Animal>("animals", query);
  const { records: health } = useRecords<HealthRecord>("healthRecords", query);
  const { records: plans } = useRecords<FeedingPlan>("feedingPlans", query);
  const { records: feeds } = useRecords<FeedType>("feedTypes", query);
  const { records: contacts } = useRecords<Contact>("contacts", query);

  const [panel, setPanel] = useState<Panel | undefined>();
  const sitterId = useId();

  // One clock for the render, so the age, "on now" and "overdue" agree.
  const asOf = useMemo(() => new Date(), []);

  // Every dog and cat, gone ones too: an old link to a dog that has died
  // should still open his history rather than say there is no such pet.
  const pets = useMemo(() => animals.filter(isPet), [animals]);
  const found = useMemo(
    () => resolveAnimalSlug(slug, pets, () => undefined, PET_SECTION_SEGMENTS),
    [slug, pets],
  );

  // An old address moves to the current one, in an effect — navigating while
  // rendering updates the router mid-render, which React refuses.
  const canonical = found === undefined ? undefined : petSlug(found.animal);
  const moveTo = found?.stale === true && canonical !== slug ? found.animal : undefined;
  useEffect(() => {
    if (moveTo !== undefined) router.replace(petHref(moveTo));
  }, [moveTo, router]);

  if (loading) return <p className="text-muted">Looking…</p>;

  if (found === undefined) {
    return (
      <PageBody>
        <EmptyState
          title="No pet by that name"
          detail="Nothing on this device answers to that name or tag."
          action={
            <Link href="/admin/pets" className="text-action underline">
              Back to the pets
            </Link>
          }
        />
      </PageBody>
    );
  }

  const pet = found.animal;
  const name = displayName(pet);
  // Who may share a bowl with him: the household, and him even if he is gone.
  const household = petsOnFarm(animals);
  const bowlmates = household.some((held) => held.id === pet.id) ? household : [pet, ...household];

  const mine = health.filter((record) => record.animalId === pet.id);
  const rations = plansFeeding(pet.id, plans);
  const vet = contacts.find((contact) => contact.tags.includes("vet"));
  const vetPhone = vet === undefined ? undefined : primaryPhone(vet);
  const briefing = petBriefing({
    pet,
    feeding: feedingLinesFor(pet.id, plans, feeds, animals).map((text) => ({ text })),
    medicines: currentMedicinesFor(pet.id, health, asOf),
    ...(vet === undefined
      ? {}
      : { vetName: vet.name, ...(vetPhone === undefined ? {} : { vetPhone }) }),
  });

  const care = outstandingPetCare(careRecordsFor(mine), asOf, LOOK_AHEAD_DAYS);
  const overdue = care.some((need) => need.status === "overdue");

  // The same one chip the list row shows, with overdue care ahead of the
  // ration: an overdue shot is the one thing on this page a helper cannot fix.
  const chip = briefing.handleWithCare ? (
    <SafetyBadge level={pet.safetyLevel} size="compact" />
  ) : overdue ? (
    <Pill tone="danger">Care overdue</Pill>
  ) : briefing.feeding.length === 0 ? (
    <Pill tone="action">No ration</Pill>
  ) : briefing.medicines.length > 0 ? (
    <Pill tone="neutral">On medication</Pill>
  ) : undefined;

  // Where he is: a pet has no pen (§5.8), so the answer is whether he is home.
  const where = isOnFarm(pet) ? "At home" : optionLabel(pet.status);
  const line = facts(petSpeciesLabel(pet), optionLabel(pet.sex), petAgeLabel(pet, asOf), where);

  const contactName = (id: Ulid | undefined) =>
    id === undefined ? undefined : contacts.find((held) => held.id === id)?.name;

  const ahead: TimelineRow[] = care.map((need) => {
    const record = mine.find((entry) => entry.id === need.recordId);
    return {
      key: `care:${need.recordId}`,
      date: need.dueOn,
      title: need.label,
      line: `${need.status === "overdue" ? "was due" : "due"} ${formatDate(need.dueOn)}`,
      chip:
        need.status === "overdue"
          ? { tone: "danger", label: "Overdue" }
          : need.status === "due"
            ? { tone: "action", label: "Today" }
            : { tone: "action", label: `in ${need.daysUntil}d` },
      ...(record === undefined
        ? {}
        : {
            onSelect: () => setPanel({ kind: "edit-visit", entry: record }),
            selectLabel: `Edit ${need.label}`,
          }),
    };
  });

  const past: TimelineRow[] = [
    ...mine.map((record): TimelineRow => ({
      key: `health:${record.id}`,
      date: record.date,
      title: record.product ?? PET_HEALTH_LABELS[record.type],
      line: facts(
        formatDate(record.date),
        record.product === undefined ? undefined : PET_HEALTH_LABELS[record.type],
        contactName(record.vetContactId) ?? record.administeredBy,
        record.boosterDueOn === undefined ? undefined : `next ${formatDate(record.boosterDueOn)}`,
        record.cost === undefined ? undefined : formatMoney(record.cost),
      ),
      onSelect: () => setPanel({ kind: "edit-visit", entry: record }),
      selectLabel: `Edit ${PET_HEALTH_LABELS[record.type]}, ${formatDate(record.date)}`,
    })),
    // A ration has no date of its own beyond when it was written, which is
    // the day his food changed — worth a line in his history.
    ...rations.map((plan): TimelineRow => ({
      key: `ration:${plan.id}`,
      date: plan.createdAt,
      title: `Ration written: ${plan.name}`,
      line: facts(formatDate(plan.createdAt), plan.active ? undefined : "paused"),
      onSelect: () => setPanel({ kind: "ration", plan }),
      selectLabel: `Edit ${plan.name}`,
    })),
    ...noteRows(pet),
  ].sort((left, right) => right.date.getTime() - left.date.getTime());

  // The ration tile edits the one he has, or writes the first. With several,
  // it writes another — each is a row in the disclosure to open on its own.
  const onlyRation = rations.length === 1 ? rations[0] : undefined;

  return (
    <PageBody>
      <AnimalHeader
        // A pet seldom wears a tag, so the badge says what he is instead.
        badge={pet.tagNumber ?? petSpeciesLabel(pet)}
        title={name}
        chip={chip}
        facts={line}
      />

      {/*
        What a sitter needs, before anything else on the page. Bordered and
        never folded away: it is read standing up, often by somebody who has
        never been in the house before.
      */}
      <section
        aria-labelledby={sitterId}
        className="flex flex-col gap-3 rounded-density border border-rule bg-panel p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={sitterId} className="text-ink">
            What a sitter needs
          </h2>
          <SafetyBadge level={pet.safetyLevel} showLabel />
        </div>
        <dl className="flex flex-col gap-3 text-sm">
          {briefing.safetyNotes === undefined ? null : (
            <div>
              <dt className="font-medium text-ink">Handling</dt>
              <dd className={briefing.handleWithCare ? "text-danger" : "text-muted"}>
                {briefing.safetyNotes}
              </dd>
            </div>
          )}
          <div>
            <dt className="font-medium text-ink">Eats</dt>
            <dd className="text-muted">
              {briefing.feeding.length === 0 ? (
                <span className="text-action">
                  Nothing written down — the guide will say so too.
                </span>
              ) : (
                <ul className="flex flex-col gap-1">
                  {briefing.feeding.map((entry) => (
                    <li key={entry}>{entry}</li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">Medicine</dt>
            <dd className="text-muted">
              {briefing.medicines.length === 0 ? (
                "Nothing on now."
              ) : (
                <ul className="flex flex-col gap-1">
                  {briefing.medicines.map((entry) => (
                    <li key={entry}>{entry}</li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
          {briefing.instructions === undefined ? null : (
            <div>
              <dt className="font-medium text-ink">Instructions</dt>
              <dd className="whitespace-pre-line text-muted">{briefing.instructions}</dd>
            </div>
          )}
          {briefing.vet === undefined ? null : (
            <div>
              <dt className="font-medium text-ink">Vet</dt>
              <dd className="text-muted">{briefing.vet}</dd>
            </div>
          )}
        </dl>
      </section>

      <ActionGrid label="Record for this pet">
        <ActionButton icon="shot" onClick={() => setPanel({ kind: "visit", type: "vaccination" })}>
          Shot
        </ActionButton>
        <ActionButton
          icon="medicine"
          onClick={() => setPanel({ kind: "visit", type: "treatment" })}
        >
          Medicine
        </ActionButton>
        <ActionButton icon="worming" onClick={() => setPanel({ kind: "visit", type: "deworming" })}>
          Worming
        </ActionButton>
        <ActionButton icon="vet" onClick={() => setPanel({ kind: "visit", type: "exam" })}>
          Vet visit
        </ActionButton>
        <ActionButton icon="food" onClick={() => setPanel({ kind: "ration", plan: onlyRation })}>
          Ration
        </ActionButton>
        <ActionLink icon="note" href={logHref({ kind: "note", animals: [pet.id], from: pathname })}>
          Note
        </ActionLink>
        <PhotoAction animalId={pet.id} propertyId={propertyId} actorId={actorId} />
        <ActionButton icon="edit" onClick={() => setPanel({ kind: "pet" })}>
          Edit
        </ActionButton>
      </ActionGrid>

      <ComingUpSection rows={ahead} />

      <HistorySection rows={past} name={name} />

      <PhotoPanel
        propertyId={propertyId}
        actorId={actorId}
        ownerEntity="Animal"
        ownerId={pet.id}
        recordName={name}
      />

      <MoreDisclosure label="Rations, vet and details">
        <Section
          title="Rations"
          actions={
            <Button
              variant="ghost"
              aria-haspopup="dialog"
              onClick={() => setPanel({ kind: "ration", plan: undefined })}
            >
              <span aria-hidden="true">+</span> Ration
            </Button>
          }
        >
          {rations.length === 0 ? (
            <p className="text-sm text-action">Nothing written down.</p>
          ) : (
            <RationRows
              label={`${name}'s rations`}
              plans={rations}
              feeds={feeds}
              petName={(id) => {
                const held = animals.find((entry) => entry.id === id);
                return held === undefined ? "a pet" : displayName(held);
              }}
              onOpen={(plan) => setPanel({ kind: "ration", plan })}
            />
          )}
        </Section>

        <Section
          title="Details"
          actions={
            <Button
              variant="ghost"
              aria-haspopup="dialog"
              onClick={() => setPanel({ kind: "pet" })}
            >
              Edit
            </Button>
          }
        >
          <DetailList
            items={[
              {
                label: "Date of birth",
                value:
                  pet.dob === undefined
                    ? undefined
                    : `${pet.dob.toLocaleDateString()}${pet.dobIsEstimate ? " (a guess)" : ""}`,
              },
              { label: "Status", value: optionLabel(pet.status) },
              { label: "Tag", value: pet.tagNumber },
              {
                label: "Vet",
                value:
                  vet === undefined
                    ? undefined
                    : vetPhone === undefined
                      ? vet.name
                      : `${vet.name} — ${vetPhone}`,
              },
              // Undated text only: the dated lines are already in History.
              {
                label: "Notes",
                value: undatedNotes(pet),
                wide: true,
              },
            ].filter((item) => item.value !== undefined && item.value !== "")}
          />
        </Section>
      </MoreDisclosure>

      {panel?.kind === "visit" ? (
        <RecordVisit
          pets={[pet]}
          contacts={contacts}
          petId={pet.id}
          type={panel.type}
          propertyId={propertyId}
          actorId={actorId}
          onClose={() => setPanel(undefined)}
        />
      ) : null}
      {panel?.kind === "edit-visit" ? (
        <EditVisit
          key={panel.entry.id}
          entry={panel.entry}
          pets={[pet]}
          contacts={contacts}
          propertyId={propertyId}
          actorId={actorId}
          onClose={() => setPanel(undefined)}
        />
      ) : null}
      {panel?.kind === "ration" ? (
        <RationEditor
          key={panel.plan?.id ?? "new"}
          pets={bowlmates}
          feeds={feeds}
          plan={panel.plan}
          forPet={pet.id}
          propertyId={propertyId}
          actorId={actorId}
          onClose={() => setPanel(undefined)}
        />
      ) : null}
      {panel?.kind === "pet" ? (
        <PetEditor
          key={pet.id}
          pet={pet}
          health={health}
          plans={plans}
          propertyId={propertyId}
          actorId={actorId}
          onClose={() => setPanel(undefined)}
          // Gone from the household, so back to the list it was opened from.
          onDeleted={() => router.push("/admin/pets")}
        />
      ) : null}
    </PageBody>
  );
}
