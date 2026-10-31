import { redirect } from "next/navigation";

import { AuthShell } from "@/app/(public)/_components/public-shell";

import { LoginForm } from "./login-form";
import { FALLBACK_FARM_NAME } from "@galaxy-farm/core";

export const metadata = { title: "Sign In" };

/**
 * Whether a visitor was headed for a barn screen's surface.
 *
 * The distinction matters because of what `/login` costs a wall-mounted
 * tablet. This page renders on the **public** surface, whose `PwaShell` is not
 * `unattended` — so a waiting build is offered on a bar somebody has to tap,
 * and on a screen screwed to a barn wall nobody ever does. A kiosk that lands
 * here is therefore pinned to whatever build it was running, permanently:
 * every later fix installs, waits, and is never applied. That is the README's
 * "a new build never strands a screen" failing on the one page a stranded
 * screen actually reaches.
 *
 * So a kiosk-bound visitor is not shown this page at all. `/kiosk/pair` is
 * where they belong anyway — it signs a paired screen back in from the token
 * it holds (spec §4.4), and it is on the kiosk surface, which applies a
 * waiting build by itself.
 */
function boundForAKioskScreen(next: string): boolean {
  return next === "/kiosk" || next.startsWith("/kiosk/");
}

/**
 * `next` comes from the middleware, which puts it there when it turns someone
 * away — so signing in lands them where they were going rather than on a
 * dashboard they then navigate away from.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requested = typeof params["next"] === "string" ? params["next"] : "/admin";

  // Only a path on this site. An open redirect on a login page hands an
  // attacker a link that looks like ours and lands somewhere that is not.
  const next = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/admin";

  /**
   * `as=person` is the way back for the one visitor this would otherwise
   * strand: an owner on a laptop who followed a bookmark to a kiosk board.
   * `/kiosk/pair` offers it as a link, so the escape exists without this page
   * having to guess whether the thing in front of it has a keyboard.
   */
  if (params["as"] !== "person" && boundForAKioskScreen(next)) {
    redirect(`/kiosk/pair?next=${encodeURIComponent(next)}`);
  }

  // A BrandingConfig value (§5.1), never a literal. Reads from the environment
  // until the settings store is wired, so there is still one place to change it.
  const farmName = process.env["NEXT_PUBLIC_FARM_NAME"] ?? FALLBACK_FARM_NAME;

  return (
    <AuthShell farmName={farmName} footer="No public sign-up — the farm creates accounts.">
      <LoginForm next={next} />
    </AuthShell>
  );
}
