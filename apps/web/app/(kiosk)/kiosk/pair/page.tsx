import { FALLBACK_FARM_NAME } from "@galaxy-farm/core";
import { Logomark } from "@galaxy-farm/ui";

import { PairForm } from "@/app/(kiosk)/kiosk/pair/pair-form";
import { ResumeScreen } from "@/app/(kiosk)/kiosk/pair/resume-screen";
import { heldDeviceToken } from "@/lib/kiosk-session";

export const metadata = { title: "Pair This Screen" };

/**
 * Getting a barn screen a session (spec §4.4).
 *
 * The only page under `/kiosk` a signed-out visitor can reach — `middleware.ts`
 * carries a matching exception for exactly this path, because this is how a
 * screen gets a session in the first place. It answers two different questions
 * depending on what the device is already holding:
 *
 *   - **A screen that has never been paired** gets the code form. Read once,
 *     from across a barn, by whoever is holding the code from Settings.
 *   - **A screen that has been paired** gets its session back on its own,
 *     from the device token it kept. It is the same page because it is the
 *     same question — "how does this screen prove who it is" — and because a
 *     resume that fails for good has to land on the form anyway.
 *
 * This is where a signed-out kiosk is sent, in place of `/login`. A login form
 * is a dead end on a screen with no keyboard and no account behind it: every
 * lapsed session used to mean somebody walking out with a fresh code.
 */

/** Only ever back to where the middleware turned this screen away from. */
function safeNext(requested: string | string[] | undefined): string {
  if (typeof requested !== "string") return "/kiosk";
  if (requested !== "/kiosk" && !requested.startsWith("/kiosk/")) return "/kiosk";
  // `/kiosk/pair` would be a loop, and pairing is not somewhere to land.
  return requested.startsWith("/kiosk/pair") ? "/kiosk" : requested;
}

export default async function KioskPairPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeNext(params["next"]);
  const paired = (await heldDeviceToken()) !== undefined;

  const farmName = process.env["NEXT_PUBLIC_FARM_NAME"] ?? FALLBACK_FARM_NAME;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-density p-6">
      <div className="flex flex-col items-center gap-2">
        <Logomark size="large" decorative />
        <h1 className="text-ink">{farmName}</h1>
        <p className="text-muted">{paired ? "Reconnecting" : "Pair this screen"}</p>
      </div>

      {paired ? <ResumeScreen next={next} /> : <PairForm />}

      {paired ? null : (
        <p className="max-w-sm text-center text-sm text-muted">
          Get a code from Settings → Kiosk devices on any signed-in phone or laptop, then type it in
          above. The code is good for fifteen minutes and works once.
        </p>
      )}
    </div>
  );
}
