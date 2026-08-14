"use client";

import { useState } from "react";

import { Button, Card, DetailList, TextInput, useToast } from "@galaxy-farm/ui";
import type { Property } from "@galaxy-farm/core";

import type { useMutations } from "@/lib/local/mutations";

/**
 * Where the farm is (spec §5.1, §6, §8).
 *
 * Lifted out of the calving-watch settings, where it lived because the watch
 * is what first needed a coordinate. That made moving house something you did
 * from a page about cold snaps. The address is the property's, not the watch's,
 * so it belongs on the Property tab and the watch reads what it finds there.
 */

interface Match {
  readonly found: boolean;
  readonly message?: string;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly matchedAddress?: string;
  readonly postalCode?: string;
  readonly county?: string;
  readonly state?: string;
  readonly precision?: "exact" | "interpolated" | "approximate";
  readonly growingZone?: string;
  readonly hardiness?: { readonly zone: string; readonly temperatureRange?: string };
}

const PRECISION_NOTE: Readonly<Record<NonNullable<Match["precision"]>, string>> = {
  exact: "Matched to the building.",
  interpolated:
    "Matched along the road — the pin may be a few hundred yards off, which is fine for a forecast.",
  approximate:
    "Matched to the area, not the address. Good enough for weather, not for pen boundaries.",
};

/**
 * The address is the input; everything else is derived (spec §5.1).
 *
 * Nobody knows their own latitude. They know their address, so that is what
 * gets typed, and the coordinates and the growing zone fall out of it — §2's
 * "derive, don't duplicate" applied to the one field somebody would otherwise
 * have had to go and look up.
 *
 * The match is shown before it is saved, deliberately. A rural route matched
 * to the wrong side of a county line produces a forecast that is wrong and
 * entirely plausible, and the geocoder's own normalised address is the only
 * thing that gives it away.
 */
export function AddressLookup({
  property,
  api,
}: {
  readonly property: Property;
  readonly api: ReturnType<typeof useMutations<Property>>;
}) {
  const { show } = useToast();
  const [address, setAddress] = useState(property.address ?? "");
  const [match, setMatch] = useState<Match | undefined>();
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);

  async function lookUp() {
    setBusy(true);
    setMatch(undefined);
    try {
      const response = await fetch("/api/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      setMatch((await response.json()) as Match);
    } catch {
      setMatch({ found: false, message: "Could not reach the geocoder. Try again in a moment." });
    } finally {
      setBusy(false);
    }
  }

  async function accept(found: Match) {
    await api.update(property.id, {
      address,
      latitude: found.latitude,
      longitude: found.longitude,
      // Only when the lookup produced one. An address in a county the
      // hardiness mirror does not know about must not blank a zone somebody
      // set by hand.
      ...(found.growingZone === undefined ? {} : { growingZone: found.growingZone }),
    } as Partial<Property>);
    setMatch(undefined);
    show({ message: "Location saved" });
  }

  return (
    <div className="flex flex-col gap-density">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <TextInput
            label="Address"
            hint="Street, town, state and ZIP."
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            autoComplete="street-address"
          />
        </div>
        <Button onClick={() => void lookUp()} busy={busy} disabled={address.trim() === ""}>
          Look it up
        </Button>
      </div>

      {match === undefined ? null : match.found ? (
        <Card title="Is this right?">
          <DetailList
            columns={2}
            items={[
              { label: "Matched", value: match.matchedAddress, wide: true },
              {
                label: "Coordinates",
                value: `${match.latitude?.toFixed(5)}, ${match.longitude?.toFixed(5)}`,
              },
              { label: "County", value: match.county },
              {
                label: "Growing zone",
                value:
                  match.hardiness === undefined
                    ? undefined
                    : `${match.hardiness.zone}${
                        match.hardiness.temperatureRange === undefined
                          ? ""
                          : ` · ${match.hardiness.temperatureRange}`
                      }`,
              },
              {
                label: "Confidence",
                value: match.precision === undefined ? undefined : PRECISION_NOTE[match.precision],
                wide: true,
              },
            ]}
          />
          <div className="mt-density flex flex-wrap gap-3 border-t border-edge pt-density">
            <Button onClick={() => void accept(match)}>Use this</Button>
            <Button variant="ghost" onClick={() => setMatch(undefined)}>
              No, let me edit the address
            </Button>
          </div>
        </Card>
      ) : (
        <Card title="No match">
          <p className="text-density text-muted">{match.message}</p>
          <div className="mt-density">
            <Button variant="ghost" onClick={() => setManual(true)}>
              Enter the coordinates by hand
            </Button>
          </div>
        </Card>
      )}

      <DetailList
        columns={2}
        items={[
          {
            label: "Latitude",
            value: property.latitude === undefined ? undefined : property.latitude.toFixed(5),
          },
          {
            label: "Longitude",
            value: property.longitude === undefined ? undefined : property.longitude.toFixed(5),
          },
        ]}
      />

      {/*
        The escape hatch, not the front door. A farm at the end of a road the
        geocoders have never heard of still has to be able to set a location,
        and refusing to let anybody type a number would make the derived-value
        principle into an obstacle.
      */}
      {!manual ? (
        <button
          type="button"
          onClick={() => setManual(true)}
          className="self-start text-sm text-muted underline underline-offset-2 hover:text-ink"
        >
          Set the coordinates by hand instead
        </button>
      ) : (
        <div className="grid grid-cols-1 gap-density sm:grid-cols-2">
          <TextInput
            label="Latitude"
            type="number"
            inputMode="decimal"
            step="0.000001"
            defaultValue={property.latitude ?? ""}
            onBlur={(event) => {
              const value = event.target.value;
              void api.update(property.id, {
                latitude: value === "" ? undefined : Number(value),
              } as Partial<Property>);
            }}
          />
          <TextInput
            label="Longitude"
            type="number"
            inputMode="decimal"
            step="0.000001"
            defaultValue={property.longitude ?? ""}
            onBlur={(event) => {
              const value = event.target.value;
              void api.update(property.id, {
                longitude: value === "" ? undefined : Number(value),
              } as Partial<Property>);
            }}
          />
        </div>
      )}
    </div>
  );
}
