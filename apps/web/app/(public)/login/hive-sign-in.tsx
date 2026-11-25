"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";

/**
 * Sign in with Hive (spec §4.3, "From Hive, as a person").
 *
 * Signed in to Hive (the household's home screen), you are signed in here
 * without typing anything. Hive vouches with a two-minute pass made for this
 * app only, which the `hive-pass` provider (lib/auth.ts) turns into an
 * ordinary session for the account with the same confirmed email.
 *
 * - Inside Hive's frame, the page asks Hive's window for one (postMessage,
 *   answered only to this site's own address).
 * - On its own, once per visit, it steps over to Hive's /api/hive/hop for a
 *   moment, which comes straight back with `#hive-pass=<pass>` when Hive is
 *   signed in and `#hive-pass=` when it is not. Not in the installed app:
 *   it keeps its own sign-in, apart from the browser's, so Hive's could not
 *   be seen from there anyway.
 *
 * Nobody signed in to Hive, or no account here for them: nothing happens and
 * the form below is the way in, as before.
 */
export const HIVE_ORIGIN = "https://hive.flyingdoublemranch.com";
const HOPPED = "galaxyfarm.hiveHop";
const SITE = "https://flyingdoublemranch.com";

const session = {
  get(): string | null {
    try {
      return window.sessionStorage.getItem(HOPPED);
    } catch {
      return null;
    }
  },
  set(): boolean {
    try {
      window.sessionStorage.setItem(HOPPED, "1");
      return window.sessionStorage.getItem(HOPPED) === "1";
    } catch {
      return false;
    }
  },
};

/** The pass in a `#hive-pass=` fragment: the pass, "" for none, undefined when absent. */
export function passFromHash(hash: string): string | undefined {
  const match = /(?:^#|&)hive-pass=([^&]*)/.exec(hash);
  if (match === null) return undefined;
  try {
    return decodeURIComponent(match[1] ?? "");
  } catch {
    return "";
  }
}

export function HiveSignIn({ next }: { readonly next: string }) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let done = false;
    async function trade(pass: string) {
      if (done) return;
      done = true;
      setBusy(true);
      const result = await signIn("hive-pass", { pass, redirect: false }).catch(() => undefined);
      if (result !== undefined && (result.error === undefined || result.error === null)) {
        // As the form does: a full navigation, so the new cookie is seen.
        window.location.assign(next);
        return;
      }
      setBusy(false);
    }

    if (window.parent !== window) {
      const onMessage = (event: MessageEvent) => {
        if (event.origin !== HIVE_ORIGIN || event.source !== window.parent) return;
        const data = event.data as { type?: unknown; pass?: unknown } | null;
        if (data?.type === "hive:pass" && typeof data.pass === "string") void trade(data.pass);
      };
      window.addEventListener("message", onMessage);
      window.parent.postMessage({ type: "hive:hello", v: 1 }, HIVE_ORIGIN);
      return () => window.removeEventListener("message", onMessage);
    }

    const fromHop = passFromHash(window.location.hash);
    if (fromHop !== undefined) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      if (fromHop !== "") void trade(fromHop);
      return undefined;
    }

    // Only from the real address (Hive's catalog): the hop sends a pass back to nowhere else.
    if (window.location.origin !== SITE) return undefined;
    if (window.matchMedia?.("(display-mode: standalone)").matches) return undefined;
    if (session.get() !== null || !session.set()) return undefined; // once a visit; no storage, no risk of a loop
    const back = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    window.location.replace(
      `${HIVE_ORIGIN}/api/hive/hop?app=galaxyfarm&return=${encodeURIComponent(back)}`,
    );
    return undefined;
  }, [next]);

  return busy ? (
    <p role="status" className="text-sm text-muted">
      Signing you in with Hive…
    </p>
  ) : null;
}
