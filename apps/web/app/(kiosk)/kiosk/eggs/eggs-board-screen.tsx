"use client";

import { useMemo, useState, useTransition } from "react";

import { PageBody, Select, useToast } from "@galaxy-farm/ui";
import { dayKey, type Ulid } from "@galaxy-farm/core";
import type { EggBreakdown, EggLog, Flock } from "@galaxy-farm/module-poultry";

import { KioskHeader } from "@/app/(kiosk)/kiosk/_components/kiosk-header";
import { logKioskEggs } from "@/app/(kiosk)/kiosk/_actions";
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
      <KioskHeader
        back={false}
        title="Egg Quick-Entry"
        fact="Tap +1 for every egg as you collect it."
      />

      {flocksLoading || store === undefined ? (
        <p className="text-muted">Loading…</p>
      ) : activeFlocks.length === 0 ? (
        <p className="text-muted">No flocks are set up yet. Add one from the admin app first.</p>
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
          <div className="gf-kiosk-egg-count" aria-live="polite">
            <p className="gf-kiosk-egg-count__n">{logsLoading ? "…" : todayTotal}</p>
            <p className="text-muted">
              {todayTotal === 1 ? "egg collected today" : "eggs collected today"}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-density sm:grid-cols-3">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                disabled={pending}
                onClick={() => tap(preset)}
                className="gf-kiosk-egg-button"
              >
                <span className="gf-kiosk-egg-button__plus">
                  {pending && busyLabel === preset.label ? "…" : "+1"}
                </span>
                <span>{preset.label}</span>
              </button>
            ))}
          </div>{" "}
        </div>
      )}
    </PageBody>
  );
}
