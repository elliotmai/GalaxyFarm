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

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <LoginForm next={next} />
    </main>
  );
}
