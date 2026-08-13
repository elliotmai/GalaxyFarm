"use client";

import Link from "next/link";

import { useState, useTransition } from "react";

import {
  Badge,
  Button,
  Callout,
  Card,
  DataTable,
  EmptyState,
  Modal,
  Section,
  TextInput,
  useToast,
  type Column,
} from "@galaxy-farm/ui";
import { INVITATION_DAYS, type AccountState, type Ulid, type User } from "@galaxy-farm/core";

import {
  editPerson,
  invitePerson,
  resendInvitation,
  type ActionResult,
} from "@/app/(admin)/admin/settings/_components/user-actions";

/**
 * Who may read the guide, and until when (spec §4.3, §7).
 *
 * A housesitter account is time-boxed by rule, not by convention: §4.3 refuses
 * to save one without a start and an end, because access that never lapses is
 * not a visit. This screen exists so that setting the window is part of going
 * away rather than a detour into settings — but it is the same server actions
 * and the same refusals underneath, so the rule cannot be routed around by
 * coming in through this door.
 *
 * Nothing here reads from the device. `users` is the one entity §4.3 keeps off
 * them entirely.
 */

const STATE_LABELS: Readonly<Record<AccountState, string>> = {
  active: "Signed up",
  invited: "Invited",
  "invitation-expired": "Invitation lapsed",
  deactivated: "Switched off",
};

const STATE_TONES: Readonly<Record<AccountState, "calm" | "action" | "danger" | "neutral">> = {
  active: "calm",
  invited: "action",
  "invitation-expired": "danger",
  deactivated: "neutral",
};

export interface SitterRow {
  readonly user: User;
  readonly state: AccountState;
}

interface Draft {
  readonly name: string;
  readonly email: string;
  readonly accessFrom: string;
  readonly accessTo: string;
}

const BLANK: Draft = { name: "", email: "", accessFrom: "", accessTo: "" };

const dateInput = (value: Date | undefined): string =>
  value === undefined ? "" : value.toISOString().slice(0, 10);

const formatDate = (value: Date | undefined): string =>
  value === undefined
    ? "—"
    : value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** Open now, opening later, or already closed — the only thing anybody asks. */
function windowState(
  user: User,
  now: Date,
): { readonly label: string; readonly tone: "calm" | "action" | "neutral" } {
  const { accessFrom, accessTo } = user;
  if (accessFrom === undefined || accessTo === undefined) {
    return { label: "No window", tone: "neutral" };
  }
  if (accessTo < now) return { label: "Closed", tone: "neutral" };
  if (accessFrom > now) return { label: "Opens later", tone: "action" };
  return { label: "Open now", tone: "calm" };
}

