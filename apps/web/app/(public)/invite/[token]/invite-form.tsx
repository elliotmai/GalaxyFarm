"use client";

import Link from "next/link";
import { useState } from "react";

import { Button, Card, TextInput } from "@galaxy-farm/ui";
import { MINIMUM_PASSWORD_LENGTH } from "@galaxy-farm/core";

import { acceptInvite } from "@/app/(public)/invite/[token]/accept";

/**
 * Choosing a password from an invitation.
 *
 * Two boxes rather than one, because there is no way back from a typo here:
 * they cannot sign in to fix it, and the only remedy is asking the farm for
 * another link. The confirmation is checked in the browser — it is a typo
 * guard rather than a security control, and the server has no business
 * receiving a second copy of the password to compare.
 */
export function InviteForm({ token, name }: { readonly token: string; readonly name: string }) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);

    if (password !== again) {
      setError("Those two do not match.");
      return;
    }

    setBusy(true);
    const result = await acceptInvite(token, password);
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setDone(true);
  }

  if (done) {
    return (
      <Card title="You are set up" className="w-full max-w-sm">
        <p className="text-density text-ink">
          Your password is saved. Sign in with it and your email address.
        </p>
        <Link
          href="/login"
          className="mt-density inline-block text-action underline underline-offset-2"
        >
          Go to sign in
        </Link>
      </Card>
    );
  }

  return (
    <Card title={`Welcome, ${name}`} className="w-full max-w-sm">
      <form onSubmit={submit} className="flex flex-col gap-density">
        <p className="text-sm text-muted">
          Choose a password. Nobody at the farm sees it — this link is the only way to set it, and
          it stops working once you do.
        </p>

        <TextInput
          label="Password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          hint={`At least ${MINIMUM_PASSWORD_LENGTH} characters. A phrase you will remember beats a word you will not.`}
          required
        />
        <TextInput
          label="Type it again"
          type="password"
          autoComplete="new-password"
          value={again}
          onChange={(event) => setAgain(event.target.value)}
          required
        />

        {error === undefined ? null : (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        <Button type="submit" variant="primary" block busy={busy}>
          {busy ? "Saving…" : "Set my password"}
        </Button>
      </form>
    </Card>
  );
}
