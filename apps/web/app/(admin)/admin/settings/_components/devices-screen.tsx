"use client";

import { useEffect, useState, useTransition } from "react";

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
  addDevice,
  clearKioskPinAction,
  deleteDeviceAction,
  lockDeviceAction,
  reissueDeviceAction,
  renameDeviceAction,
  restoreDeviceAction,
  revokeDeviceAction,
  setKioskPinAction,
  type ActionResult,
} from "@/app/(admin)/admin/settings/_components/device-actions";
import { KIOSK_BOARDS } from "@/lib/kiosk-boards";
import type { KioskDevice } from "@/lib/device-store";

/**
 * Kiosk devices (spec §4.4, §7 `/admin/settings`).
 *
 * The same exception `PeopleScreen` documents: `kioskDevices` never reaches a
 * local store (it carries a token hash), so this reads and writes through
 * server actions and re-reads afterward rather than through `useMutations`.
 *
 * `pairingCode` only ever appears here for a device that has not finished
 * pairing yet, or has just had a fresh one issued — never once a token
 * exists. That is enforced by the store, not by this screen: `KioskDevice`
 * simply carries an absent code once one is not live.
 */

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const formatDate = (value: Date | undefined): string =>
  value === undefined
    ? "—"
    : value.toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      });

function statusOf(device: KioskDevice): {
  label: string;
  tone: "calm" | "action" | "danger" | "neutral";
} {
  if (device.revokedAt !== undefined) return { label: "Revoked", tone: "neutral" };
  if (device.pairedAt !== undefined) return { label: "Paired", tone: "calm" };
  if (device.pairingExpiresAt !== undefined && device.pairingExpiresAt > new Date()) {
    return { label: "Pairing…", tone: "action" };
  }
  return { label: "Code expired", tone: "danger" };
}

