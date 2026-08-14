"use client";

import { useState, useTransition } from "react";
import Link from "next/link";

import {
  Button,
  Card,
  Modal,
  PageBody,
  PageHeader,
  TextInput,
  useConfirmDelete,
  useToast,
} from "@galaxy-farm/ui";

import { checkKioskPin, unpairThisDevice } from "@/app/(kiosk)/kiosk/_actions";
import { KIOSK_BOARDS } from "@/lib/kiosk-boards";

/**
 * The board picker (spec §4.4).
 *
 * What a screen shows when it is not locked to one board — six large tiles,
 * nothing to read past arm's length, in the same order the spec names them.
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
      <PageHeader
        eyebrow={deviceName ?? "Kiosk"}
        title="Pick a board"
        subtitle="Tap one. Any screen can be locked to a single board from Settings → Kiosk devices."
      />

      <div className="grid grid-cols-2 gap-density md:grid-cols-3">
        {KIOSK_BOARDS.map((board) => (
          <Link key={board.slug} href={board.route} className="block">
            <Card className="flex min-h-[8rem] items-center justify-center text-center">
              <h2>{board.label}</h2>
            </Card>
          </Link>
        ))}
      </div>

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
