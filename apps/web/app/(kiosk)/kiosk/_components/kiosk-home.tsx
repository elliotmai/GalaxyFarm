"use client";

import { useState, useTransition } from "react";
import Link from "next/link";

import { Button, Modal, PageBody, TextInput, useConfirmDelete, useToast } from "@galaxy-farm/ui";

import { checkKioskPin, unpairThisDevice } from "@/app/(kiosk)/kiosk/_actions";
import { KioskHeader } from "@/app/(kiosk)/kiosk/_components/kiosk-header";
import { KIOSK_BOARDS } from "@/lib/kiosk-boards";

/** Chores first, then the spec's order — a stable sort keeps the rest as they are. */
const BOARDS = [...KIOSK_BOARDS].sort(
  (a, b) => Number(b.slug === "chores") - Number(a.slug === "chores"),
);

/**
 * The board picker (spec §4.4).
 *
 * What a screen shows when it is not locked to one board — six large tiles,
 * nothing to read past arm's length. Today's Chores is the board somebody
 * comes to this screen for most days, so it leads and is the only filled
 * tile; the rest follow in the order the spec names them, as equals.
 *
 * Locking a screen to one board is done from Settings → Kiosk devices, and
 * that is not repeated here: the people who set it up know, and a sentence on
 * a barn screen is a sentence everybody else skims past every morning.
 */
export function KioskHome({
  deviceName,
  pinSet,
}: {
  /** Set only for a paired barn screen — absent for an owner or member browsing `/kiosk` as themselves. */
  readonly deviceName?: string;
  readonly pinSet: boolean;
}) {
  return (
    <PageBody>
      <KioskHeader back={false} title="Boards" fact={deviceName} />

      <ul className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-3">
        {/* `prefetch` fetches each board whole rather than as far as its
            loading boundary — see `next.config.ts`. Six tiles on a screen that
            is powered on and then left alone, and the barn is the place most
            likely to be out of signal by the time one of them is pressed. */}
        {BOARDS.map((board) => {
          const lead = board.slug === "chores";
          return (
            <li key={board.slug}>
              <Link
                href={board.route}
                prefetch
                className={[
                  "flex min-h-[7.5rem] items-center justify-between gap-4 rounded-density border px-6 py-5",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action",
                  lead
                    ? "border-action bg-action text-action-ink"
                    : "border-rule bg-panel text-ink hover:bg-raised",
                ].join(" ")}
              >
                <h2 className="text-[1.6em]">{board.label}</h2>
                <svg aria-hidden width="32" height="32" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M9 6l6 6-6 6"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                  />
                </svg>
              </Link>
            </li>
          );
        })}
      </ul>

      {deviceName === undefined ? null : (
        <div className="flex justify-center pt-density">
          <UnpairButton pinSet={pinSet} />
        </div>
      )}
    </PageBody>
  );
}

/**
 * A screen taking itself out of service (spec §4.5's Elevated tier).
 *
 * Two gates, not one dialog with a PIN box baked in. `useConfirmDelete`
 * answers "do you mean it" — naming the action and its consequence, the same
 * as anywhere else in the app. The PIN is a second, separate step, checked on
 * the server rather than compared against a value this component would have
 * to be holding in the clear (see `checkKioskPin`'s doc comment).
 */
function UnpairButton({ pinSet }: { readonly pinSet: boolean }) {
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();
  const [pending, startTransition] = useTransition();
  const [pinPrompt, setPinPrompt] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | undefined>();

  async function begin() {
    const confirmed = await confirmDelete({
      tier: "elevated",
      recordName: "this screen",
      entity: "kiosk device",
      action: "Unpair",
      dependents: [],
      consequence:
        "This screen stops syncing immediately and will not log eggs, complete chores, or move animals again until it is paired with a fresh code from Settings.",
    });
    if (!confirmed) return;

    if (pinSet) {
      setPinPrompt(true);
      return;
    }

    finish();
  }

  function finish() {
    startTransition(async () => {
      const result = await unpairThisDevice();
      if (!result.ok) {
        show({ message: result.error, tone: "danger" });
        return;
      }
      window.location.assign("/kiosk/pair");
    });
  }

  async function submitPin() {
    setPinError(undefined);
    const correct = await checkKioskPin(pin);
    if (!correct) {
      setPinError("That is not the kiosk PIN.");
      return;
    }
    setPinPrompt(false);
    finish();
  }

  return (
    <>
      <Button variant="ghost" disabled={pending} onClick={() => void begin()}>
        Unpair this screen
      </Button>

      {pinPrompt ? (
        <Modal title="Enter the kiosk PIN" onClose={() => setPinPrompt(false)}>
          <div className="flex flex-col gap-density">
            <TextInput
              label="PIN"
              type="password"
              inputMode="numeric"
              autoFocus
              value={pin}
              error={pinError}
              onChange={(event) => setPin(event.target.value)}
            />
            <div className="flex gap-2">
              <Button variant="primary" busy={pending} onClick={() => void submitPin()}>
                Unpair
              </Button>
              <Button onClick={() => setPinPrompt(false)}>Cancel</Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
