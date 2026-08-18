"use client";

import { useState } from "react";

import {
  Button,
  Callout,
  Card,
  DetailList,
  EmptyState,
  Pill,
  Section,
  TextInput,
  useToast,
} from "@galaxy-farm/ui";
import { propertySchema, zoneSchema, type Property, type Ulid, type Zone } from "@galaxy-farm/core";
import { frostDatesFor } from "@galaxy-farm/module-garden";

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

      <GrowingZone property={property} api={api} />

      <GroundThatDidNotMove propertyId={propertyId} actorId={actorId} />
    </div>
  );
}

/**
 * The hardiness zone the garden runs on (spec §5.5, §6).
 *
 * Derived from the address by the lookup above and editable here, in that
 * order of preference. The garden reads this and nothing else: frost dates,
 * the growing season that gates frost warnings, and the planting windows a
 * season plan is written against all come from it, so a farm sitting on a zone
 * boundary — or one that keeps a low spot that runs a half zone colder than
 * the map says — has to be able to overrule the lookup. Fort Worth reads
 * ≈8b today; that is a fact about this address, never a constant in the code.
 *
 * Blanking it is allowed and is not a broken state. `frostDatesFor` returns
 * nothing for a zone it does not know, and the garden then declines to guess
 * a season rather than inventing one.
 */
function GrowingZone({
  property,
  api,
}: {
  readonly property: Property;
  readonly api: ReturnType<typeof useMutations<Property>>;
}) {
  const { show } = useToast();
  const [zone, setZone] = useState(property.growingZone ?? "");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // The stored value wins until somebody types, so a zone the address lookup
  // has just written is not overwritten by a stale form nobody touched.
  const shown = dirty ? zone : (property.growingZone ?? "");
  const dates = frostDatesFor(shown, new Date().getUTCFullYear());

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setBusy(true);

    try {
      const result = await api.update(property.id, {
        growingZone: shown.trim() === "" ? undefined : shown.trim().toLowerCase(),
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
      show({ message: "Growing zone saved", tone: "success" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Growing zone"
      description="The USDA hardiness zone. The garden's frost dates, its growing season and every planting window derive from it."
    >
      <Card>
        <form onSubmit={(event) => void save(event)} className="flex flex-col gap-density">
          <div className="grid grid-cols-1 gap-density sm:grid-cols-2">
            <TextInput
              label="Zone"
              hint="Looks like 8b. The address lookup fills this in; change it if you know better."
              value={shown}
              maxLength={4}
              onChange={(event) => {
                setZone(event.target.value);
                setDirty(true);
              }}
              {...(error === undefined ? {} : { error })}
            />
            <DetailList
              columns={1}
              items={[
                {
                  label: "Average frost dates",
                  value:
                    dates === undefined
                      ? undefined
                      : `${formatFrostDate(dates.lastSpringFrost)} to ${formatFrostDate(dates.firstFallFrost)} · ${dates.growingDays} days`,
                  wide: true,
                },
              ]}
            />
          </div>

          {shown.trim() !== "" && dates === undefined ? (
            <p className="text-sm text-muted">
              No frost dates are known for that zone, so the garden will not guess a season. Frost
              warnings still fire; the growing-season filter simply lets them all through.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" busy={busy} disabled={!dirty}>
              Save zone
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

/** Day and month only — the year is whichever one you are standing in. */
function formatFrostDate(value: Date): string {
  return value.toLocaleDateString(undefined, { day: "numeric", month: "long", timeZone: "UTC" });
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
