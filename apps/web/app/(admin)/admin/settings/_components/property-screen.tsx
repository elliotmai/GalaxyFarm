"use client";

import { useState } from "react";

import {
  Button,
  Callout,
  Card,
  EmptyState,
  Pill,
  Section,
  TextInput,
  useToast,
} from "@galaxy-farm/ui";
import { propertySchema, zoneSchema, type Property, type Ulid, type Zone } from "@galaxy-farm/core";

import { AddressLookup } from "@/app/(admin)/admin/settings/_components/address-lookup";
import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

/**
 * The place itself (spec §5.1, §7 `/admin/settings`).
 *
 * Everything in the app hangs off `propertyId`, and until now nothing could
 * edit the row it points at: the name and the timezone were set by the seed,
 * and the address was buried in the calving-watch tab because the watch is
 * what first needed a coordinate. Moving house was a database edit.
 *
 * **Moving is not a second property.** The same herd, the same records, the
 * same history — a calf born at the old place is still that calf — with a new
 * address, new coordinates and possibly a new growing zone. So this edits the
 * property in place rather than creating one, and nothing is re-parented.
 *
 * The one thing that genuinely does not come with you is the ground. Pens,
 * traps and water sources are physical, and a pen at the old place should stop
 * being offered the moment you leave without taking the history of who stood
 * in it. That is what `active` is for, and why the section below retires
 * rather than deletes.
 */

