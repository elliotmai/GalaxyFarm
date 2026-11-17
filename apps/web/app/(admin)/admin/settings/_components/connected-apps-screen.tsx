"use client";

import { useState, useTransition } from "react";

import {
  Button,
  Callout,
  Card,
  DataTable,
  EmptyState,
  Modal,
  Pill,
  Section,
  TextInput,
  useConfirmDelete,
  useToast,
  type Column,
} from "@galaxy-farm/ui";

import {
  addApiToken,
  revokeApiTokenAction,
  type ApiTokenActionResult,
} from "@/app/(admin)/admin/settings/_components/api-token-actions";
import type { ApiToken } from "@/lib/api-token-store";

/**
 * Connected apps (spec §4.3 "Connected apps").
 *
 * Another of the household's apps — the kitchen's Fridge Board — reading this
 * farm's board API with a bearer token. A token is minted here, shown once,
 * and from then on only its hash exists; losing it means minting another and
 * revoking the old one. Never edited, never deleted: a revoked row stays as
 * the record of what wrote under its id in the sync audit.
 */

const formatDate = (value: Date | undefined): string =>
  value === undefined
    ? "—"
    : value.toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      });

function TokenModal({ token, onClose }: { token: string; onClose: () => void }) {
  return (
    <Modal title="Copy this token now" onClose={onClose}>
      <div className="flex flex-col gap-density">
        <p className="text-muted">
          Paste it into the other app&rsquo;s settings. It is shown once — only a hash of it is kept
          here.
        </p>
        <code className="break-all border border-edge bg-panel p-density font-mono text-ink">
          {token}
        </code>
        <div className="flex gap-2">
          <Button
            variant="primary"
            onClick={() => void navigator.clipboard?.writeText(token).catch(() => undefined)}
          >
            Copy
          </Button>
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  );
}

export function ConnectedAppsScreen({
  tokens,
  unavailable,
}: {
  readonly tokens: readonly ApiToken[];
  readonly unavailable?: string | undefined;
}) {
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();
  const [pending, startTransition] = useTransition();
  const [addingLabel, setAddingLabel] = useState<string | undefined>();
  const [shown, setShown] = useState<string | undefined>();

  function run(
    action: () => Promise<ApiTokenActionResult>,
    onDone?: (result: ApiTokenActionResult) => void,
  ) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        show({ message: result.error, tone: "danger" });
        return;
      }
      show({ message: result.message, tone: "success" });
      onDone?.(result);
    });
  }

  function submitAdd() {
    if (addingLabel === undefined) return;
    run(
      () => addApiToken(addingLabel),
      (result) => {
        setAddingLabel(undefined);
        if (result.ok && result.token !== undefined) setShown(result.token);
      },
    );
  }

  async function revoke(token: ApiToken) {
    const confirmed = await confirmDelete({
      tier: "elevated",
      recordName: token.label,
      entity: "connected app token",
      action: "Revoke",
      dependents: [],
      consequence:
        "The app is refused from its very next request and cannot read or tick chores again. This cannot be undone — mint a new token if it should come back.",
    });
    if (!confirmed) return;
    run(() => revokeApiTokenAction(token.id));
  }

  const columns: readonly Column<ApiToken>[] = [
    {
      key: "label",
      header: "App",
      render: (token) => <span className="text-ink">{token.label}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (token) => (
        <span className="flex flex-col gap-1">
          {token.revokedAt === undefined ? (
            <Pill tone="calm">Active</Pill>
          ) : (
            <Pill tone="neutral">Revoked {formatDate(token.revokedAt)}</Pill>
          )}
          <span className="text-sm text-muted">
            {token.lastUsedAt === undefined
              ? "Never used"
              : `Last used ${formatDate(token.lastUsedAt)}`}
          </span>
        </span>
      ),
    },
    { key: "created", header: "Minted", render: (token) => formatDate(token.createdAt) },
    {
      key: "actions",
      header: "",
      render: (token) =>
        token.revokedAt !== undefined ? null : (
          <Button variant="ghost" disabled={pending} onClick={() => void revoke(token)}>
            Revoke
          </Button>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-density">
      <Section
        title="Connected apps"
        description="Other apps that read this farm's chores and housesitter guide, server to server, and may tick chores off. Each token reaches this property only."
        actions={
          <Button
            variant="primary"
            disabled={pending || unavailable !== undefined}
            onClick={() => setAddingLabel("")}
          >
            Mint a token
          </Button>
        }
      >
        {unavailable === undefined ? null : (
          <Callout tone="danger" title="The list of connected apps is not here">
            <p>{unavailable}</p>
          </Callout>
        )}

        <Card>
          <DataTable
            caption="Connected app tokens"
            columns={columns}
            rows={[...tokens]}
            rowKey={(token) => token.id}
            empty={
              <EmptyState
                title="No connected apps"
                detail="Mint a token, then paste it into the other app — the Fridge Board, say."
              />
            }
          />
        </Card>
      </Section>

      {addingLabel === undefined ? null : (
        <Modal title="Mint a token" onClose={() => setAddingLabel(undefined)}>
          <div className="flex flex-col gap-density">
            <TextInput
              label="App"
              hint='Which app will hold it — "Fridge Board".'
              value={addingLabel}
              autoFocus
              onChange={(event) => setAddingLabel(event.target.value)}
            />
            <div className="flex gap-2">
              <Button variant="primary" busy={pending} onClick={submitAdd}>
                Mint and show the token
              </Button>
              <Button onClick={() => setAddingLabel(undefined)}>Cancel</Button>
            </div>
          </div>
        </Modal>
      )}

      {shown === undefined ? null : (
        <TokenModal token={shown} onClose={() => setShown(undefined)} />
      )}
    </div>
  );
}
