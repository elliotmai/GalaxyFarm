"use client";

import { useState, useTransition } from "react";

import {
  Badge,
  Button,
  Callout,
  Card,
  DataTable,
  EmptyState,
  Modal,
  Pill,
  Section,
  Select,
  TextInput,
  useConfirmDelete,
  useToast,
  type Column,
} from "@galaxy-farm/ui";
import {
  INVITATION_DAYS,
  ROLES,
  type AccountState,
  type Role,
  type Ulid,
  type User,
} from "@galaxy-farm/core";

import {
  deletePerson,
  editPerson,
  invitePerson,
  resendInvitation,
  restorePerson,
  setPersonActive,
  type ActionResult,
} from "@/app/(admin)/admin/settings/_components/user-actions";

/**
 * The people on the farm (spec §4.3, §7 `/admin/settings`).
 *
 * The one screen in this app that does not read from the device. `users`
 * carries password hashes and invitation tokens, so §4.3 keeps the table off
 * devices entirely and the server refuses to sync it by name — which means
 * everything here goes through a server action and the page re-reads
 * afterwards. Slower than the rest of the app, and correct: this is a screen
 * somebody opens twice a year from the house, not one they use in a barn.
 *
 * Adding somebody never sets their password. The account is created without
 * one and carries a single-use link instead; they choose their own on the way
 * in. The link is shown exactly once, because only its hash is kept.
 */

const ROLE_LABELS: Readonly<Record<Role, string>> = {
  owner: "Owner — everything, including managing people",
  member: "Member — full records, no people or purging",
  customer: "Customer — their own animals only",
  housesitter: "Housesitter — care guide and chores, for a set window",
  kiosk: "Kiosk — a barn screen rather than a person",
};

/**
 * A kiosk is provisioned by pairing (spec §4.4, Settings → Kiosk devices), not
 * by an emailed invitation — a barn screen has no inbox to send one to, and
 * `kioskDevices` carries its own token, never a password. `kiosk` stays a
 * `Role` (§4.3's capability table still needs it) and stays a key in every map
 * above (TypeScript requires the coverage) — it is only missing from the
 * dropdown a person is invited through.
 */
const INVITABLE_ROLES = ROLES.filter((role) => role !== "kiosk");

const ROLE_SHORT: Readonly<Record<Role, string>> = {
  owner: "Owner",
  member: "Member",
  customer: "Customer",
  housesitter: "Housesitter",
  kiosk: "Kiosk",
};

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

export interface PersonRow {
  readonly user: User;
  readonly state: AccountState;
}

interface Draft {
  readonly name: string;
  readonly email: string;
  readonly role: Role;
  readonly accessFrom: string;
  readonly accessTo: string;
}

const BLANK: Draft = { name: "", email: "", role: "member", accessFrom: "", accessTo: "" };

const dateInput = (value: Date | undefined): string =>
  value === undefined ? "" : value.toISOString().slice(0, 10);

