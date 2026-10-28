"use client";

import { useId, useState } from "react";

import {
  Button,
  Checkbox,
  Divider,
  Modal,
  Select,
  TagInput,
  TextInput,
  useToast,
  optionLabel,
} from "@galaxy-farm/ui";
import {
  formatMoney,
  fromDollars,
  purchaseCandidateSchema,
  type AdditionalCost,
  type CandidateStatus,
  type Contact,
  type PurchaseCandidate,
  type RoadmapItem,
  type Ulid,
} from "@galaxy-farm/core";
import {
  CONDITIONS,
  EQUIPMENT_CATEGORIES,
  TITLE_STATUSES,
  type Condition,
  type EquipmentCategory,
  type TitleStatus,
} from "@galaxy-farm/module-equipment";

import { useMutations } from "@/lib/local/mutations";

import { detailOf } from "./candidate-format";

/**
 * Adding or editing a candidate, in a side panel (spec §5.1, §5.6).
 *
 * The longest form in Kit: the shared candidate half — price, seller, where,
 * the costs on top — and the equipment half that rides on it as
 * `domainDetail`. Split by hairlines rather than boxes, in the order a listing
 * is read: what and how much, then the machine, then what it costs on top,
 * then what you thought of it. It mounts fresh each time it opens, so its
 * state starts from the candidate being edited or from a blank one.
 */

interface Draft {
  readonly title: string;
  readonly roadmapItemId: string;
  readonly status: CandidateStatus;
  readonly asking: string;
  readonly listingUrl: string;
  readonly sellerId: string;
  readonly location: string;
  readonly distanceMiles: string;
  readonly listedDate: string;
  readonly expiresAt: string;
  readonly notes: string;
  readonly pros: readonly string[];
  readonly cons: readonly string[];
  readonly additionalCosts: readonly { label: string; amount: string }[];
  // The equipment half (§5.6).
  readonly category: EquipmentCategory;
  readonly make: string;
  readonly model: string;
  readonly year: string;
  readonly mileage: string;
  readonly engineHours: string;
  readonly vin: string;
  readonly condition: string;
  readonly titleStatus: string;
  readonly serviceHistoryAvailable: boolean;
  readonly warrantyRemaining: string;
  readonly knownFaults: string;
  readonly wearCondition: string;
}

const BLANK: Draft = {
  title: "",
  roadmapItemId: "",
  status: "watching",
  asking: "",
  listingUrl: "",
  sellerId: "",
  location: "",
  distanceMiles: "",
  listedDate: "",
  expiresAt: "",
  notes: "",
  pros: [],
  cons: [],
  // The three that turn up on nearly every purchase, offered rather than
  // typed. §5.1 wants them itemised; blank rows cost nothing and are dropped.
  additionalCosts: [
    { label: "Hauling", amount: "" },
    { label: "Inspection", amount: "" },
    { label: "Immediate repairs", amount: "" },
  ],
  category: "vehicle",
  make: "",
  model: "",
  year: "",
  mileage: "",
  engineHours: "",
  vin: "",
  condition: "",
  titleStatus: "",
  serviceHistoryAvailable: false,
  warrantyRemaining: "",
  knownFaults: "",
  wearCondition: "",
};

