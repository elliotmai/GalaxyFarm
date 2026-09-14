"use client";

import { useState, useTransition } from "react";

import { Button, Callout, TextInput, useConfirmDelete, useToast } from "@galaxy-farm/ui";

import {
  connect,
  disconnect,
  linkTrip,
  listTrips,
  pull,
} from "@/app/(admin)/admin/housesitter/_components/wander-actions";
import type { WanderTripSummary } from "@/lib/wander-client";
import type { WanderConnection } from "@/lib/wander-store";

/**
 * Following a trip in Wander (spec §5.10).
 *
 * Three states, and the screen is only ever in one: not connected, connected
 * but following nothing, following a trip. Written as three branches rather
 * than one form that grows fields, because the question at each step is
 * different — paste a credential, choose from a list, decide whether to
 * refresh — and a single form would ask all three at once on a screen where
 * two of them are not yet answerable.
 *
 * **The token is typed once and never shown again.** It is not held in state
 * after the action returns, and nothing the server sends back contains it;
 * `WanderConnection` has no `token` field at all. Replacing it means pasting a
 * new one, which is also the only way to fix a token revoked on Wander's side.
 */

function when(date: Date | undefined): string {
  if (date === undefined) return "never";
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function WanderPanel({ connection }: { readonly connection: WanderConnection | undefined }) {
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();
  const [pending, startTransition] = useTransition();

  const [token, setToken] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://us-central1-wander-f10b1.cloudfunctions.net");
  const [error, setError] = useState<string | undefined>();
  const [choices, setChoices] = useState<readonly WanderTripSummary[] | undefined>();

  function run(action: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setError(undefined);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      show({ message: result.message ?? "Done", tone: "success" });
    });
  }

  function begin() {
    setError(undefined);
    startTransition(async () => {
      const result = await connect(token, baseUrl);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setToken("");
      show({ message: result.message, tone: "success" });
      await loadTrips();
    });
  }

  async function loadTrips() {
    const result = await listTrips();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setChoices(result.trips);
  }

  function choose(trip: WanderTripSummary) {
    setChoices(undefined);
    run(() => linkTrip(trip.id, trip.name));
  }

  async function cut() {
    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: "the Wander link",
      entity: "connection",
      action: "Disconnect",
      dependents: [],
      consequence:
        "The farm stops pulling travel and forgets the token. Trips already pulled stay on the farm's records, and the housesitter board keeps showing them.",
    });
    if (!confirmed) return;
    setChoices(undefined);
    run(disconnect);
  }

  return (
    <div className="flex flex-col gap-density border border-edge bg-panel p-density">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium text-ink">Wander</h3>
        {connection === undefined ? null : (
          <span className="text-sm text-muted">
            {connection.tripName === undefined
              ? "connected · no trip followed"
              : `following ${connection.tripName} · pulled ${when(connection.lastPulledAt)}`}
          </span>
        )}
      </div>

      {error === undefined ? null : (
        <Callout tone="danger" title="Wander said no">
          {error}
        </Callout>
      )}

      {connection?.lastError === undefined || error !== undefined ? null : (
        <Callout tone="danger" title="The last pull failed">
          {connection.lastError}
        </Callout>
      )}

      {connection === undefined ? (
        <>
          <p className="text-sm text-muted">
            Mint a token in Wander under Account → Connected Apps, then paste it here. The farm will
            read your trips and the flights on them — it cannot change anything in Wander.
          </p>
          <TextInput
            label="Token from Wander"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
          <TextInput
            label="Wander functions URL"
            hint="Only change this if Wander runs in a different Firebase project"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
          <div>
            <Button variant="primary" busy={pending} onClick={begin}>
              Connect
            </Button>
          </div>
        </>
      ) : (
        <>
          {choices === undefined ? null : choices.length === 0 ? (
            <p className="text-sm text-muted">Wander has no trips that have not already ended.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {choices.map((trip) => (
                <li
                  key={trip.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 border border-edge p-2"
                >
                  <span className="min-w-0">
                    <strong>{trip.name}</strong>
                    {trip.destination === undefined ? null : (
                      <span className="text-muted"> · {trip.destination}</span>
                    )}
                    <span className="block text-sm text-muted">
                      {trip.startDate} → {trip.endDate}
                      {trip.isCurrent ? " · on now" : ""}
                    </span>
                  </span>
                  <Button busy={pending} onClick={() => choose(trip)}>
                    Follow this one
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-2">
            <Button busy={pending} onClick={() => void loadTrips()}>
              {connection.tripId === undefined ? "Pick a trip" : "Follow a different trip"}
            </Button>
            {connection.tripId === undefined ? null : (
              <Button variant="primary" busy={pending} onClick={() => run(pull)}>
                Refresh now
              </Button>
            )}
            <Button variant="ghost" busy={pending} onClick={() => void cut()}>
              Disconnect
            </Button>
          </div>

          <p className="text-xs text-muted">
            Pulled trips are read-only on the farm — edit them in Wander and refresh. The one
            exception is who is away, which keeps whatever you write here.
          </p>
        </>
      )}
    </div>
  );
}
