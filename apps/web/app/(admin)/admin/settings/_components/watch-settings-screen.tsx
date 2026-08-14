"use client";

import Link from "next/link";
import { useState } from "react";

import {
  Badge,
  Button,
  Card,
  Checkbox,
  DetailList,
  Section,
  TextInput,
  useToast,
} from "@galaxy-farm/ui";
import {
  DEFAULT_WATCH_SETTINGS,
  propertySchema,
  resolveWatchSettings,
  WATCH_SIGNALS,
  type Property,
  type Ulid,
  type WatchSettings,
  type WatchSignal,
  type WatchTrigger,
} from "@galaxy-farm/core";

import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

/**
 * Settings (spec §6, §5.1).
 *
 * §6 asks for configurable thresholds with per-trigger opt-out and lead time,
 * and the reason all three are needed is the same reason: an alert that fires
 * when nothing needs doing is the one that teaches somebody to swipe the next
 * one away. The full moon is the clearest case — it is in the spec, people
 * weigh it, and it will be the first thing somebody switches off.
 *
 * Stored partial and merged over the defaults, so adding a threshold in a
 * later version does not reset the two somebody had already tuned.
 */

const SIGNAL_LABELS: Readonly<Record<WatchSignal, { title: string; detail: string }>> = {
  cold_snap: {
    title: "Cold snap",
    detail: "A wet newborn chills fast. This is the one that stands on its own.",
  },
  pressure_fall: {
    title: "Barometric fall",
    detail: "Some support, a lot of stockman belief. A front coming through.",
  },
  full_moon: {
    title: "Full moon",
    detail: "Very little support. Here because §6 asks for it and people weigh it anyway.",
  },
};

export function WatchSettingsScreen({
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
  const { show } = useToast();

  const stored = resolveWatchSettings(property?.watchSettings);
  const [draft, setDraft] = useState<WatchSettings>(stored);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // The stored value wins until somebody edits, so a sync arriving from another
  // device is not overwritten by a stale form nobody touched.
  const settings = dirty ? draft : stored;

  function change(patch: Partial<WatchSettings>) {
    setDraft({ ...settings, ...patch });
    setDirty(true);
  }

  function changeTrigger(signal: WatchSignal, patch: Partial<WatchTrigger>) {
    change({
      triggers: {
        ...settings.triggers,
        [signal]: { ...settings.triggers[signal], ...patch },
      },
    });
  }

  async function save() {
    if (property === undefined) return;
    setError(undefined);
    setBusy(true);
    try {
      const result = await api.update(property.id, { watchSettings: settings });
      if (!result.ok) {
        setError(
          result.error.kind === "validation"
            ? (result.error.issues[0]?.message ?? "That is not valid")
            : "Could not save",
        );
        return;
      }
      setDirty(false);
      show({ message: "Watch settings saved" });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-muted">Loading…</p>;

  if (property === undefined) {
    return <p className="text-muted">No property on this device yet.</p>;
  }

  const located = property.latitude !== undefined && property.longitude !== undefined;

  return (
    <div className="flex flex-col gap-density">
      {/*
        An `h2`, not an `h1`: this is one tab of `/admin/settings` now, and the
        shell owns the page heading. Two `h1`s on a page is one too many for
        anybody navigating it by headings.
      */}
      <Section
        title="Calving watch"
        description="What the forecast has to do before anybody hears about it."
        actions={
          <span className="flex items-center gap-2">
            {located ? (
              <Badge tone="calm">Located</Badge>
            ) : (
              <Badge tone="danger">No coordinates — no forecast</Badge>
            )}
            <Button onClick={() => void save()} busy={busy} disabled={!dirty}>
              {dirty ? "Save" : "Saved"}
            </Button>
          </span>
        }
      >
        <span className="sr-only">Calving watch settings</span>
      </Section>

      {located ? null : (
        <Card title="This property has no coordinates">
          <p className="text-density text-muted">
            The forecast is fetched for a latitude and longitude, so without them the watch card
            still counts the days but shows no weather. Set the address on the{" "}
            <strong>Property</strong> tab and both are worked out from it.
          </p>
        </Card>
      )}

      <Section
        title="Thresholds"
        description="§6's defaults, which are the numbers until somebody here changes one."
      >
        <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-3">
          <TextInput
            label="Calf chill (°F)"
            hint={`Default ${DEFAULT_WATCH_SETTINGS.calfChillF}.`}
            type="number"
            value={String(settings.calfChillF)}
            onChange={(event) => change({ calfChillF: Number(event.target.value) })}
          />
          <TextInput
            label="Pressure fall (hPa / 24h)"
            hint={`Default ${DEFAULT_WATCH_SETTINGS.pressureFallHpa}, about 0.12 inHg.`}
            type="number"
            step="0.1"
            value={String(settings.pressureFallHpa)}
            onChange={(event) => change({ pressureFallHpa: Number(event.target.value) })}
          />
          <TextInput
            label="Full moon window (days)"
            hint="How near a full moon still counts."
            type="number"
            value={String(settings.fullMoonDays)}
            onChange={(event) => change({ fullMoonDays: Number(event.target.value) })}
          />
          <TextInput
            label="Calving window (days either side)"
            hint={`Default ${DEFAULT_WATCH_SETTINGS.calvingWindowDays}.`}
            type="number"
            value={String(settings.calvingWindowDays)}
            onChange={(event) => change({ calvingWindowDays: Number(event.target.value) })}
          />
          <TextInput
            label="Gestation (days)"
            hint="§12 decision 2: a flat 283 for every breed."
            type="number"
            value={String(settings.gestationDays)}
            onChange={(event) => change({ gestationDays: Number(event.target.value) })}
          />
          <TextInput
            label="Hard freeze (°F)"
            hint="When a tank freezes, for the freeze chore."
            type="number"
            value={String(settings.hardFreezeF)}
            onChange={(event) => change({ hardFreezeF: Number(event.target.value) })}
          />
        </div>
      </Section>

      <Section
        title="Which signals speak up"
        description="Off means it is never computed. Lead time is how far ahead you hear about it."
      >
        <div className="flex flex-col gap-density">
          {WATCH_SIGNALS.map((signal) => (
            <Card key={signal}>
              <div className="flex flex-wrap items-end justify-between gap-density">
                <div className="flex flex-col gap-1">
                  <span className="font-medium text-ink">{SIGNAL_LABELS[signal].title}</span>
                  <span className="max-w-prose text-sm text-muted">
                    {SIGNAL_LABELS[signal].detail}
                  </span>
                </div>
                <div className="flex flex-wrap items-end gap-density">
                  <Checkbox
                    label="On"
                    checked={settings.triggers[signal].enabled}
                    onChange={(event) => changeTrigger(signal, { enabled: event.target.checked })}
                  />
                  <TextInput
                    label="Lead (hours)"
                    type="number"
                    value={String(settings.triggers[signal].leadHours)}
                    onChange={(event) =>
                      changeTrigger(signal, { leadHours: Number(event.target.value) })
                    }
                    disabled={!settings.triggers[signal].enabled}
                  />
                </div>
              </div>
            </Card>
          ))}
        </div>
      </Section>

      {error === undefined ? null : (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <Section title="Everything else">
        <DetailList
          columns={2}
          items={[
            { label: "Property", value: property.name },
            { label: "Timezone", value: property.timezone },
            { label: "Growing zone", value: property.growingZone },
            {
              label: "Trash",
              value: (
                <Link
                  href="/admin/settings/trash"
                  className="text-action underline underline-offset-2"
                >
                  Deleted records
                </Link>
              ),
            },
          ]}
        />
      </Section>
    </div>
  );
}
