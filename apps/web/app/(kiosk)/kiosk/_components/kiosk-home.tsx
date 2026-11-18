"use client";

import { useMemo, useState, useTransition } from "react";
import type { ReactNode } from "react";
import Link from "next/link";

import {
  Button,
  Card,
  Modal,
  PageBody,
  TextInput,
  useConfirmDelete,
  useToast,
} from "@galaxy-farm/ui";

import { choreProgress, dayKey, type Ulid } from "@galaxy-farm/core";
import type { EggLog } from "@galaxy-farm/module-poultry";

import { KioskHeader } from "@/app/(kiosk)/kiosk/_components/kiosk-header";
import { checkKioskPin, unpairThisDevice } from "@/app/(kiosk)/kiosk/_actions";
import { useTodayChores } from "@/app/(kiosk)/kiosk/_components/use-today-chores";
import { useRecords } from "@/lib/local/use-records";
import { KIOSK_BOARDS, type KioskBoardSlug } from "@/lib/kiosk-boards";

/**
 * The board picker (spec §4.4).
 *
 * What a screen shows when it is not locked to one board — six large tiles in
 * the spec's order, each carrying the one fact worth knowing before opening it.
 */
export function KioskHome({
  deviceName,
  pinSet,
  propertyId,
}: {
  /** Set only for a paired barn screen — absent for an owner or member browsing `/kiosk` as themselves. */
  readonly deviceName?: string;
  readonly pinSet: boolean;
  readonly propertyId: Ulid;
}) {
  const status = useBoardStatus(propertyId);
  const today = useMemo(() => new Date(), []);

  return (
    <PageBody>
      <KioskHeader
        back={false}
        title={today.toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
        })}
        fact={deviceName === undefined ? "Pick a board." : `${deviceName} — pick a board.`}
      />

      <div className="gf-kiosk-board-picker grid grid-cols-2 gap-density md:grid-cols-3">
        {/* `prefetch` fetches each board whole rather than as far as its
            loading boundary — see `next.config.ts`. Six tiles on a screen that
            is powered on and then left alone, and the barn is the place most
            likely to be out of signal by the time one of them is pressed. */}
        {KIOSK_BOARDS.map((board) => {
          const line = status[board.slug];

          return (
            <Link
              key={board.slug}
              href={board.route}
              prefetch
              className="gf-kiosk-board-link block"
              data-board={board.slug}
            >
              <Card className="gf-kiosk-board-tile">
                <span className="gf-kiosk-board-glyph" aria-hidden="true">
                  <BoardGlyph slug={board.slug} />
                </span>
                <span className="flex min-w-0 flex-col gap-1">
                  <h2>{board.label}</h2>
                  {line === undefined ? null : (
                    <span
                      className="gf-kiosk-board-status"
                      data-tone={line.urgent ? "danger" : undefined}
                    >
                      {line.text}
                    </span>
                  )}
                </span>
              </Card>
            </Link>
          );
        })}
      </div>

      {deviceName === undefined ? null : (
        <div className="flex justify-center pt-density">
          <UnpairButton pinSet={pinSet} />
        </div>
      )}
    </PageBody>
  );
}

interface BoardStatus {
  readonly text: string;
  readonly urgent: boolean;
}

/**
 * One live line per board that has something to say, from this device's own
 * store — so the picker answers "is there anything to do?" before a tap.
 */
function useBoardStatus(propertyId: Ulid): Partial<Record<KioskBoardSlug, BoardStatus>> {
  const { entries, loading } = useTodayChores(propertyId);
  const query = useMemo(() => ({ propertyId }), [propertyId]);
  const { records: eggLogs, loading: eggsLoading } = useRecords<EggLog>("eggLogs", query);

  return useMemo(() => {
    const status: Partial<Record<KioskBoardSlug, BoardStatus>> = {};

    if (!loading && entries.length > 0) {
      const progress = choreProgress(entries);
      status.chores =
        progress.open === 0
          ? { text: "All done today", urgent: false }
          : {
              text:
                progress.overdue > 0
                  ? `${progress.open} to do · ${progress.overdue} late`
                  : `${progress.open} to do`,
              urgent: progress.overdue > 0,
            };
    }

    if (!eggsLoading) {
      const key = dayKey(new Date());
      const total = eggLogs
        .filter((log) => dayKey(log.collectedOn) === key)
        .reduce((sum, log) => sum + log.total, 0);
      status.eggs = { text: `${total} ${total === 1 ? "egg" : "eggs"} today`, urgent: false };
    }

    return status;
  }, [entries, loading, eggLogs, eggsLoading]);
}
const BOARD_GLYPHS: Readonly<Record<KioskBoardSlug, ReactNode>> = {
  "pen-board": <path d="M4 8h24M7 8v17m9-17v17m9-17v17M4 25h24M4 15h24" />,
  calendar: (
    <>
      <path d="M7 4v5m18-5v5M5 8h22v20H5zM5 14h22" />
      <path d="M11 19h3m5 0h3m-11 5h3m5 0h3" />
    </>
  ),
  chores: (
    <>
      <path d="M12 7h15M12 16h15M12 25h15" />
      <path d="m4 7 2 2 4-4m-6 11 2 2 4-4m-6 11 2 2 4-4" />
    </>
  ),
  eggs: <path d="M16 3c-6 0-10 9-10 16a10 10 0 0 0 20 0c0-7-4-16-10-16Z" />,
  "program-day": (
    <>
      <path d="M6 5v22m10-22v22m10-22v22M3 10h6m4 6h6m4 6h6" />
      <circle cx="6" cy="10" r="2" />
      <circle cx="16" cy="16" r="2" />
      <circle cx="26" cy="22" r="2" />
    </>
  ),
  housesitter: <path d="m3 14 13-10 13 10M7 12v16h18V12M13 28v-9h6v9" />,
};

function BoardGlyph({ slug }: { readonly slug: KioskBoardSlug }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      {BOARD_GLYPHS[slug]}
    </svg>
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
