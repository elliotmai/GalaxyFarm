"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

import { Button, Card, TextInput } from "@galaxy-farm/ui";

/**
 * The sign-in form.
 *
 * One failure message for every way the *credentials* can fail, matching what
 * the server already does: a form that says "no such account" for one address
 * and "wrong password" for another is a way to ask who has an account here,
 * and for a boarding business that is a customer list.
 *
 * The server being unable to answer is a different failure, and it gets its
 * own message. `authorize` returns null for every credential refusal, which
 * Auth.js reports as `CredentialsSignin`; anything it throws — the database
 * refusing a query, a dropped connection — comes back as `Configuration`.
 * That says nothing about any account, so naming it leaks nothing, and telling
 * someone their saved password is wrong when the database is down sends them
 * off to reset a password that was fine.
 */
type Failure = "credentials" | "unavailable";
export function LoginForm({ next }: { readonly next: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [failed, setFailed] = useState<Failure | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailed(undefined);

    let error: string | null | undefined;
    try {
      const result = await signIn("credentials", { email, password, redirect: false });
      error = result?.error;
    } catch {
      // No answer at all: offline, or the request never reached the server.
      error = "unreachable";
    }

    if (error !== undefined && error !== null) {
      setFailed(error === "CredentialsSignin" ? "credentials" : "unavailable");
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

        {failed === "credentials" ? (
          <p role="alert" className="text-sm text-danger">
            That email and password do not match an account.
          </p>
        ) : null}
        {failed === "unavailable" ? (
          <p role="alert" className="text-sm text-danger">
            Sign-in is not working right now — this is on our end, not your password. Try again in a
            few minutes.
          </p>
        ) : null}

        <Button type="submit" variant="primary" block busy={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </Card>
  );
}
