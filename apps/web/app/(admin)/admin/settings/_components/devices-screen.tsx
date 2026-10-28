"use client";

import { useEffect, useState, useTransition } from "react";

import {
  Button,
  Card,
  EmptyState,
  Modal,
  Pill,
  Section,
  Select,
  TextInput,
  useConfirmDelete,
  useToast,
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
 *
 * One row per screen — its name, one line, a chip only when it is not simply
 * paired — and everything that can be done to it in the side panel the row
 * opens: rename, lock to a board, show or reissue the code, revoke, delete.
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
  /** The screen whose panel is open, by id — read back from the live list. */
  const [managingId, setManagingId] = useState<string | undefined>();
  const [renameDraft, setRenameDraft] = useState("");
  const managing = devices.find((held) => held.id === managingId);
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

  function open(device: KioskDevice) {
    setManagingId(device.id);
    setRenameDraft(device.name);
  }

  function submitRename(id: string) {
    run(
      () => renameDeviceAction(id, renameDraft),
      () => setManagingId(undefined),
    );
  }

  /** Close the panel, then act — so a confirmation or the code is never under it. */
  function fromPanel(act: () => void) {
    setManagingId(undefined);
    act();
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

  /** The one muted line under a name: what it shows, and when it was last heard from. */
  function lineFor(device: KioskDevice): string {
    const board = KIOSK_BOARDS.find((entry) => entry.slug === device.lockedToBoard);
    return [
      device.revokedAt !== undefined
        ? undefined
        : board === undefined
          ? "Board picker"
          : `Locked to ${board.label}`,
      device.lastSeenAt === undefined ? undefined : `Last seen ${formatDate(device.lastSeenAt)}`,
    ]
      .filter((part) => part !== undefined)
      .join(" · ");
  }

  return (
    <div className="flex flex-col gap-density">
      <Section
        title="Kiosk devices"
        description="Barn screens, paired once and trusted from then on. Each may log eggs, complete chores and move animals between pens — nothing else."
        actions={
          <Button
            variant="primary"
            disabled={pending || unavailable !== undefined}
            onClick={() => setAddingName("")}
          >
            <span aria-hidden="true">+</span> Add screen
          </Button>
        }
      >
        {unavailable === undefined ? null : <p className="text-sm text-danger">{unavailable}</p>}

        {devices.length === 0 ? (
          <EmptyState
            title="No screens yet"
            detail="Add one, then type its code in at /kiosk/pair on the barn screen."
            action={
              <Button variant="primary" onClick={() => setAddingName("")}>
                Add the first screen
              </Button>
            }
          />
        ) : (
          <ul
            aria-label="Paired and pairing barn screens"
            className="flex flex-col divide-y divide-rule overflow-hidden rounded-density border border-rule bg-panel"
          >
            {devices.map((device) => {
              const status = statusOf(device);
              const line = lineFor(device);
              return (
                <li key={device.id}>
                  <button
                    type="button"
                    onClick={() => open(device)}
                    aria-label={`Manage ${device.name}`}
                    className="flex min-h-[60px] w-full min-w-0 items-center gap-3 py-2 pl-4 pr-3 text-left text-ink hover:bg-canvas focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-action"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate font-semibold">{device.name}</span>
                      {line === "" ? null : (
                        <span className="truncate text-sm text-muted">{line}</span>
                      )}
                    </span>
                    {/* By exception: a paired screen is the ordinary case. */}
                    {device.pairedAt !== undefined && device.revokedAt === undefined ? null : (
                      <Pill tone={status.tone}>{status.label}</Pill>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section
        title="Kiosk PIN"
        description="One code for every screen. It never widens what a screen may do; it gates unpairing, and any Elevated-tier action a person takes at /kiosk as themselves."
      >
        <Card>
          {pinSet ? (
            <div className="flex flex-col gap-density">
              <p className="text-sm text-muted">A PIN is set.</p>
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
          description="Restore one and it comes back paired — no walk to the barn with a new code."
        >
          <Card>
            <ul className="flex flex-col divide-y divide-rule">
              {deleted.map((device) => (
                <li key={device.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-semibold text-ink">{device.name}</span>
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
        <Modal
          placement="side"
          title="Add a screen"
          onClose={() => setAddingName(undefined)}
          footer={
            <>
              <Button variant="primary" busy={pending} onClick={submitAdd}>
                Add and get a code
              </Button>
              <Button onClick={() => setAddingName(undefined)}>Cancel</Button>
            </>
          }
        >
          <TextInput
            label="Name"
            hint='"Barn TV", "Coop tablet".'
            value={addingName}
            autoFocus
            onChange={(event) => setAddingName(event.target.value)}
          />
        </Modal>
      )}

      {managing === undefined ? null : (
        <Modal
          key={managing.id}
          placement="side"
          title={managing.name}
          description={statusOf(managing).label}
          onClose={() => setManagingId(undefined)}
          footer={
            <>
              {managing.revokedAt !== undefined ? null : (
                <Button
                  variant="primary"
                  disabled={pending}
                  onClick={() => submitRename(managing.id)}
                >
                  Save
                </Button>
              )}
              <Button disabled={pending} onClick={() => setManagingId(undefined)}>
                Cancel
              </Button>
              {/* Outside every guard: a revoked screen has no other action
                  left, and clearing it out of the list is the whole reason it
                  is here. */}
              <Button
                variant="danger"
                className="ml-auto"
                disabled={pending}
                onClick={() => fromPanel(() => void remove(managing))}
              >
                Delete
              </Button>
            </>
          }
        >
          {managing.revokedAt !== undefined ? (
            <p className="text-sm text-muted">Revoked — it no longer syncs.</p>
          ) : (
            <>
              <TextInput
                label="Name"
                value={renameDraft}
                onChange={(event) => setRenameDraft(event.target.value)}
                onKeyDown={(event) => {
                  // A rename is one field. Reaching for the mouse to commit it
                  // is the kind of friction that stops people fixing a typo.
                  if (event.key === "Enter") submitRename(managing.id);
                }}
              />
              <Select
                label="Locked to"
                value={managing.lockedToBoard ?? ""}
                disabled={pending}
                options={[
                  { value: "", label: "Board picker (unlocked)" },
                  ...KIOSK_BOARDS.map((board) => ({ value: board.slug, label: board.label })),
                ]}
                onChange={(event) =>
                  run(() =>
                    lockDeviceAction(
                      managing.id,
                      event.target.value === "" ? null : event.target.value,
                    ),
                  )
                }
              />
              <div className="flex flex-wrap gap-2 border-t border-rule pt-density">
                {managing.pairedAt === undefined ? (
                  <Button disabled={pending} onClick={() => fromPanel(() => setCodeFor(managing))}>
                    Show code
                  </Button>
                ) : (
                  <Button
                    disabled={pending}
                    onClick={() =>
                      fromPanel(() =>
                        run(
                          () => reissueDeviceAction(managing.id),
                          (result) => {
                            if (result.ok && result.device !== undefined) {
                              setCodeFor(result.device);
                            }
                          },
                        ),
                      )
                    }
                  >
                    Re-pair
                  </Button>
                )}
                <Button disabled={pending} onClick={() => fromPanel(() => void revoke(managing))}>
                  Revoke
                </Button>
              </div>
            </>
          )}
        </Modal>
      )}

      {codeFor === undefined ? null : (
        <PairingCodeModal device={codeFor} onClose={() => setCodeFor(undefined)} />
      )}
    </div>
  );
}
