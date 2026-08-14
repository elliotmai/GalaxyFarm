"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

import { Button, Card, TextInput } from "@galaxy-farm/ui";

import { redeemPairingCode } from "@/app/(kiosk)/kiosk/pair/_actions";
import { DEVICE_ID_STORAGE_KEY } from "@/lib/local/store";

/**
 * Pairing, from the barn screen's side (spec §4.4).
 *
 * Two round trips, deliberately not one. `redeemPairingCode` spends the code
 * and mints a device token on the server; only then does the browser trade
 * that token for its own session via `signIn`, the same client-side call
 * `/login` makes. Folding them into one action would work exactly the same
 * way right up until a session could not be established after the code was
 * already spent — and a burned code with no session to show for it is a
 * screen that has to walk back to the house for a second one.
 */
export function PairForm() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);

    const redeemed = await redeemPairingCode(code);
    if (!redeemed.ok) {
      setError(redeemed.error);
      setBusy(false);
      return;
    }

    const result = await signIn("kiosk-device", { token: redeemed.token, redirect: false });
    if (result?.error !== undefined && result.error !== null) {
      setError(
        "Paired, but this screen could not start its session. Ask Settings for a fresh code.",
      );
      setBusy(false);
      return;
    }

    // The paired device's own id, not a fresh browser-generated one — so a
    // kiosk that is re-paired or has its storage cleared resumes under the
    // identity Postgres already knows rather than forking its sync history
    // under a new one (spec §4.2). Read by `apps/web/lib/local/store.ts`'s
    // `deviceId()` the first time anything touches the local store.
    globalThis.localStorage?.setItem(DEVICE_ID_STORAGE_KEY, redeemed.deviceId);

    // A full navigation, not a router push: the session cookie was just set,
    // and the layout past this point reads it server-side.
    window.location.assign("/kiosk");
  }

  return (
    <Card title="Enter the pairing code" className="w-full max-w-sm">
      <form onSubmit={submit} className="flex flex-col gap-density">
        <TextInput
          label="Pairing code"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          autoComplete="off"
          autoCapitalize="characters"
          inputMode="text"
          maxLength={6}
          className="text-center text-2xl tracking-[0.3em]"
          required
        />

        {error === undefined ? null : (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        <Button type="submit" variant="primary" block busy={busy}>
          {busy ? "Pairing…" : "Pair this screen"}
        </Button>
      </form>
    </Card>
  );
}
