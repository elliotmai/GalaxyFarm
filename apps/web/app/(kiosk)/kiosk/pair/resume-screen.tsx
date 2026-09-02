"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button, Card } from "@galaxy-farm/ui";

import { resumeKioskSession, type ResumeFailure } from "@/app/(kiosk)/kiosk/pair/_actions";
import { PairForm } from "@/app/(kiosk)/kiosk/pair/pair-form";

/**
 * A paired screen getting its session back (spec §4.4).
 *
 * This is what a barn screen sees instead of `/login` now. It holds a device
 * token already — the whole point of §4.4's "long-lived device token" — so the
 * ordinary outcome here is a second of "Reconnecting" and then the board it
 * was on. Nobody taps anything, because on a wall-mounted tablet there is
 * nobody there to tap.
 *
 * The three failures are kept apart because they want opposite things from
 * whoever eventually walks up:
 *
 *   - **unreachable** — the token is fine and Neon is not answering. Retry on
 *     a timer, forever, quietly. This is the barn's normal weather and it
 *     fixes itself; a screen that gave up here would be showing an error page
 *     hours after the wifi came back.
 *   - **unpaired** — the device was revoked, or its row is gone. No amount of
 *     retrying helps and a code is the only way back, so show the form.
 *   - **looping** — signing in keeps succeeding and the session keeps not
 *     being there on the next request. Retrying is what got us here, so stop
 *     and say so plainly rather than spinning behind a "reconnecting" label.
 */

/**
 * Long enough that an outage costs a handful of requests rather than
 * thousands, short enough that a screen is back within half a minute of the
 * wifi returning. `SyncProvider` runs its own loop at sixty seconds for the
 * same reasons.
 */
const RETRY_MS = 30_000;

export function ResumeScreen({ next }: { readonly next: string }) {
  const [failure, setFailure] = useState<ResumeFailure | undefined>();
  // Survives re-renders and stops a retry landing on top of the navigation
  // that a successful resume has already started.
  const done = useRef(false);

  const attempt = useCallback(async () => {
    if (done.current) return;

    const result = await resumeKioskSession();
    if (result.ok) {
      done.current = true;
      // A full navigation rather than a router push: the session cookie was
      // just set, and everything past this point reads it on the server.
      window.location.assign(next);
      return;
    }

    setFailure(result.why);
  }, [next]);

  useEffect(() => {
    void attempt();
  }, [attempt]);

  useEffect(() => {
    if (failure !== "unreachable") return;
    const timer = setInterval(() => void attempt(), RETRY_MS);
    return () => clearInterval(timer);
  }, [failure, attempt]);

  if (failure === "unpaired" || failure === "looping") {
    return (
      <>
        <Card
          title={failure === "unpaired" ? "This screen was unpaired" : "Pair this screen again"}
          className="w-full max-w-sm"
        >
          <p className="text-muted">
            {failure === "unpaired"
              ? "It has been taken out of service from Settings, so it needs a new code to come back."
              : "This screen signed itself back in and was signed out again straight away, so it has stopped trying. A fresh code will reset it."}
          </p>
        </Card>
        <PairForm />
      </>
    );
  }

  return (
    <Card
      title={failure === "unreachable" ? "Waiting for signal" : "Reconnecting this screen"}
      className="flex w-full max-w-sm flex-col gap-density"
    >
      <p className="text-muted">
        {failure === "unreachable"
          ? "This screen is still paired — it just cannot reach the farm's server. It will carry on trying on its own."
          : "Signing back in with the code this screen was paired with. Nothing to do."}
      </p>

      {failure === "unreachable" ? (
        <Button variant="ghost" onClick={() => void attempt()}>
          Try now
        </Button>
      ) : null}
    </Card>
  );
}
