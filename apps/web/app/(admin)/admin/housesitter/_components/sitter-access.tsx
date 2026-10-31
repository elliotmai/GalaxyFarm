"use client";

import Link from "next/link";

import { useState, useTransition } from "react";

import {
  Button,
  Callout,
  EmptyState,
  Modal,
  Pill,
  Section,
  TextInput,
  useToast,
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
 * One row per sitter — name, the dates, one chip — and the dates are changed
 * in a side panel the row opens, so nothing reflows under a half-typed date.
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

/**
 * The row's one chip. The account's state while it is not usable yet — an
 * invitation outstanding or lapsed is the thing to act on — and the visit's
 * window once it is, because that is the only thing anybody asks after.
 */
function chipFor(row: SitterRow, now: Date): { readonly label: string; readonly tone: Tone } {
  if (row.state !== "active")
    return { label: STATE_LABELS[row.state], tone: STATE_TONES[row.state] };
  return windowState(row.user, now);
}

type Tone = "calm" | "action" | "danger" | "neutral";

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
        detail="Only an owner manages sitter accounts. The guide is on the other tabs."
      />
    );
  }

  /** The state of the one being edited, for the panel's "New link". */
  const editingState =
    editing === undefined ? undefined : sitters.find((row) => row.user.id === editing.id)?.state;

  return (
    <div className="flex flex-col gap-density">
      {unavailable === undefined ? null : <p className="text-sm text-danger">{unavailable}</p>}

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
            Shown once, and it lapses in {INVITATION_DAYS} days. Lost it? Issue a new one.
          </p>
        </Callout>
      )}

      <Section
        title="Sitters"
        description="Outside their window they have no access at all."
        actions={
          <Button variant="primary" onClick={startAdd}>
            <span aria-hidden="true">+</span> Add sitter
          </Button>
        }
      >
        {sitters.length === 0 ? (
          <EmptyState
            title="Nobody has a sitter account"
            detail="They get a link to set a password, and see the guide and today's chores."
            action={<Button onClick={startAdd}>Add one</Button>}
          />
        ) : (
          <ul
            aria-label="Housesitter accounts"
            className="flex flex-col divide-y divide-rule overflow-hidden rounded-density border border-rule bg-panel"
          >
            {sitters.map((row) => {
              const chip = chipFor(row, now);
              return (
                <li key={row.user.id}>
                  <button
                    type="button"
                    onClick={() => startEdit(row.user)}
                    aria-label={`Change ${row.user.name}'s dates`}
                    className="flex min-h-[60px] w-full min-w-0 items-center gap-3 py-2 pl-4 pr-3 text-left text-ink hover:bg-canvas focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-action"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate font-semibold">{row.user.name}</span>
                      <span className="truncate text-sm text-muted">
                        {formatDate(row.user.accessFrom)} → {formatDate(row.user.accessTo)} ·{" "}
                        {row.user.email}
                      </span>
                    </span>
                    <Pill tone={chip.tone}>{chip.label}</Pill>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-density text-sm text-muted">
          Switch off, delete or change role in{" "}
          <Link className="text-action underline" href="/admin/settings">
            Settings
          </Link>
          .
        </p>
      </Section>

      {draft === undefined ? null : (
        <Modal
          placement="side"
          title={editing === undefined ? "Add a sitter" : `${editing.name}'s visit`}
          description="A start and an end — both are required."
          onClose={() => {
            setDraft(undefined);
            setEditing(undefined);
            setErrors({});
          }}
          footer={
            <div className="flex w-full flex-wrap gap-2">
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
              {/* Here rather than on the row: it is needed once per lapsed
                  invitation, and a second button per row is a second target. */}
              {editing === undefined ||
              editingState === undefined ||
              editingState === "active" ? null : (
                <Button
                  variant="ghost"
                  className="ml-auto"
                  busy={pending}
                  onClick={() => resend(editing)}
                >
                  New link
                </Button>
              )}
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
                  ? undefined
                  : "Cannot be changed — issue a new invitation instead."
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
              <p className="text-sm text-muted">Your own account — only the dates move.</p>
            ) : null}
          </div>
        </Modal>
      )}
    </div>
  );
}