/** A candidate as the form holds it — strings, because inputs give strings. */
function draftFrom(candidate: PurchaseCandidate): Draft {
  const detail = detailOf(candidate);
  return {
    title: candidate.title,
    roadmapItemId: candidate.roadmapItemId ?? "",
    status: candidate.status,
    asking: (candidate.askingPrice.cents / 100).toFixed(2),
    listingUrl: candidate.listingUrl ?? "",
    sellerId: candidate.sellerId ?? "",
    location: candidate.location ?? "",
    distanceMiles: candidate.distanceMiles === undefined ? "" : String(candidate.distanceMiles),
    listedDate:
      candidate.listedDate === undefined ? "" : candidate.listedDate.toISOString().slice(0, 10),
    expiresAt:
      candidate.expiresAt === undefined ? "" : candidate.expiresAt.toISOString().slice(0, 10),
    notes: candidate.notes ?? "",
    pros: candidate.pros,
    cons: candidate.cons,
    additionalCosts:
      candidate.additionalCosts.length === 0
        ? BLANK.additionalCosts
        : candidate.additionalCosts.map((cost) => ({
            label: cost.label,
            amount: (cost.amount.cents / 100).toFixed(2),
          })),
    category: detail.category ?? "vehicle",
    make: detail.make ?? "",
    model: detail.model ?? "",
    year: detail.year === undefined ? "" : String(detail.year),
    mileage: detail.mileage === undefined ? "" : String(detail.mileage),
    engineHours: detail.engineHours === undefined ? "" : String(detail.engineHours),
    vin: detail.vin ?? "",
    condition: detail.condition ?? "",
    titleStatus: detail.titleStatus ?? "",
    serviceHistoryAvailable: detail.serviceHistoryAvailable ?? false,
    warrantyRemaining: detail.warrantyRemaining ?? "",
    knownFaults: detail.knownFaults ?? "",
    wearCondition: detail.wearCondition ?? "",
  };
}

