"use client";

import { useState } from "react";

import { Select, TextInput } from "@galaxy-farm/ui";
import { fromDollars, type Contact, type Ulid } from "@galaxy-farm/core";
import { feedPurchaseSchema, type FeedPurchase, type FeedType } from "@galaxy-farm/module-feed";
import {
  supplyPurchaseSchema,
  type SupplyItem,
  type SupplyPurchase,
} from "@galaxy-farm/module-supplies";

import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

import { atNoon, DetailsForm, errorText, todayValue, type DetailsProps } from "./log-parts";

/**
 * Restocking the shed: a feed purchase or a supplies purchase.
 *
 * The same two writes the feed and supplies screens make — `feedPurchases`
 * and `supplyPurchases`, each through its own schema — side by side because
 * a trip to the feed store usually brings back both, and both land on the
 * same boarding invoice costed the same way.
 */

type Shelf = "feed" | "supplies";

function unitLabel(unit: string): string {
  return unit.replace(/_/g, " ");
}

export function SuppliesDetails({ propertyId, actorId, onSaved }: DetailsProps) {
  const query = { propertyId };
  const { records: feeds } = useRecords<FeedType>("feedTypes", query);
  const { records: items } = useRecords<SupplyItem>("supplyItems", query);
  const { records: contacts } = useRecords<Contact>("contacts", query);

  const feedApi = useMutations<FeedPurchase>(
    "feedPurchases",
    "feedPurchases",
    feedPurchaseSchema,
    propertyId,
    actorId,
  );
  const suppliesApi = useMutations<SupplyPurchase>(
    "supplyPurchases",
    "supplyPurchases",
    supplyPurchaseSchema,
    propertyId,
    actorId,
  );

  const [shelf, setShelf] = useState<Shelf>("feed");
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [vendorContactId, setVendorContactId] = useState("");
  const [purchasedOn, setPurchasedOn] = useState(todayValue);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const options =
    shelf === "feed"
      ? feeds.map((feed) => ({ value: feed.id, label: `${feed.name} (${unitLabel(feed.unit)})` }))
      : items.map((item) => ({ value: item.id, label: `${item.name} (${unitLabel(item.unit)})` }));

  function chooseShelf(next: Shelf) {
    setShelf(next);
    setItemId("");
    setError(undefined);
  }

  async function submit() {
    setError(undefined);
    if (itemId === "") {
      setError(shelf === "feed" ? "Choose the feed" : "Choose the item");
      return;
    }

    setBusy(true);
    try {
      const result =
        shelf === "feed"
          ? await feedApi.create({
              feedTypeId: itemId as Ulid,
              quantity: Number(quantity),
              unitCost: unitCost.trim() === "" ? undefined : fromDollars(Number(unitCost)),
              purchasedOn: atNoon(purchasedOn),
            } as never)
          : await suppliesApi.create({
              supplyItemId: itemId as Ulid,
              quantity: Number(quantity),
              // Blank is "not priced", never $0 (§5.11, migration 0038).
              unitCost: unitCost.trim() === "" ? undefined : fromDollars(Number(unitCost)),
              vendorContactId: vendorContactId === "" ? undefined : (vendorContactId as Ulid),
              purchasedOn: atNoon(purchasedOn),
              notes: notes.trim() === "" ? undefined : notes.trim(),
            } as never);

      if (!result.ok) {
        setError(errorText(result.error));
        return;
      }

      const name = options.find((option) => option.value === itemId)?.label ?? "it";
      onSaved({ headline: "Purchase saved", detail: `${quantity} × ${name} in the shed.` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <DetailsForm
      title="Feed or supplies in"
      switcher={
        <div role="group" aria-label="Which shelf" className="flex gap-2">
          {(["feed", "supplies"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={shelf === value}
              onClick={() => chooseShelf(value)}
              className={[
                "inline-flex min-h-target items-center rounded-full border px-4 text-sm font-medium",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action",
                shelf === value
                  ? "border-action bg-action text-action-ink"
                  : "border-edge bg-panel text-ink hover:bg-raised",
              ].join(" ")}
            >
              {value === "feed" ? "Feed" : "Supplies"}
            </button>
          ))}
        </div>
      }
      onSubmit={() => void submit()}
      submitLabel="Save purchase"
      busy={busy}
      error={error}
    >
      <Select
        label={shelf === "feed" ? "Feed" : "Item"}
        value={itemId}
        placeholder={shelf === "feed" ? "Choose a feed" : "Choose an item"}
        options={options}
        onChange={(event) => setItemId(event.target.value)}
        required
      />
      <div className="grid grid-cols-2 gap-density">
        <TextInput
          label="Quantity"
          type="number"
          inputMode="decimal"
          numeric
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          required
        />
        <TextInput
          label="Cost each ($)"
          type="number"
          inputMode="decimal"
          step="0.01"
          numeric
          value={unitCost}
          onChange={(event) => setUnitCost(event.target.value)}
        />
      </div>
      <TextInput
        label="Bought"
        type="date"
        value={purchasedOn}
        onChange={(event) => setPurchasedOn(event.target.value)}
        required
      />
      {/* The supplies purchase carries a vendor and a note; feed's does not. */}
      {shelf === "supplies" ? (
        <>
          <Select
            label="Vendor"
            value={vendorContactId}
            options={[
              { value: "", label: "Not recorded" },
              ...contacts.map((contact) => ({ value: contact.id, label: contact.name })),
            ]}
            onChange={(event) => setVendorContactId(event.target.value)}
          />
          <TextInput
            label="Notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </>
      ) : null}
    </DetailsForm>
  );
}
