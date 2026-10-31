"use client";

import { useEffect, useState } from "react";

import { Badge, Button, Modal } from "@galaxy-farm/ui";

import { useSync } from "@/app/_components/sync-provider";
import { deviceId } from "@/lib/local/device-id";
import { ago, waitingItems, type WaitingItem } from "@/lib/sync-summary";

/**
 * The sync pill, and what is behind it (spec §4.2).
 *
 * The pill says the one thing worth knowing at a glance — up to date, three
 * to send, offline — and tapping it opens the rest: when this device last
 * reached the farm, what exactly is still on it, anything the server keeps
 * refusing and why, and the two things a person can do about any of it.
 *
 * On a phone the pill stays quiet when all is well, so the top bar is not a
 * permanent "Up to date"; a small green dot stands in for it, so there is
 * still something to tap.
 */

type Tone = "calm" | "action" | "danger" | "neutral";

interface Pill {
  readonly label: string;
  readonly tone: Tone;
}

function pillFor(state: ReturnType<typeof useSync>): Pill {
  const { offline, problem, syncing, pending, stuck } = state;
  // Set-aside entries first: the only state that will not fix itself.
  if (stuck > 0) return { label: `${stuck} not sent`, tone: "danger" };
  if (syncing) return { label: "Syncing…", tone: "neutral" };
  if (problem !== undefined) {
    return { label: `Sync failing${pending > 0 ? ` · ${pending} queued` : ""}`, tone: "danger" };
  }
  if (offline)
    return { label: `Offline${pending > 0 ? ` · ${pending} queued` : ""}`, tone: "calm" };
  if (pending > 0) return { label: `${pending} to send`, tone: "action" };
  return { label: "Up to date", tone: "calm" };
}

export function SyncStatus({ quiet = false }: { readonly quiet?: boolean }) {
  const sync = useSync();
  const [open, setOpen] = useState(false);
  const pill = pillFor(sync);
  const allWell = pill.label === "Up to date";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Sync: ${pill.label}. Show details`}
        className="inline-flex min-h-target items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
      >
        {quiet && allWell ? (
          <span className="flex min-h-target w-8 items-center justify-center">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-calm" />
          </span>
        ) : (
          <Badge tone={pill.tone}>{pill.label}</Badge>
        )}
      </button>
      {open ? <SyncDetails onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** What the panel says first: the state, in a sentence a person can act on. */
function headline(state: ReturnType<typeof useSync>): string {
  if (state.stuck > 0) {
    return "Some changes were refused by the farm and set aside. They are still on this device.";
  }
  if (state.syncing) return "Talking to the farm now.";
  if (state.problem !== undefined) {
    return "The farm answered but would not take the changes. They are kept here and retried.";
  }
  if (state.offline) {
    return "No connection. Everything you do is kept on this device and sent when it is back.";
  }
  if (state.pending > 0) return "Changes are waiting to go. They will send on their own.";
  return "Everything on this device has reached the farm.";
}

function SyncDetails({ onClose }: { readonly onClose: () => void }) {
  const sync = useSync();
  const [items, setItems] = useState<readonly WaitingItem[] | undefined>(undefined);
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const { store, pending, stuck, syncing } = sync;

  // Re-read the queue whenever the counts move, so the list empties in front
  // of the person watching it send.
  useEffect(() => {
    if (store === undefined) return;
    let live = true;
    void Promise.all([store.outbox.pending(), store.photoQueue.pending()]).then(
      ([entries, photos]) => {
        if (!live) return;
        setItems(waitingItems(entries, photos));
        setNow(new Date());
      },
    );
    return () => {
      live = false;
    };
  }, [store, pending, stuck, syncing]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  const facts = [
    [
      "Last synced",
      sync.lastSyncedAt === undefined
        ? "Not yet on this device"
        : `${ago(sync.lastSyncedAt, now)} · ${sync.lastSyncedAt.toLocaleTimeString(undefined, {
            hour: "numeric",
            minute: "2-digit",
          })}`,
    ],
    ["Connection", sync.offline ? "Offline" : "Online"],
    ["Waiting to send", pending === 0 ? "Nothing" : String(pending)],
    ...(stuck > 0 ? [["Set aside", String(stuck)]] : []),
  ] as const;

  return (
    <Modal
      title="Sync"
      description={headline(sync)}
      onClose={onClose}
      placement="side"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          {stuck > 0 ? (
            <Button disabled={busy} onClick={() => void run(sync.retryStuck)}>
              Try the set-aside ones again
            </Button>
          ) : null}
          <Button
            variant="primary"
            disabled={busy || syncing}
            onClick={() => void run(sync.syncNow)}
          >
            {syncing ? "Syncing…" : "Sync now"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-density">
        {sync.problem === undefined ? null : (
          <p className="rounded-density border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-ink">
            {sync.problem}
          </p>
        )}

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {facts.map(([term, value]) => (
            <div key={term} className="contents">
              <dt className="text-muted">{term}</dt>
              <dd className="text-ink">{value}</dd>
            </div>
          ))}
        </dl>

        {items === undefined || items.length === 0 ? null : (
          <section aria-label="Waiting on this device" className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-ink">On this device, not yet sent</h3>
            <ul className="flex flex-col divide-y divide-rule rounded-density border border-rule bg-panel">
              {items.slice(0, 30).map((item) => (
                <li key={item.id} className="flex flex-col gap-0.5 px-3 py-2">
                  <span className="flex flex-wrap items-center gap-2 text-sm text-ink">
                    <span className="font-medium">
                      {item.what}
                      {item.name === undefined ? "" : ` · ${item.name}`}
                    </span>
                    {item.stuck ? <Badge tone="danger">Set aside</Badge> : null}
                  </span>
                  <span className="text-xs text-muted">
                    {item.how} · {ago(item.queuedAt, now)}
                    {/* A reason only for what the farm refused: on an item merely
                        waiting for signal it is "Failed to fetch", which says
                        nothing the Connection line has not. */}
                    {item.stuck && item.reason !== undefined ? ` · ${item.reason}` : ""}
                  </span>
                </li>
              ))}
            </ul>
            {items.length > 30 ? (
              <p className="text-xs text-muted">and {items.length - 30} more</p>
            ) : null}
          </section>
        )}

        <p className="text-xs text-muted">This device: {deviceId().slice(-8)}</p>
      </div>
    </Modal>
  );
}