export function PropertyScreen({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const { records: properties, loading } = useRecords<Property>("properties", { propertyId });
  const property = properties.find((row) => row.id === propertyId);

  const api = useMutations<Property>(
    "properties",
    "properties",
    propertySchema,
    propertyId,
    actorId,
  );

  if (loading) return <p className="text-muted">Loading…</p>;
  if (property === undefined) {
    return (
      <Callout tone="danger" title="This property is not on the device yet">
        Nothing has synced for it. If this is a new device, give the first pull a moment.
      </Callout>
    );
  }

  return (
    <div className="flex flex-col gap-density">
      <Identity property={property} api={api} />

      <Section
        title="Where the farm is"
        description="Type the address. The coordinates and the growing zone are worked out from it — and the forecast and the calving watch read them from here."
      >
        <AddressLookup property={property} api={api} />
      </Section>

      <OfflineBackground property={property} api={api} />

      <GroundThatDidNotMove propertyId={propertyId} actorId={actorId} />
    </div>
  );
}

/** The name and the clock — the two fields nothing else could set. */
function Identity({
  property,
  api,
}: {
  readonly property: Property;
  readonly api: ReturnType<typeof useMutations<Property>>;
}) {
  const { show } = useToast();
  const [name, setName] = useState(property.name);
  const [timezone, setTimezone] = useState(property.timezone);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // The stored values win until somebody types, so a change synced from
  // another device is not overwritten by a stale form nobody touched.
  const shownName = dirty ? name : property.name;
  const shownZone = dirty ? timezone : property.timezone;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);

    if (shownName.trim() === "") {
      setError("The property needs a name.");
      return;
    }

    setBusy(true);
    try {
      const result = await api.update(property.id, {
        name: shownName.trim(),
        timezone: shownZone.trim(),
      } as Partial<Property>);

      if (!result.ok) {
        setError(
          result.error.kind === "validation"
            ? (result.error.issues[0]?.message ?? "That is not valid.")
            : "Could not save that.",
        );
        return;
      }

      setDirty(false);
      show({ message: "Property saved", tone: "success" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="The place"
      description="What this property is called on pen boards, reports and the housesitter guide. Not the farm's name — that is on the Branding tab."
    >
      <Card>
        <form onSubmit={(event) => void save(event)} className="flex flex-col gap-density">
          <div className="grid grid-cols-1 gap-density sm:grid-cols-2">
            <TextInput
              label="Property name"
              hint="&ldquo;Home Place&rdquo;, &ldquo;The Rhome place&rdquo;."
              value={shownName}
              maxLength={120}
              onChange={(event) => {
                setName(event.target.value);
                setDirty(true);
              }}
              {...(error === undefined ? {} : { error })}
              required
            />
            <TextInput
              label="Timezone"
              // Worth a field of its own rather than deriving it from the
              // coordinates: a move across a state line is the case this
              // exists for, and every chore time, calving window and report
              // boundary is read in it. Silently wrong by an hour is worse
              // than asked for once.
              hint="An IANA name — America/Chicago."
              value={shownZone}
              onChange={(event) => {
                setTimezone(event.target.value);
                setDirty(true);
              }}
              required
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" busy={busy} disabled={!dirty}>
              Save
            </Button>
            {!dirty ? null : (
              <Button
                variant="ghost"
                onClick={() => {
                  // crud-guard: allow-unconfirmed — drops an unsaved edit in a
                  // form, nothing persisted
                  setDirty(false);
                  setError(undefined);
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </form>
      </Card>
    </Section>
  );
}

/**
 * The aerial the map falls back to with no signal (spec §8).
 *
 * Google's terms do not permit storing its tiles, so the background a barn
 * kiosk draws pens over has to be one we own: a USDA NAIP image of the place,
 * public domain, reprojected to Web Mercator and put in R2. Both halves are
 * typed in here because neither can be worked out from the other — a key with
 * no extent is a photograph nobody can place, and an extent with no key is a
 * rectangle of nothing.
 *
 * Four numbers rather than a drawn rectangle, deliberately. The extent comes
 * off the file that was downloaded — `gdalinfo` prints it — and typing what a
 * tool already computed is more accurate than dragging a box over a map and
 * hoping. Getting it wrong is not subtle either: the pens land somewhere on
 * the picture that is visibly not the pens.
 */
function OfflineBackground({
  property,
  api,
}: {
  readonly property: Property;
  readonly api: ReturnType<typeof useMutations<Property>>;
}) {
  const { show } = useToast();
  const [draft, setDraft] = useState<Record<string, string> | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const stored: Record<string, string> = {
    key: property.offlineImageryKey ?? "",
    south: property.offlineImageryBounds?.south?.toString() ?? "",
    west: property.offlineImageryBounds?.west?.toString() ?? "",
    north: property.offlineImageryBounds?.north?.toString() ?? "",
    east: property.offlineImageryBounds?.east?.toString() ?? "",
  };
  const shown = draft ?? stored;

  const edges = ["south", "west", "north", "east"] as const;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);

    const numbers = edges.map((edge) => Number(shown[edge]));
    const blank = edges.every((edge) => (shown[edge] ?? "") === "");

    if (!blank && numbers.some((value) => Number.isNaN(value))) {
      setError("Every edge needs a number, or leave all four empty.");
      return;
    }

    setBusy(true);
    try {
      const result = await api.update(property.id, {
        offlineImageryKey: (shown["key"] ?? "").trim() === "" ? undefined : shown["key"]?.trim(),
        offlineImageryBounds: blank
          ? undefined
          : {
              south: numbers[0] as number,
              west: numbers[1] as number,
              north: numbers[2] as number,
              east: numbers[3] as number,
            },
      } as Partial<Property>);

      if (!result.ok) {
        setError(
          result.error.kind === "validation"
            ? (result.error.issues[0]?.message ?? "That is not valid.")
            : "Could not save that.",
        );
        return;
      }

      setDraft(undefined);
      show({ message: "Offline background saved", tone: "success" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Offline aerial"
      description="What the map draws pens over when there is no signal. Google&rsquo;s imagery cannot be stored, so this one is ours."
    >
      <Card>
        <form onSubmit={(event) => void save(event)} className="flex flex-col gap-density">
          <TextInput
            label="Image key in R2"
            hint="The object&rsquo;s path in the bucket — property/naip-2024.jpg."
            value={shown["key"] ?? ""}
            onChange={(event) => setDraft({ ...shown, key: event.target.value })}
            {...(error === undefined ? {} : { error })}
          />

          <div className="grid grid-cols-2 gap-density sm:grid-cols-4">
            {edges.map((edge) => (
              <TextInput
                key={edge}
                label={`${edge[0]?.toUpperCase()}${edge.slice(1)} edge`}
                hint={edge === "south" || edge === "north" ? "Latitude" : "Longitude"}
                numeric
                inputMode="decimal"
                value={shown[edge] ?? ""}
                onChange={(event) => setDraft({ ...shown, [edge]: event.target.value })}
              />
            ))}
          </div>

          <Button type="submit" busy={busy} disabled={draft === undefined}>
            {/* Named, not a bare "Save": this screen has three forms on it and
                a column of identical buttons says nothing about which one. */}
            Save offline aerial
          </Button>
        </form>
      </Card>
    </Section>
  );
}

/**
 * The pens you left behind.
 *
 * Retired, never deleted. A zone carries the history of everything that stood
 * in it — assignments, pasture care, the feeding plans written against it —
 * and deleting it to tidy up after a move would take the answer to "where was
 * she in the spring" with it. `active: false` takes it out of every picker and
 * leaves all of that readable.
 *
 * Reversible in one tap, so getting it wrong costs nothing and there is no
 * confirmation tier to argue about (§4.5 clause 3 covers destruction; this is
 * not destruction).
 */
function GroundThatDidNotMove({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const { records: zones, loading } = useRecords<Zone>("zones", { propertyId });
  const api = useMutations<Zone>("zones", "zones", zoneSchema, propertyId, actorId);
  const { show } = useToast();
  const [busy, setBusy] = useState<Ulid | undefined>();

  const working = zones.filter((zone) => zone.active);
  const retired = zones.filter((zone) => !zone.active);

  async function setActive(zone: Zone, active: boolean) {
    setBusy(zone.id);
    try {
      const result = await api.update(zone.id, { active } as Partial<Zone>);
      if (!result.ok) {
        show({ message: `Could not change ${zone.name}`, tone: "danger" });
        return;
      }
      show({
        message: active ? `${zone.name} is back in use` : `${zone.name} retired`,
        tone: active ? "success" : "warning",
      });
    } finally {
      setBusy(undefined);
    }
  }

  if (loading) return null;

  return (
    <Section
      title="Ground"
      description="Pens, traps and water sources are physical: they stay behind when you move. Retire the ones that did — they leave every picker and keep their history."
    >
      <Card>
        {working.length === 0 ? (
          <EmptyState title="No zones in use" detail="Nothing here to retire." />
        ) : (
          <ul className="flex flex-col divide-y divide-rule">
            {working.map((zone) => (
              <li key={zone.id} className="flex items-center justify-between gap-3 py-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-density text-ink">{zone.name}</span>
                  <Pill>{zone.type}</Pill>
                  {zone.resting ? <Pill tone="action">resting</Pill> : null}
                </span>
                <Button
                  variant="ghost"
                  busy={busy === zone.id}
                  onClick={() => void setActive(zone, false)}
                >
                  Retire
                </Button>
              </li>
            ))}
          </ul>
        )}

        {retired.length === 0 ? null : (
          <div className="mt-density border-t border-edge pt-density">
            <p className="mb-2 text-sm text-muted">
              Retired — still readable everywhere they appear in the record, offered nowhere.
            </p>
            <ul className="flex flex-col divide-y divide-rule">
              {retired.map((zone) => (
                <li key={zone.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="truncate text-density text-muted">{zone.name}</span>
                  <Button
                    variant="ghost"
                    busy={busy === zone.id}
                    onClick={() => void setActive(zone, true)}
                  >
                    Bring back
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </Section>
  );
}