export function SitterAccess({
  sitters,
  mayManagePeople,
  actorId,
  unavailable,
}: {
  readonly sitters: readonly SitterRow[];
  readonly mayManagePeople: boolean;
  readonly actorId: Ulid;
  readonly unavailable?: string | undefined;
}) {
  const { show } = useToast();
  const [pending, startTransition] = useTransition();

  const [draft, setDraft] = useState<Draft | undefined>();
  const [editing, setEditing] = useState<User | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** Shown once and never again: only the token's hash is kept. */
  const [link, setLink] = useState<string | undefined>();

  const now = new Date();

  function handle(result: ActionResult) {
    if (!result.ok) {
      // §4.5 clause 2: on the field where there is one to put it on.
      setErrors(
        result.field === undefined ? { form: result.error } : { [result.field]: result.error },
      );
      return;
    }

    setErrors({});
    setDraft(undefined);
    setEditing(undefined);
    if (result.link !== undefined) setLink(result.link);
    show({ message: result.message, tone: "success" });
  }

  function startAdd() {
    setEditing(undefined);
    setDraft(BLANK);
    setErrors({});
  }

  function startEdit(user: User) {
    setEditing(user);
    setDraft({
      name: user.name,
      email: user.email,
      accessFrom: dateInput(user.accessFrom),
      accessTo: dateInput(user.accessTo),
    });
    setErrors({});
  }

  function submit() {
    if (draft === undefined) return;

    startTransition(async () => {
      const result =
        editing === undefined
          ? await invitePerson({
              name: draft.name,
              email: draft.email,
              role: "housesitter",
              accessFrom: draft.accessFrom,
              accessTo: draft.accessTo,
            })
          : await editPerson(editing.id, {
              name: draft.name,
              role: "housesitter",
              accessFrom: draft.accessFrom,
              accessTo: draft.accessTo,
            });

      handle(result);
    });
  }

  function resend(user: User) {
    startTransition(async () => handle(await resendInvitation(user.id)));
  }

  if (!mayManagePeople) {
    return (
      <EmptyState
        title="Owner-only"
        detail="Accounts are managed by an owner (§4.3). The guide itself is on the tabs beside this one, and everybody with an admin sign-in can read it."
      />
    );
  }

  const columns: readonly Column<SitterRow>[] = [
    {
      key: "name",
      header: "Who",
      render: (row) => (
        <span className="flex flex-col">
          <span className="text-ink">{row.user.name}</span>
          <span className="text-sm text-muted">{row.user.email}</span>
        </span>
      ),
    },
    {
      key: "state",
      header: "Account",
      render: (row) => <Badge tone={STATE_TONES[row.state]}>{STATE_LABELS[row.state]}</Badge>,
    },
    {
      key: "window",
      header: "Visit",
      render: (row) => {
        const state = windowState(row.user, now);
        return (
          <span className="flex flex-col">
            <Badge tone={state.tone}>{state.label}</Badge>
            <span className="text-sm text-muted">
              {formatDate(row.user.accessFrom)} → {formatDate(row.user.accessTo)}
            </span>
          </span>
        );
      },
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <span className="flex gap-2">
          <Button variant="ghost" onClick={() => startEdit(row.user)}>
            Change dates
          </Button>
          {row.state === "active" ? null : (
            <Button variant="ghost" busy={pending} onClick={() => resend(row.user)}>
              New link
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-density">
      {unavailable === undefined ? null : (
        <Callout tone="danger" title="The sitter list is not here">
          {unavailable}
        </Callout>
      )}

      {link === undefined ? null : (
        <Callout
          tone="action"
          title="Send them this link"
          actions={
            <Button
              onClick={() => {
                void globalThis.navigator?.clipboard?.writeText(link);
                show({ message: "Copied" });
              }}
            >
              Copy
            </Button>
          }
        >
          <p className="break-all font-mono text-sm">{link}</p>
          <p className="mt-2 text-sm">
            Shown once — only its hash is kept, so the only way to see it again is to issue a new
            one. It lapses in {INVITATION_DAYS} days.
          </p>
        </Callout>
      )}

      <Section
        title="Sitters"
        description="Time-boxed by rule. Outside their window they have no access at all — not a reduced one."
        actions={
          <Button variant="primary" onClick={startAdd}>
            Add a sitter
          </Button>
        }
      >
        {sitters.length === 0 ? (
          <EmptyState
            title="Nobody has a sitter account"
            detail="Adding one sends a link they use to set their own password. They see the guide and today's chores, and nothing else."
            action={<Button onClick={startAdd}>Add one</Button>}
          />
        ) : (
          <Card>
            <DataTable
              caption="Housesitter accounts"
              columns={columns}
              rows={[...sitters]}
              rowKey={(row) => row.user.id}
            />
          </Card>
        )}

        <p className="mt-density text-sm text-muted">
          Switching an account off, deleting it, or changing somebody&rsquo;s role happens in{" "}
          <Link className="text-action underline" href="/admin/settings">
            Settings
          </Link>
          , alongside everybody else&rsquo;s.
        </p>
      </Section>

      {draft === undefined ? null : (
        <Modal
          title={editing === undefined ? "Add a sitter" : `${editing.name}'s visit`}
          description="A start and an end. §4.3 refuses to save a sitter without both — access that never lapses is not a visit."
          onClose={() => {
            setDraft(undefined);
            setEditing(undefined);
            setErrors({});
          }}
          footer={
            <div className="flex gap-2">
              <Button variant="primary" busy={pending} onClick={submit}>
                {editing === undefined ? "Send an invitation" : "Save dates"}
              </Button>
              <Button
                onClick={() => {
                  setDraft(undefined);
                  setEditing(undefined);
                }}
              >
                Cancel
              </Button>
            </div>
          }
        >
          <div className="flex flex-col gap-density">
            {errors["form"] === undefined ? null : (
              <p className="text-sm text-danger">{errors["form"]}</p>
            )}
            <TextInput
              label="Name"
              required
              value={draft.name}
              error={errors["name"]}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
            <TextInput
              label="Email"
              type="email"
              required
              disabled={editing !== undefined}
              hint={
                editing === undefined
                  ? "Where the invitation goes. They choose their own password."
                  : "An address cannot be changed here — issue a new invitation instead."
              }
              value={draft.email}
              error={errors["email"]}
              onChange={(event) => setDraft({ ...draft, email: event.target.value })}
            />
            <div className="grid grid-cols-1 gap-density sm:grid-cols-2">
              <TextInput
                label="From"
                type="date"
                required
                value={draft.accessFrom}
                error={errors["accessFrom"]}
                onChange={(event) => setDraft({ ...draft, accessFrom: event.target.value })}
              />
              <TextInput
                label="Until"
                type="date"
                required
                value={draft.accessTo}
                error={errors["accessTo"]}
                onChange={(event) => setDraft({ ...draft, accessTo: event.target.value })}
              />
            </div>
            {editing?.id === actorId ? (
              <p className="text-sm text-muted">
                This is your own account. You cannot change your own role, so only the dates move.
              </p>
            ) : null}
          </div>
        </Modal>
      )}
    </div>
  );
}
