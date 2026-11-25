"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { PageBody, Select, useToast } from "@galaxy-farm/ui";
import { dayKey, type Ulid } from "@galaxy-farm/core";
import type { EggLog, Flock } from "@galaxy-farm/module-poultry";

import { KioskHeader } from "@/app/(kiosk)/kiosk/_components/kiosk-header";
import { logKioskEggs } from "@/app/(kiosk)/kiosk/_actions";
import { useSyncEngine } from "@/app/_components/sync-provider";
import { MAX_KIOSK_EGG_COUNT } from "@/lib/kiosk-limits";
import { useRecords } from "@/lib/local/use-records";

/**
 * Egg Quick-Entry (spec §4.4, §5.4).
 *
 * How many, and nothing else. Count the basket up with the big buttons, log
 * it once — one row for the whole collection, no colour and no size, because
 * a log that asks for either at the coop is a log nobody keeps up.
 *
 * Opened on its own from the boards, or straight from ticking off the egg
 * round on a chore board; then `returnTo` names that board, back goes there,
 * and logging the count hands back to it.
 */

const STEPS = [1, 6, 12] as const;

export function EggsBoardScreen({
  propertyId,
  returnTo,
}: {
  readonly propertyId: Ulid;
  readonly returnTo?: string | undefined;
}) {
  const { store, syncNow } = useSyncEngine();
  const { show } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [count, setCount] = useState(0);
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

  const adjust = (by: number) =>
    setCount((current) => Math.min(MAX_KIOSK_EGG_COUNT, Math.max(0, current + by)));

  function logCount() {
    if (count < 1) return;
    startTransition(async () => {
      const result = await logKioskEggs({
        ...(selected === undefined ? {} : { flockId: selected }),
        count,
      });

      if (!result.ok) {
        show({ message: result.error, tone: "danger" });
        return;
      }
      show({ message: `Logged ${count} ${count === 1 ? "egg" : "eggs"}.` });
      setCount(0);
      if (returnTo !== undefined) router.push(returnTo);
      await syncNow();
    });
  }

  return (
    <PageBody>
      <KioskHeader
        back={returnTo !== undefined}
        {...(returnTo === undefined ? {} : { backTo: returnTo })}
        title="Egg Quick-Entry"
        fact={logsLoading ? "…" : `${todayTotal} collected today`}
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
            <p className="gf-kiosk-egg-count__n" aria-label={`${count} eggs`}>
              {count}
            </p>
            <p className="text-muted">{count === 1 ? "egg" : "eggs"} in this collection</p>
          </div>

          <div className="grid grid-cols-2 gap-density sm:grid-cols-4">
            <button
              type="button"
              disabled={pending || count === 0}
              onClick={() => adjust(-1)}
              aria-label="One fewer"
              className="gf-kiosk-egg-button"
            >
              <span className="gf-kiosk-egg-button__plus">−1</span>
            </button>
            {STEPS.map((step) => (
              <button
                key={step}
                type="button"
                disabled={pending || count >= MAX_KIOSK_EGG_COUNT}
                onClick={() => adjust(step)}
                aria-label={`Add ${step}`}
                className="gf-kiosk-egg-button"
              >
                <span className="gf-kiosk-egg-button__plus">+{step}</span>
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={pending || count === 0}
            onClick={logCount}
            className="gf-kiosk-egg-log"
          >
            {pending
              ? "Logging…"
              : count === 0
                ? "Count the eggs first"
                : `Log ${count} ${count === 1 ? "egg" : "eggs"}`}
          </button>
        </div>
      )}
    </PageBody>
  );
}
