"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

import { Button, Card, TextInput } from "@galaxy-farm/ui";

/**
 * The sign-in form.
 *
 * One failure message for every way this can fail, matching what the server
 * already does: a form that says "no such account" for one address and "wrong
 * password" for another is a way to ask who has an account here, and for a
 * boarding business that is a customer list.
 */
export function LoginForm({ next }: { readonly next: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailed(false);

    const result = await signIn("credentials", { email, password, redirect: false });

    if (result?.error !== undefined && result.error !== null) {
      setFailed(true);
      setBusy(false);
      return;
    }

    // A full navigation rather than a router push: the session cookie was just
    // set, and every server component past this point needs to see it.
    window.location.assign(next);
  }

  return (
    <Card title="Sign in" className="w-full max-w-sm">
      <form onSubmit={submit} className="flex flex-col gap-density">
        <TextInput
          label="Email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <TextInput
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />

        {failed ? (
          <p role="alert" className="text-sm text-danger">
            That email and password do not match an account.
          </p>
        ) : null}

        <Button type="submit" variant="primary" block busy={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </Card>
  );
}