export function CandidateForm({
  editing,
  defaultItemId,
  items,
  contacts,
  propertyId,
  actorId,
  onClose,
  onDelete,
}: {
  readonly editing?: PurchaseCandidate | undefined;
  /** The want a new candidate starts against — the one the list is filtered to. */
  readonly defaultItemId: string;
  readonly items: readonly RoadmapItem[];
  readonly contacts: readonly Contact[];
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly onClose: () => void;
  readonly onDelete?: (() => void) | undefined;
}) {
  const api = useMutations<PurchaseCandidate>(
    "purchaseCandidates",
    "purchaseCandidates",
    purchaseCandidateSchema,
    propertyId,
    actorId,
  );
  const { show } = useToast();
  const formId = useId();

  const [draft, setDraft] = useState<Draft>(() =>
    editing === undefined ? { ...BLANK, roadmapItemId: defaultItemId } : draftFrom(editing),
  );
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setBusy(true);

    try {
      const costs: AdditionalCost[] = draft.additionalCosts
        .filter(
          (cost) => cost.label.trim() !== "" && cost.amount !== "" && Number(cost.amount) !== 0,
        )
        .map((cost) => ({ label: cost.label.trim(), amount: fromDollars(Number(cost.amount)) }));

      const payload = {
        domain: "equipment" as const,
        title: draft.title.trim(),
        status: draft.status,
        roadmapItemId: draft.roadmapItemId === "" ? undefined : (draft.roadmapItemId as Ulid),
        askingPrice: fromDollars(Number(draft.asking || "0")),
        additionalCosts: costs,
        listingUrl: draft.listingUrl.trim() === "" ? undefined : draft.listingUrl.trim(),
        sellerId: draft.sellerId === "" ? undefined : (draft.sellerId as Ulid),
        location: draft.location.trim() === "" ? undefined : draft.location.trim(),
        distanceMiles: draft.distanceMiles === "" ? undefined : Number(draft.distanceMiles),
        listedDate: draft.listedDate === "" ? undefined : new Date(`${draft.listedDate}T12:00:00`),
        firstSeen: editing?.firstSeen ?? new Date(),
        expiresAt: draft.expiresAt === "" ? undefined : new Date(`${draft.expiresAt}T12:00:00`),
        photoKeys: editing?.photoKeys ?? [],
        pros: [...draft.pros],
        cons: [...draft.cons],
        notes: draft.notes.trim() === "" ? undefined : draft.notes.trim(),
        planStatus: editing?.planStatus ?? ("open" as const),
        // The equipment half rides on the shared aggregate (§5.1). Undefined
        // keys are dropped so the stored detail says only what is known.
        domainDetail: Object.fromEntries(
          Object.entries({
            category: draft.category,
            make: draft.make.trim() === "" ? undefined : draft.make.trim(),
            model: draft.model.trim() === "" ? undefined : draft.model.trim(),
            year: draft.year === "" ? undefined : Number(draft.year),
            mileage: draft.mileage === "" ? undefined : Number(draft.mileage),
            engineHours: draft.engineHours === "" ? undefined : Number(draft.engineHours),
            vin: draft.vin.trim() === "" ? undefined : draft.vin.trim(),
            condition: draft.condition === "" ? undefined : draft.condition,
            titleStatus: draft.titleStatus === "" ? undefined : draft.titleStatus,
            serviceHistoryAvailable: draft.serviceHistoryAvailable,
            warrantyRemaining:
              draft.warrantyRemaining.trim() === "" ? undefined : draft.warrantyRemaining.trim(),
            knownFaults: draft.knownFaults.trim() === "" ? undefined : draft.knownFaults.trim(),
            wearCondition:
              draft.wearCondition.trim() === "" ? undefined : draft.wearCondition.trim(),
          }).filter(([, value]) => value !== undefined),
        ),
      };

      const result =
        editing === undefined
          ? await api.create(payload as never)
          : await api.update(editing.id, payload as Partial<PurchaseCandidate>);

      if (!result.ok) {
        setError(
          result.error.kind === "validation"
            ? (result.error.issues[0]?.message ?? "That is not valid")
            : "Could not save that",
        );
        return;
      }

      show({
        message: editing === undefined ? "Added to the comparison" : "Candidate updated",
        tone: "success",
      });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      placement="side"
      title={editing === undefined ? "Add a candidate" : `Edit ${editing.title}`}
      onClose={onClose}
      footer={
        <>
          <Button type="submit" form={formId} variant="primary" busy={busy}>
            {editing === undefined ? "Add candidate" : "Save candidate"}
          </Button>
          <Button onClick={onClose}>Cancel</Button>
          {onDelete === undefined ? null : (
            <Button variant="danger" className="ml-auto" onClick={onDelete}>
              Delete
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
        <div className="flex flex-col gap-density sm:grid sm:grid-cols-2">
          <TextInput
            label="What it is"
            className="sm:col-span-2"
            placeholder="2018 F-250, Weatherford"
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            required
          />
          <Select
            label="Against which want"
            value={draft.roadmapItemId}
            placeholder="Not on the roadmap"
            onChange={(event) => setDraft({ ...draft, roadmapItemId: event.target.value })}
            options={items.map((item) => ({
              value: item.id,
              label:
                item.budgetEstimate === undefined
                  ? item.title
                  : `${item.title} · ${formatMoney(item.budgetEstimate)}`,
            }))}
          />
          <Select
            label="Category"
            value={draft.category}
            onChange={(event) =>
              setDraft({ ...draft, category: event.target.value as EquipmentCategory })
            }
            options={EQUIPMENT_CATEGORIES.map((value) => ({ value, label: value }))}
          />
          <TextInput
            label="Asking ($)"
            type="number"
            inputMode="decimal"
            step="0.01"
            numeric
            value={draft.asking}
            onChange={(event) => setDraft({ ...draft, asking: event.target.value })}
            required
          />
          <TextInput
            label="Where"
            value={draft.location}
            onChange={(event) => setDraft({ ...draft, location: event.target.value })}
          />
          <TextInput
            label="Miles away"
            hint="One way."
            type="number"
            inputMode="decimal"
            numeric
            value={draft.distanceMiles}
            onChange={(event) => setDraft({ ...draft, distanceMiles: event.target.value })}
          />
          <div className="sm:col-span-2">
            <Divider label="The machine" />
          </div>
          <TextInput
            label="Make"
            value={draft.make}
            onChange={(event) => setDraft({ ...draft, make: event.target.value })}
          />
          <TextInput
            label="Model"
            value={draft.model}
            onChange={(event) => setDraft({ ...draft, model: event.target.value })}
          />
          <TextInput
            label="Year"
            type="number"
            inputMode="numeric"
            numeric
            value={draft.year}
            onChange={(event) => setDraft({ ...draft, year: event.target.value })}
          />
          <TextInput
            label="Mileage"
            type="number"
            inputMode="numeric"
            numeric
            value={draft.mileage}
            onChange={(event) => setDraft({ ...draft, mileage: event.target.value })}
          />
          <TextInput
            label="Engine hours"
            type="number"
            inputMode="decimal"
            step="0.1"
            numeric
            value={draft.engineHours}
            onChange={(event) => setDraft({ ...draft, engineHours: event.target.value })}
          />
          <TextInput
            label="VIN or serial"
            value={draft.vin}
            onChange={(event) => setDraft({ ...draft, vin: event.target.value })}
          />
          <Select
            label="Condition"
            value={draft.condition}
            placeholder="Not judged yet"
            onChange={(event) => setDraft({ ...draft, condition: event.target.value })}
            options={CONDITIONS.map((value: Condition) => ({ value, label: value }))}
          />
          <Select
            label="Title"
            value={draft.titleStatus}
            placeholder="Not asked yet"
            onChange={(event) => setDraft({ ...draft, titleStatus: event.target.value })}
            options={TITLE_STATUSES.map((value: TitleStatus) => ({
              value,
              label: optionLabel(value),
            }))}
          />
          <div className="sm:col-span-2">
            <Divider label="The listing" />
          </div>
          <Select
            label="Seller"
            value={draft.sellerId}
            placeholder="Not recorded"
            onChange={(event) => setDraft({ ...draft, sellerId: event.target.value })}
            options={contacts.map((contact) => ({ value: contact.id, label: contact.name }))}
          />
          <TextInput
            label="Listing link"
            type="url"
            value={draft.listingUrl}
            onChange={(event) => setDraft({ ...draft, listingUrl: event.target.value })}
          />
          <TextInput
            label="Listed on"
            type="date"
            value={draft.listedDate}
            onChange={(event) => setDraft({ ...draft, listedDate: event.target.value })}
          />
          <TextInput
            label="Sale or expiry date"
            hint="Blank for a private sale."
            type="date"
            value={draft.expiresAt}
            onChange={(event) => setDraft({ ...draft, expiresAt: event.target.value })}
          />
          <TextInput
            label="Warranty left"
            value={draft.warrantyRemaining}
            onChange={(event) => setDraft({ ...draft, warrantyRemaining: event.target.value })}
          />
          <TextInput
            label="Known faults"
            value={draft.knownFaults}
            onChange={(event) => setDraft({ ...draft, knownFaults: event.target.value })}
          />
          <TextInput
            label="Tyres, tracks or wear"
            value={draft.wearCondition}
            onChange={(event) => setDraft({ ...draft, wearCondition: event.target.value })}
          />
          <Checkbox
            label="Service history available"
            checked={draft.serviceHistoryAvailable}
            onChange={(event) =>
              setDraft({ ...draft, serviceHistoryAvailable: event.target.checked })
            }
          />
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="text-xs font-semibold uppercase tracking-wide text-muted">
            Costs on top
          </legend>
          <div className="flex flex-col gap-density">
            {draft.additionalCosts.map((cost, index) => (
              <div key={index} className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <TextInput
                    label={`Cost ${index + 1}`}
                    hideLabel
                    placeholder="What for"
                    value={cost.label}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        additionalCosts: draft.additionalCosts.map((entry, at) =>
                          at === index ? { ...entry, label: event.target.value } : entry,
                        ),
                      })
                    }
                  />
                </div>
                <div className="w-32">
                  <TextInput
                    label={`Amount ${index + 1}`}
                    hideLabel
                    placeholder="$"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    numeric
                    value={cost.amount}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        additionalCosts: draft.additionalCosts.map((entry, at) =>
                          at === index ? { ...entry, amount: event.target.value } : entry,
                        ),
                      })
                    }
                  />
                </div>
              </div>
            ))}
          </div>
          <div>
            <Button
              variant="ghost"
              onClick={() =>
                setDraft({
                  ...draft,
                  additionalCosts: [...draft.additionalCosts, { label: "", amount: "" }],
                })
              }
            >
              Another cost
            </Button>
          </div>
        </fieldset>

        <div className="flex flex-col gap-density sm:grid sm:grid-cols-2">
          <TagInput
            label="Pros"
            value={draft.pros}
            onChange={(pros) => setDraft({ ...draft, pros })}
          />
          <TagInput
            label="Cons"
            value={draft.cons}
            onChange={(cons) => setDraft({ ...draft, cons })}
          />
        </div>

        <TextInput
          label="Notes"
          value={draft.notes}
          onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
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
