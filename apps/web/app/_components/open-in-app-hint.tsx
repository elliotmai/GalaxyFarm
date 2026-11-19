"use client";

import { useEffect, useState } from "react";

import { isRunningInstalled } from "@/lib/install-prompt";
import { isAppleMobile, SHARED_MARK } from "@/lib/share";

/**
 * "This opened in Safari" — for a shared link tapped on an iPhone (spec §8).
 *
 * Android hands a link to the installed app when the app claims its address
 * (the manifest's scope, `handle_links`, `launch_handler`). iOS never does: a
 * link from Messages always opens Safari, and Safari keeps its own sign-in and
 * its own copy of the farm, apart from the home-screen app's. So on an iPhone,
 * for a link somebody shared, this says what to do — copy it, open the app,
 * paste it into Search — with the copy one tap away.
 *
 * Only for shared links (`?shared=1`), and only in Safari rather than in the
 * app: anybody else opening the site in a browser is not asked about an app.
 */
export function OpenInAppHint({ link }: { readonly link?: string | undefined }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);

  const target = (): string => {
    const path = link ?? `${window.location.pathname}${window.location.search}`;
    return new URL(path, window.location.origin).toString();
  };

  useEffect(() => {
    const shared = (link ?? window.location.search).includes(`${SHARED_MARK}=1`);
    setShow(shared && isAppleMobile(navigator) && !isRunningInstalled(window));
  }, [link]);

  if (!show) return null;

  return (
    <div
      role="note"
      aria-label="Open in the app"
      className="mb-density flex flex-col gap-2 rounded-density border border-rule bg-panel p-density text-sm text-ink"
    >
      <p className="m-0">
        <span className="font-semibold">Opened in Safari.</span> iPhone sends links here rather than
        to the app on your home screen. To see this there: copy the link, open the app, and paste it
        into Search.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard
              .writeText(target())
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
          className="inline-flex min-h-target items-center rounded-density bg-action px-4 font-semibold text-action-ink"
        >
          {copied ? "Copied — now open the app" : "Copy link"}
        </button>
        <button
          type="button"
          onClick={() => setShow(false)}
          className="inline-flex min-h-target items-center rounded-density px-3 font-semibold text-muted hover:text-ink"
        >
          Stay in Safari
        </button>
      </div>
    </div>
  );
}
