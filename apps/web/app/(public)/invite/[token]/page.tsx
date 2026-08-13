import Link from "next/link";

import { Card, Logomark } from "@galaxy-farm/ui";

import { InviteForm } from "@/app/(public)/invite/[token]/invite-form";
import { classifyDatabaseFailure } from "@/lib/database-failure";
import { withDeadline } from "@/lib/deadline";
import { findPendingInvitation, type PendingInvitation } from "@/lib/user-store";

export const metadata = { title: "Set your password" };

/**
 * `/invite/[token]` — the one page somebody uses before they have an account
 * they can sign in to (spec §4.3, §7).
 *
 * Public by necessity and ungated by the middleware, which is why the token
 * does all the work: 256 bits from the system CSPRNG, stored only as a hash,
 * good once, and gone after a week.
 *
 * A bad link gets the same page as a spent one and an expired one. Telling
 * them apart would let anyone holding a URL learn whether it was ever real,
 * and this page is reachable by anybody.
 *
 * A database that cannot be answered is the one case that gets its own
 * message, and it is not a leak: it says something about us rather than about
 * the token. It matters because the two need opposite responses — "ask for a
 * new link" is wrong advice when the link is fine and the server is not.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let invitation: PendingInvitation | undefined;
  let unreachable: string | undefined;

  try {
    invitation = await withDeadline(
      findPendingInvitation(decodeURIComponent(token), new Date()),
      "the invitation lookup",
    );
  } catch (error) {
    console.error("[invite:lookup]", error);
    // Said in whichever of the four ways it actually failed. None of it is a
    // leak: it describes us, not the token, and somebody holding a URL learns
    // nothing about whether it was ever real.
    unreachable = classifyDatabaseFailure(error).message;
  }

  const farmName = process.env["NEXT_PUBLIC_FARM_NAME"] ?? "Galaxy Farm";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-density p-6">
      <div className="flex flex-col items-center gap-2">
        <Logomark size="large" decorative />
        <h1 className="font-heading text-2xl font-semibold text-ink">{farmName}</h1>
      </div>

      {unreachable !== undefined ? (
        <Card title="Cannot check that link right now" className="w-full max-w-sm">
          <p className="text-density text-ink">
            Your link is probably fine — this is something at our end. Try again in a few minutes
            before asking for another.
          </p>
          <p className="mt-density text-sm text-muted">{unreachable}</p>
        </Card>
      ) : invitation === undefined ? (
        <Card title="This link does not work" className="w-full max-w-sm">
          <p className="text-density text-ink">
            Invitations last a week and can only be used once. If yours has lapsed — or you have
            already set a password — ask the farm for a new link.
          </p>
          <Link
            href="/login"
            className="mt-density inline-block text-action underline underline-offset-2"
          >
            Go to sign in
          </Link>
        </Card>
      ) : (
        <InviteForm token={token} name={invitation.name} />
      )}
    </main>
  );
}
