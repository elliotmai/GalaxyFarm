import Link from "next/link";

import { Card } from "@galaxy-farm/ui";

import { AuthShell } from "@/app/(public)/_components/public-shell";

import { InviteForm } from "@/app/(public)/invite/[token]/invite-form";
import { withDeadline } from "@/lib/deadline";
import { findPendingInvitation, type PendingInvitation } from "@/lib/user-store";
import { FALLBACK_FARM_NAME } from "@galaxy-farm/core";

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
  let unreachable = false;

  try {
    invitation = await withDeadline(
      findPendingInvitation(decodeURIComponent(token), new Date()),
      "the invitation lookup",
    );
  } catch (error) {
    console.error("[invite:lookup]", error);
    unreachable = true;
  }

  const farmName = process.env["NEXT_PUBLIC_FARM_NAME"] ?? FALLBACK_FARM_NAME;

  return (
    <AuthShell farmName={farmName}>
      {unreachable ? (
        <Card title="Cannot check that link right now" className="w-full">
          <p className="text-density text-ink">
            Something at our end is not answering. Your link is probably fine — try again in a few
            minutes before asking for another.
          </p>
        </Card>
      ) : invitation === undefined ? (
        <Card title="This link does not work" className="w-full">
          <p className="text-density text-ink">
            Invitations last a week and work once. If yours has lapsed — or you already set a
            password — ask the farm for a new link.
          </p>
          <Link
            href="/login"
            className="mt-density inline-flex min-h-target items-center font-semibold text-action underline-offset-4 hover:underline"
          >
            Go to sign in
          </Link>
        </Card>
      ) : (
        <InviteForm token={token} name={invitation.name} />
      )}
    </AuthShell>
  );
}