/** The code, shown big — a person reads this off a phone across the barn. */
function PairingCodeModal({ device, onClose }: { device: KioskDevice; onClose: () => void }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const remaining =
    device.pairingExpiresAt === undefined ? 0 : device.pairingExpiresAt.getTime() - now.getTime();
  const expired = remaining <= 0;

  return (
    <Modal title={`Pair ${device.name}`} onClose={onClose}>
      <div className="flex flex-col items-center gap-density text-center">
        <p className="text-muted">
          On the barn screen, go to <code>/kiosk/pair</code> and type this code.
        </p>
        <p className="font-mono text-5xl tracking-[0.3em] text-ink">
          {device.pairingCode ?? "——————"}
        </p>
        <p className={expired ? "text-danger" : "text-muted"}>
          {expired ? "Expired — issue a new code." : `Expires in ${formatCountdown(remaining)}`}
        </p>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}

export function DevicesScreen({
  propertyId,
  devices,
  deleted,
  pinSet,
  unavailable,
}: {
  readonly propertyId: string;
  readonly devices: readonly KioskDevice[];
  /** Tombstoned screens, restorable for the §4.5 clause 4 retention window. */
  readonly deleted: readonly KioskDevice[];
  readonly pinSet: boolean;
  readonly unavailable?: string | undefined;
}) {
  void propertyId;
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();
  const [pending, startTransition] = useTransition();

  const [addingName, setAddingName] = useState<string | undefined>();
  const [renamingId, setRenamingId] = useState<string | undefined>();
  const [renameDraft, setRenameDraft] = useState("");
  const [codeFor, setCodeFor] = useState<KioskDevice | undefined>();
  const [pinDraft, setPinDraft] = useState("");
  const [pinError, setPinError] = useState<string | undefined>();

  function run(action: () => Promise<ActionResult>, onDone?: (result: ActionResult) => void) {
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
    if (addingName === undefined) return;
    run(
      () => addDevice(addingName),
      (result) => {
        setAddingName(undefined);
        if (result.ok && result.device !== undefined) setCodeFor(result.device);
      },
    );
  }

  function submitRename(id: string) {
    run(
      () => renameDeviceAction(id, renameDraft),
      () => setRenamingId(undefined),
    );
  }

  async function revoke(device: KioskDevice) {
    const confirmed = await confirmDelete({
      tier: "elevated",
      recordName: device.name,
      entity: "kiosk device",
      action: "Revoke",
      dependents: [],
      consequence:
        "This screen stops syncing and can no longer log eggs, complete chores, or move animals — usually within a minute. If it is only lost for now, re-pairing later gives it a fresh code instead.",
    });
    if (!confirmed) return;

    run(() => revokeDeviceAction(device.id));
  }

  /**
   * Delete — §4.5 clause 3's Elevated tier, because it is a kiosk.
   *
   * The consequence differs by what the row is, and saying the wrong one is
   * worse than saying nothing: a screen that is already revoked has nothing
   * left to lose, and warning about one going dark would teach people to read
   * past this dialog.
   */
  async function remove(device: KioskDevice) {
    const live = device.revokedAt === undefined && device.pairedAt !== undefined;
    const confirmed = await confirmDelete({
      tier: "elevated",
      recordName: device.name,
      entity: "kiosk device",
      dependents: [],
      consequence: live
        ? "This screen goes dark within a minute — the same as revoking it — and the row leaves this list. Restore it from Deleted screens and it picks itself back up without anybody walking out to the barn."
        : "The row leaves this list. Nothing changes on the screen itself, which is already stopped. Restore it from Deleted screens if you want the record back.",
    });
    if (!confirmed) return;

    run(() => deleteDeviceAction(device.id));
  }

  function submitPin() {
    setPinError(undefined);
    if (!/^\d{4,8}$/.test(pinDraft)) {
      setPinError("4 to 8 digits.");
      return;
    }
    run(
      () => setKioskPinAction(pinDraft),
      () => setPinDraft(""),
    );
  }

  async function clearPin() {
    const confirmed = await confirmDelete({
      tier: "elevated",
      recordName: "kiosk PIN",
      entity: "PIN",
      action: "Clear",
      dependents: [],
      consequence:
        "Nothing further is asked before an owner or member at a kiosk screen can go past the whitelist. Set a new one any time.",
    });
    if (!confirmed) return;
    run(() => clearKioskPinAction());
  }

  const columns: readonly Column<KioskDevice>[] = [
    {
      key: "name",
      header: "Screen",
      render: (device) =>
        renamingId === device.id ? (
          <span className="flex items-center gap-2">
            <TextInput
              label="Name"
              hideLabel
              value={renameDraft}
              onChange={(event) => setRenameDraft(event.target.value)}
              onKeyDown={(event) => {
                // A rename is one field. Reaching for the mouse to commit it
                // is the kind of friction that stops people fixing a typo.
                if (event.key === "Enter") submitRename(device.id);
                if (event.key === "Escape") setRenamingId(undefined);
              }}
              autoFocus
            />
            <Button variant="primary" disabled={pending} onClick={() => submitRename(device.id)}>
              Save
            </Button>
            <Button disabled={pending} onClick={() => setRenamingId(undefined)}>
              Cancel
            </Button>
          </span>
        ) : (
          <span className="text-ink">{device.name}</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (device) => {
        const status = statusOf(device);
        return (
          <span className="flex flex-col gap-1">
            <Pill tone={status.tone}>{status.label}</Pill>
            {device.lastSeenAt !== undefined ? (
              <span className="text-sm text-muted">Last seen {formatDate(device.lastSeenAt)}</span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: "board",
      header: "Locked to",
      render: (device) =>
        device.revokedAt !== undefined ? (
          <span className="text-muted">—</span>
        ) : (
          <Select
            label="Locked board"
            hideLabel
            value={device.lockedToBoard ?? ""}
            disabled={pending}
            options={[
              { value: "", label: "Board picker (unlocked)" },
              ...KIOSK_BOARDS.map((board) => ({ value: board.slug, label: board.label })),
            ]}
            onChange={(event) =>
              run(() =>
                lockDeviceAction(device.id, event.target.value === "" ? null : event.target.value),
              )
            }
          />
        ),
    },
    {
      key: "actions",
      header: "",
      render: (device) => (
        <span className="flex flex-wrap gap-2">
          {device.revokedAt !== undefined ? null : (
            <>
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setRenamingId(device.id);
                  setRenameDraft(device.name);
                }}
              >
                Rename
              </Button>
              {device.pairedAt === undefined ? (
                <Button variant="ghost" disabled={pending} onClick={() => setCodeFor(device)}>
                  Show code
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => reissueDeviceAction(device.id),
                      (result) => {
                        if (result.ok && result.device !== undefined) setCodeFor(result.device);
                      },
                    )
                  }
                >
                  Re-pair
                </Button>
              )}
              <Button variant="ghost" disabled={pending} onClick={() => void revoke(device)}>
                Revoke
              </Button>
            </>
          )}
          {/* Outside the guard above: a revoked screen has no other action
              left, and clearing it out of the list is the whole reason it is
              here. */}
          <Button variant="ghost" disabled={pending} onClick={() => void remove(device)}>
            Delete
          </Button>
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-density">
      <Section
        title="Kiosk devices"
        description="Barn screens, paired once and trusted from then on. Each holds a whitelist — logging eggs, completing chores, moving animals between pens — and nothing else."
        actions={
          <Button
            variant="primary"
            disabled={pending || unavailable !== undefined}
            onClick={() => setAddingName("")}
          >
            Add a screen
          </Button>
        }
      >
        {unavailable === undefined ? null : (
          <Callout tone="danger" title="The list of devices is not here">
            <p>{unavailable}</p>
          </Callout>
        )}

        <Card>
          <DataTable
            caption="Paired and pairing barn screens"
            columns={columns}
            rows={[...devices]}
            rowKey={(device) => device.id}
            empty={
              <EmptyState
                title="No screens yet"
                detail="Add one, then walk the code over to the barn and type it in at /kiosk/pair."
                action={
                  <Button variant="primary" onClick={() => setAddingName("")}>
                    Add the first screen
                  </Button>
                }
              />
            }
          />
        </Card>
      </Section>

      <Section
        title="Kiosk PIN"
        description={
          "Shared across every screen — the same code the whole household uses. It never widens what a barn screen may do on its own; it only gates the one thing a screen can do to itself (unpairing), and any Elevated-tier action taken by a person using /kiosk as themselves."
        }
      >
        <Card>
          {pinSet ? (
            <div className="flex flex-col gap-density">
              <Badge tone="calm">PIN is set</Badge>
              <div className="flex flex-wrap items-end gap-2">
                <TextInput
                  label="New PIN"
                  type="password"
                  inputMode="numeric"
                  value={pinDraft}
                  error={pinError}
                  hint="4 to 8 digits. Replaces the current one."
                  onChange={(event) => setPinDraft(event.target.value)}
                />
                <Button variant="primary" disabled={pending} onClick={submitPin}>
                  Change PIN
                </Button>
                <Button disabled={pending} onClick={() => void clearPin()}>
                  Clear PIN
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <TextInput
                label="Set a PIN"
                type="password"
                inputMode="numeric"
                value={pinDraft}
                error={pinError}
                hint="4 to 8 digits."
                onChange={(event) => setPinDraft(event.target.value)}
              />
              <Button variant="primary" disabled={pending} onClick={submitPin}>
                Set PIN
              </Button>
            </div>
          )}
        </Card>
      </Section>

      {deleted.length === 0 ? null : (
        <Section
          title="Deleted screens"
          description="Tombstoned rather than removed, so a screen deleted by mistake comes back as it was rather than as a walk out to the barn with a fresh code."
        >
          <Card>
            <ul className="flex flex-col gap-2">
              {deleted.map((device) => (
                <li key={device.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-col">
                    <span className="text-ink">{device.name}</span>
                    <span className="text-sm text-muted">
                      Deleted {formatDate(device.deletedAt)}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    disabled={pending}
                    onClick={() => run(() => restoreDeviceAction(device.id))}
                  >
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      )}

      {addingName === undefined ? null : (
        <Modal title="Add a screen" onClose={() => setAddingName(undefined)}>
          <div className="flex flex-col gap-density">
            <TextInput
              label="Name"
              hint='What it is mounted as — "Barn TV", "Coop tablet".'
              value={addingName}
              autoFocus
              onChange={(event) => setAddingName(event.target.value)}
            />
            <div className="flex gap-2">
              <Button variant="primary" busy={pending} onClick={submitAdd}>
                Add and get a code
              </Button>
              <Button onClick={() => setAddingName(undefined)}>Cancel</Button>
            </div>
          </div>
        </Modal>
      )}

      {codeFor === undefined ? null : (
        <PairingCodeModal device={codeFor} onClose={() => setCodeFor(undefined)} />
      )}
    </div>
  );
}
