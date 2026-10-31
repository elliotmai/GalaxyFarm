"use client";

import { useMemo, useState, useTransition } from "react";

import { PageBody, Select, useToast } from "@galaxy-farm/ui";
import { dayKey, type Ulid } from "@galaxy-farm/core";
import type { EggBreakdown, EggLog, Flock } from "@galaxy-farm/module-poultry";

import { logKioskEggs } from "@/app/(kiosk)/kiosk/_actions";
import { KioskHeader, KioskQuiet, kioskDate } from "@/app/(kiosk)/kiosk/_components/kiosk-header";
import { useSyncEngine } from "@/app/_components/sync-provider";
import { useRecords } from "@/lib/local/use-records";

/**
 * Egg Quick-Entry (spec §4.4, §5.4).
 *
 * Big +1 buttons at the coop, breakdown optional — the total is the only
 * required field because a log that demanded a colour and a size for every
 * egg is a log nobody keeps up. Three presets rather than the full colour ×
 * size matrix, matching the mockup: two breakdown-carrying combinations for
 * whatever this flock lays most, and "Other" for everything else, which logs
 * a bare count with no breakdown at all.
 */

const PRESETS: readonly { readonly label: string; readonly breakdown: readonly EggBreakdown[] }[] =
  [
    { label: "Brown · large", breakdown: [{ colour: "brown", size: "large", count: 1 }] },
    { label: "Brown · medium", breakdown: [{ colour: "brown", size: "medium", count: 1 }] },
    { label: "Other", breakdown: [] },
  ];

export function EggsBoardScreen({ propertyId }: { readonly propertyId: Ulid }) {
  const { store, syncNow } = useSyncEngine();
  const { show } = useToast();
  const [pending, startTransition] = useTransition();
  const [busyLabel, setBusyLabel] = useState<string | undefined>();
  const [flockId, setFlockId] = useState<Ulid | undefined>();

  const query = useMemo(() => ({ propertyId }), [propertyId]);
  const { records: flocks, loading: flocksLoading } = useRecords<Flock>("flocks", query);
  const { records: logs, loading: logsLoading } = useRecords<EggLog>("eggLogs", query);

  const activeFlocks = useMemo(
    () => [...flocks].filter((f) => f.active).sort((a, b) => a.name.localeCompare(b.name)),
    [flocks],
  );

  // The first flock once the list arrives, so a one-coop farm never has to
  // pick — there is nothing to choose between.
  const selected = flockId ?? activeFlocks[0]?.id;

  const today = dayKey(new Date());
  const todayTotal = logs
    .filter((log) => dayKey(log.collectedOn) === today)
    .filter((log) => selected === undefined || log.flockId === selected)
    .reduce((sum, log) => sum + log.total, 0);

  function tap(preset: (typeof PRESETS)[number]) {
    setBusyLabel(preset.label);
    startTransition(async () => {
      const result = await logKioskEggs({
        ...(selected === undefined ? {} : { flockId: selected }),
        breakdown: preset.breakdown,
      });

      setBusyLabel(undefined);
      if (!result.ok) {
        show({ message: result.error, tone: "danger" });
        return;
      }
      await syncNow();
    });
  }

  return (
    <PageBody>
      <KioskHeader title="Egg Quick-Entry" fact={kioskDate(new Date())} />

      {flocksLoading || store === undefined ? (
        <KioskQuiet>Loading…</KioskQuiet>
      ) : activeFlocks.length === 0 ? (
        <KioskQuiet>No flocks yet. Add one in the admin app.</KioskQuiet>
      ) : (
        <div className="flex flex-col gap-density">
          {activeFlocks.length > 1 ? (
            <Select
              label="Coop"
              value={selected ?? ""}
              options={activeFlocks.map((flock) => ({ value: flock.id, label: flock.name }))}
              onChange={(event) => setFlockId(event.target.value as Ulid)}
            />
          ) : null}

          {/* The one number, big enough to read from the coop door. Live, so
              it is announced as each tap lands. */}
          <p
            aria-live="polite"
            className="flex flex-col items-center gap-1 rounded-density border border-rule bg-panel px-5 py-6 text-center"
          >
            <span className="font-numeric text-6xl font-semibold text-ink [font-variant-numeric:tabular-nums]">
              {logsLoading ? "…" : todayTotal}
            </span>
            <span className="text-density text-muted">
              {todayTotal === 1 ? "egg today" : "eggs today"}
            </span>
          </p>

          <div className="grid grid-cols-1 gap-density sm:grid-cols-3">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                disabled={pending}
                onClick={() => tap(preset)}
                className="flex min-h-[8rem] flex-col items-center justify-center gap-1 rounded-density border border-edge bg-panel p-density text-center hover:bg-raised disabled:opacity-60"
              >
                <span className="gf-figure text-action">
                  {pending && busyLabel === preset.label ? "…" : "+1"}
                </span>
                <span className="text-density text-ink">{preset.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </PageBody>
  );
}
