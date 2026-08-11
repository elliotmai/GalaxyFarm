import { Logomark } from "@galaxy-farm/ui";

import { LoginForm } from "./login-form";

export const metadata = { title: "Sign In" };

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

  // A BrandingConfig value (§5.1), never a literal. Reads from the environment
  // until the settings store is wired, so there is still one place to change it.
  const farmName = process.env["NEXT_PUBLIC_FARM_NAME"] ?? "Galaxy Farm";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-density p-6">
      <div className="flex flex-col items-center gap-2">
        <Logomark size="large" decorative />
        <h1 className="font-heading text-2xl font-semibold text-ink">{farmName}</h1>
      </div>

      <LoginForm next={next} />

      <p className="max-w-sm text-center text-sm text-muted">
        Accounts are created by the farm owner — there is no public sign-up.
      </p>
    </main>
  );
}