const formatDate = (value: Date | undefined): string =>
  value === undefined
    ? "—"
    : value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export function PeopleScreen({
  people,
  deleted,
  actorId,
  unavailable,
}: {
  readonly people: readonly PersonRow[];
  readonly deleted: readonly PersonRow[];
  readonly actorId: Ulid;
  /** Set when the database could not be reached, so the list is not the truth. */
  readonly unavailable?: string | undefined;
}) {
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();
  const [pending, startTransition] = useTransition();

  const [editing, setEditing] = useState<PersonRow | undefined>();
  const [draft, setDraft] = useState<Draft | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});

  /**
   * The one thing on this screen that cannot be looked up again.
   *
   * Held in state rather than toasted, because a toast disappears after five
   * seconds and this is the only time the link exists — the row keeps a hash
   * of it and nothing else.
   */
  const [link, setLink] = useState<
    { readonly url: string; readonly message: string } | undefined
  >();

  function run(action: () => Promise<ActionResult>, onDone?: () => void) {
    startTransition(async () => {
      const result = await action();

      if (!result.ok) {
        if (result.field === undefined) show({ message: result.error, tone: "danger" });
        else setErrors({ [result.field]: result.error });
        return;
      }

      setErrors({});
      if (result.link === undefined) show({ message: result.message, tone: "success" });
      else setLink({ url: result.link, message: result.message });
      onDone?.();
    });
  }

  function startInvite() {
    setEditing(undefined);
    setDraft(BLANK);
    setErrors({});
  }

  function startEdit(row: PersonRow) {
    setEditing(row);
    setDraft({
      name: row.user.name,
      email: row.user.email,
      role: row.user.role,
      accessFrom: dateInput(row.user.accessFrom),
      accessTo: dateInput(row.user.accessTo),
    });
    setErrors({});
  }

  function save() {
    if (draft === undefined) return;

    if (editing === undefined) {
      run(
        () =>
          invitePerson({
            name: draft.name,
            email: draft.email,
            role: draft.role,
            accessFrom: draft.accessFrom,
            accessTo: draft.accessTo,
          }),
        () => setDraft(undefined),
      );
      return;
    }

    run(
      () =>
        editPerson(editing.user.id, {
          name: draft.name,
          role: draft.role,
          accessFrom: draft.accessFrom,
          accessTo: draft.accessTo,
        }),
      () => {
        setDraft(undefined);
        setEditing(undefined);
      },
    );
  }

  async function remove(row: PersonRow) {
    const confirmed = await confirmDelete({
      // Typed tier: a person is an aggregate root, and everything they did on
      // this farm — every treatment logged, every chore ticked — names them by
      // id (§4.5 clause 3).
      tier: "typed",
      recordName: row.user.name,
      entity: "person",
      dependents: [
        {
          entity: "History",
          label: "Everything they recorded, and every chore they ticked off",
          effect: "detached",
        },
      ],
      consequence:
        "The account stops working immediately and any invitation with it. What they recorded stays, still under their name, and the account can be restored below.",
    });
    if (!confirmed) return;

    run(() => deletePerson(row.user.id), undefined);
  }

  /**
   * Issue a fresh link.
   *
   * Confirmed when there is a password to lose. §4.5 clause 3 covers the
   * irreversible non-deletes as well as the deletes, and this is one: the
   * password they have been using stops working the moment this returns, and
   * the only way back is the link that comes out of it. For somebody who never
   * accepted there is nothing to lose, so it just runs.
   */
  async function reissue(row: PersonRow) {
    if (row.state === "active") {
      const confirmed = await confirmDelete({
        tier: "elevated",
        recordName: row.user.name,
        entity: "password",
        action: "Reset it",
        dependents: [],
        consequence:
          "Their current password stops working straight away, and they cannot sign in until they have used the new link. You will need to get it to them.",
      });
      if (!confirmed) return;
    }

    run(() => resendInvitation(row.user.id));
  }

  const columns: readonly Column<PersonRow>[] = [
    {
      key: "person",
      header: "Person",
      render: (row) => (
        <span className="flex flex-col gap-0.5">
          <span className="text-ink">
            {row.user.name}
            {row.user.id === actorId ? (
              <span className="ml-2 text-sm text-muted">(you)</span>
            ) : null}
          </span>
          <span className="text-sm text-muted">{row.user.email}</span>
        </span>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (row) => <Badge tone="neutral">{ROLE_SHORT[row.user.role]}</Badge>,
    },
    {
      key: "state",
      header: "Account",
      render: (row) => (
        <span className="flex flex-col gap-1">
          <Pill tone={STATE_TONES[row.state]} dot={row.state === "invitation-expired"}>
            {STATE_LABELS[row.state]}
          </Pill>
          {row.state === "invited" && row.user.inviteExpiresAt !== undefined ? (
            <span className="text-sm text-muted">
              Link good until {formatDate(row.user.inviteExpiresAt)}
            </span>
          ) : null}
          {row.state === "active" ? (
            <span className="text-sm text-muted">
              {row.user.lastSignedInAt === undefined
                ? "Never signed in"
                : `Last in ${formatDate(row.user.lastSignedInAt)}`}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "window",
      header: "Access window",
      render: (row) =>
        row.user.role !== "housesitter" ? (
          <span className="text-muted">—</span>
        ) : (
          <span className="text-sm text-ink">
            {formatDate(row.user.accessFrom)} → {formatDate(row.user.accessTo)}
          </span>
        ),
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <span className="flex flex-wrap gap-2">
          <Button variant="ghost" disabled={pending} onClick={() => void reissue(row)}>
            {row.state === "active" ? "Reset password" : "New link"}
          </Button>
          <Button variant="ghost" disabled={pending} onClick={() => startEdit(row)}>
            Edit
          </Button>
          <Button
            variant="ghost"
            disabled={pending || row.user.id === actorId}
            onClick={() => run(() => setPersonActive(row.user.id, !row.user.active))}
          >
            {row.user.active ? "Switch off" : "Switch on"}
          </Button>
          <Button
            variant="ghost"
            disabled={pending || row.user.id === actorId}
            onClick={() => void remove(row)}
          >
            Delete
          </Button>
        </span>
      ),
    },
  ];

  const housesitting = draft?.role === "housesitter";

  return (
    <div className="flex flex-col gap-density">
      <Section
        title="People"
        description="Everyone who can sign in. Adding somebody sends them nothing — it makes a link you hand over, and they choose their own password from it."
        actions={
          <Button
            variant="primary"
            disabled={pending || unavailable !== undefined}
            onClick={startInvite}
          >
            Add someone
          </Button>
        }
      >
        {unavailable === undefined ? null : (
          <Callout tone="danger" title="The list of people is not here">
            {/*
              Empty and "could not be read" look identical, and one of them
              would have somebody adding an account that already exists. Said
              plainly, and every button that would act on the list is off.
            */}
            <p>{unavailable}</p>
          </Callout>
        )}
        {link === undefined ? null : (
          <Callout
            tone="action"
            title="Their link — copy it now"
            actions={
              <>
                <Button
                  variant="primary"
                  onClick={() => void navigator.clipboard?.writeText(link.url)}
                >
                  Copy
                </Button>
                <Button onClick={() => setLink(undefined)}>Done</Button>
              </>
            }
          >
            <p>{link.message}</p>
            {/*
              Selectable and wrapping. Somebody is going to paste this into a
              text message on a phone, and a link that overflows its box is a
              link they copy half of.
            */}
            <code className="mt-2 block break-all rounded-density bg-canvas/40 p-2 text-sm">
              {link.url}
            </code>
            <p className="mt-2">
              It works once and lapses after {INVITATION_DAYS} days. We keep only a hash of it, so
              this is the only time it can be read — if it goes astray, issue a new one and the old
              one stops working.
            </p>
          </Callout>
        )}

        <Card>
          <DataTable
            caption="People who can sign in"
            columns={columns}
            rows={[...people]}
            rowKey={(row) => row.user.id}
            empty={
              <EmptyState
                title="Nobody but you"
                detail="Add the people who help with the place. Everyone gets a role, and a housesitter gets a window as well."
                action={
                  <Button variant="primary" onClick={startInvite}>
                    Add the first person
                  </Button>
                }
              />
            }
          />
        </Card>
      </Section>

      {deleted.length === 0 ? null : (
        <Section
          title="Deleted accounts"
          description="Tombstoned rather than removed, so what they recorded still has a name on it."
        >
          <Card>
            <ul className="flex flex-col gap-2">
              {deleted.map((row) => (
                <li key={row.user.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-col">
                    <span className="text-ink">{row.user.name}</span>
                    <span className="text-sm text-muted">{row.user.email}</span>
                  </span>
                  <Button
                    variant="ghost"
                    disabled={pending}
                    onClick={() => run(() => restorePerson(row.user.id))}
                  >
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      )}

      {draft === undefined ? null : (
        <Modal
          key={editing?.user.id ?? "new"}
          size="wide"
          title={editing === undefined ? "Add someone" : `Editing ${editing.user.name}`}
          description={
            editing === undefined
              ? "They get a link, not a password. Nobody here ever knows anybody else's."
              : "Changing a role takes effect the next time they sign in."
          }
          onClose={() => setDraft(undefined)}
        >
          <div className="flex flex-col gap-density">
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
              value={draft.email}
              error={errors["email"]}
              // The address is the account. Changing it would quietly hand a
              // signed-in session to a different person's inbox, so it is set
              // once and a mistake is fixed by deleting and re-adding.
              disabled={editing !== undefined}
              hint={
                editing === undefined
                  ? "This is how they sign in."
                  : "Set when the account was made."
              }
              onChange={(event) => setDraft({ ...draft, email: event.target.value })}
            />
            <Select
              label="Role"
              value={draft.role}
              error={errors["role"]}
              options={INVITABLE_ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }))}
              onChange={(event) => setDraft({ ...draft, role: event.target.value as Role })}
            />

            {housesitting ? (
              <>
                <p className="text-sm text-muted">
                  A housesitter has no access outside these dates — not to the guide, not to the
                  chores, not at all. Both ends are required, because a window with one end is not a
                  window.
                </p>
                <div className="grid gap-density md:grid-cols-2">
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
                    onChange={(event) => setDraft({ ...draft, accessTo: event.target.value })}
                  />
                </div>
              </>
            ) : null}

            <div className="flex gap-2">
              <Button variant="primary" busy={pending} onClick={save}>
                {editing === undefined ? "Add and make a link" : "Save changes"}
              </Button>
              <Button onClick={() => setDraft(undefined)}>Cancel</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
