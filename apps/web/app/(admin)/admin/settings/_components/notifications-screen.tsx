"use client";

import { useCallback, useEffect, useState, useTransition } from "react";

import {
  Badge,
  Button,
  Callout,
  Card,
  DataTable,
  EmptyState,
  Section,
  Select,
  useConfirmDelete,
  useToast,
  type Column,
} from "@galaxy-farm/ui";
import {
  DEFAULT_LEAD_DAYS,
  NOTIFICATION_TRIGGERS,
  settingFor,
  type NotificationChannel,
  type NotificationSetting,
  type NotificationTrigger,
  type Ulid,
} from "@galaxy-farm/core";

import {
  identifyDevice,
  revokeDevice,
  sendTestNotification,
  setTriggerChannel,
  subscribeDevice,
  unsubscribeDevice,
  type ActionResult,
} from "@/app/(admin)/admin/settings/_components/notification-actions";
import {
  currentEndpoint,
  deviceLabelFor,
  pushSupported,
  subscribeThisDevice,
  unsubscribeThisDevice,
} from "@/lib/push-client";
import type { PushDevice } from "@/lib/push-store";

/**
 * Notifications (spec §6, §7 `/admin/settings`).
 *
 * Two halves of one question — *where* alerts arrive and *which* alerts arrive
 * — on one tab, because they are only separable on paper. "Stop telling me
 * about supply stock" and "stop telling me on my phone" are the same
 * conversation, and a screen that put them on different tabs would have people
 * turning a trigger off because they could not find where to turn a channel
 * off.
 *
 * **Permission is asked for on a tap and never on load** (§6, and the reason
 * issue #41 says so twice). A browser prompt that appears unbidden is denied,
 * and a denial cannot be taken back by the site — so the ask happens here,
 * under a button that has already said what it will be used for.
 *
 * **A barn kiosk does not appear on this screen at all.** It is reached from
 * `/admin`, which a `kiosk` session cannot open, and the server actions refuse
 * that role besides. The reasoning is in the PR and worth repeating: a
 * subscription belongs to a person, a screen on a wall has no person behind
 * it, the boards it is already showing carry the same alerts as they happen,
 * and a notification nobody is standing in front of at 2am is one nobody sees.
 * A screen that could subscribe would also be one that kept notifying after it
 * was revoked, which is exactly the promise §4.4 makes about revocation.
 */

/** §6's trigger list, in a person's words rather than the enum's. */
const TRIGGER_LABELS: Readonly<Record<NotificationTrigger, string>> = {
  vaccine_booster_due: "Vaccine or booster due",
  withdrawal_ending: "Withdrawal period ending",
  preg_check_due: "Preg check due",
  calving_window_opening: "Calving window opening",
  sync_protocol_step_today: "Sync protocol step today",
  feed_run_out_approaching: "Feed running out",
  med_expiring: "Medicine expiring",
  maintenance_due: "Equipment maintenance due",
  bull_ring_due: "Bull ring due",
  departure_approaching: "Departure deadline approaching",
  new_booking_request: "New booking request",
  liability_form_unsigned: "Liability form unsigned",
  drop_off_pickup_reminder: "Drop-off and pickup reminders",
  planting_window_opening: "Planting window opening",
  chore_overdue: "Chore overdue",
  low_semen_inventory: "Low semen inventory",
  supply_low_stock: "Supply running low",
  candidate_sale_date: "Purchase candidate's sale date",
  candidate_listing_expiring: "Candidate listing expiring",
  frost_warning: "Frost warning",
  tank_freeze_warning: "Tank freeze warning",
  calving_watch: "Calving watch",
};

const CHANNEL_OPTIONS: readonly { value: NotificationChannel; label: string }[] = [
  { value: "both", label: "Email and push" },
  { value: "email", label: "Email only" },
  { value: "push", label: "Push only" },
  { value: "none", label: "Off" },
];

/** How far ahead this one is sent, in the words the row needs. */
function leadLine(setting: NotificationSetting | undefined, trigger: NotificationTrigger): string {
  const days = setting?.leadDays ?? DEFAULT_LEAD_DAYS[trigger];
  return days === 0 ? "Sent on the day." : `Sent ${days} days ahead.`;
}

const formatDate = (value: Date | undefined): string =>
  value === undefined
    ? "—"
    : value.toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });

export interface NotificationsScreenProps {
  readonly actorId: Ulid;
  /** The VAPID public key, or nothing when push is not configured. */
  readonly publicKey?: string | undefined;
  /** Why push is unavailable, when it is. Names the variables to set. */
  readonly pushUnavailable?: string | undefined;
  readonly devices: readonly PushDevice[];
  readonly settings: readonly NotificationSetting[];
}

export function NotificationsScreen({
  actorId,
  publicKey,
  pushUnavailable,
  devices,
  settings,
}: NotificationsScreenProps) {
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();
  const [pending, startTransition] = useTransition();

  /**
   * Whether this browser can do push at all, and whether it already does.
   *
   * Both are read after mount rather than rendered on the server: neither is
   * knowable there, and a subscribed-or-not state guessed from a user agent
   * would be wrong on exactly the device somebody is looking at.
   */
  const [supported, setSupported] = useState(true);
  const [endpoint, setEndpoint] = useState<string | undefined>();
  const [thisDeviceId, setThisDeviceId] = useState<string | undefined>();
  const [denied, setDenied] = useState(false);

  const readEndpoint = useCallback(async () => {
    if (!("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.ready;
    const subscribed = await currentEndpoint(registration);
    setEndpoint(subscribed);

    // Which row in the list below is this browser. Asked of the server rather
    // than answered by shipping every endpoint down to it: an endpoint is a
    // capability URL, and the list only needs to say "this one".
    setThisDeviceId(subscribed === undefined ? undefined : await identifyDevice(subscribed));
  }, []);

  useEffect(() => {
    setSupported(pushSupported(window));
    setDenied(typeof Notification !== "undefined" && Notification.permission === "denied");
    void readEndpoint();
  }, [readEndpoint]);

  function run(action: () => Promise<ActionResult>, onDone?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        show({ message: result.error, tone: "danger" });
        return;
      }
      show({ message: result.message, tone: "success" });
      onDone?.();
    });
  }

  /** The tap that asks. Nothing before this point has prompted for anything. */
  function turnOn() {
    if (publicKey === undefined) return;

    startTransition(async () => {
      const result = await subscribeThisDevice(publicKey, {
        requestPermission: () => Notification.requestPermission(),
        registration: () => navigator.serviceWorker.ready,
        userAgent: navigator.userAgent,
      });

      if (!result.ok) {
        setDenied(Notification.permission === "denied");
        show({ message: result.reason, tone: "danger" });
        return;
      }

      const saved = await subscribeDevice(result.payload);
      if (!saved.ok) {
        show({ message: saved.error, tone: "danger" });
        return;
      }

      show({ message: saved.message, tone: "success" });
      await readEndpoint();
    });
  }

  function turnOff() {
    startTransition(async () => {
      const registration = await navigator.serviceWorker.ready;
      const dropped = await unsubscribeThisDevice(registration);
      setEndpoint(undefined);
      setThisDeviceId(undefined);

      // The browser is unsubscribed either way; the row only matters if there
      // was an endpoint to name. A subscription the browser has already
      // forgotten is one the push service will 410 on, and the notifier
      // prunes it on the next send.
      if (dropped !== undefined) run(() => unsubscribeDevice(dropped));
    });
  }

  async function revoke(device: PushDevice) {
    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: device.deviceLabel,
      entity: "device",
      action: "Turn off",
      dependents: [],
      consequence:
        "That device stops receiving notifications straight away. Your other devices are unaffected, and it can be turned back on from the device itself.",
    });
    if (!confirmed) return;

    run(
      () => revokeDevice(device.id),
      () => void readEndpoint(),
    );
  }

  const subscribedHere = endpoint !== undefined;

  const deviceColumns: readonly Column<PushDevice>[] = [
    {
      key: "deviceLabel",
      header: "Device",
      render: (device) => (
        <span className="flex items-center gap-2">
          {device.deviceLabel}
          {device.current === true ? <Badge tone="action">This one</Badge> : null}
        </span>
      ),
    },
    { key: "createdAt", header: "Turned on", render: (device) => formatDate(device.createdAt) },
    {
      key: "lastSentAt",
      header: "Last sent to",
      render: (device) => formatDate(device.lastSentAt),
    },
    {
      key: "actions",
      header: "",
      render: (device) => (
        <Button variant="danger" disabled={pending} onClick={() => void revoke(device)}>
          Turn off
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-density">
      <Section
        title="This device"
        description="Alerts that arrive when the app is closed — which is the only kind that reaches you in a barn."
      >
        {pushUnavailable !== undefined ? (
          <Callout tone="neutral" title="Push notifications are not set up for this farm">
            {pushUnavailable}
          </Callout>
        ) : !supported ? (
          <Callout tone="neutral" title="This browser cannot do push notifications">
            Email still arrives. On an iPhone, add the app to the home screen first — Safari only
            allows notifications for an installed app.
          </Callout>
        ) : denied && !subscribedHere ? (
          <Callout tone="danger" title="Notifications are blocked for this site">
            The browser will not ask again. Turn them back on in its own site settings, then use the
            button below.
          </Callout>
        ) : null}

        <Card className="flex flex-wrap items-center justify-between gap-density">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-density text-ink">
              {subscribedHere
                ? `Notifications are on for this ${deviceLabelFor(typeof navigator === "undefined" ? "" : navigator.userAgent).toLowerCase()}.`
                : "Notifications are off for this device."}
            </p>
            <p className="text-sm text-muted">
              {subscribedHere
                ? "Turning them off here leaves your other devices alone."
                : "You will be asked for permission once. Say no and the browser will not ask again."}
            </p>
          </div>

          <Button
            variant={subscribedHere ? "secondary" : "primary"}
            disabled={pending || publicKey === undefined || !supported}
            onClick={() => (subscribedHere ? turnOff() : turnOn())}
          >
            {subscribedHere ? "Turn off on this device" : "Turn on for this device"}
          </Button>
        </Card>
      </Section>

      <Section
        title="Your devices"
        description="Each browser you have turned notifications on in. A phone and a laptop are two."
        actions={
          <Button
            disabled={pending || pushUnavailable !== undefined || devices.length === 0}
            onClick={() => run(() => sendTestNotification())}
          >
            Send a test
          </Button>
        }
      >
        {devices.length === 0 ? (
          <EmptyState
            title="No devices yet"
            detail="Nothing is being pushed anywhere. Email still goes out as it always has."
          />
        ) : (
          <DataTable
            caption="Devices receiving push notifications"
            rows={devices.map((device) => ({ ...device, current: device.id === thisDeviceId }))}
            columns={deviceColumns}
            rowKey={(device) => device.id}
          />
        )}
      </Section>

      <Section
        title="What you are told about"
        description="Per notification, and per person — this is your list, not the farm's."
      >
        <div className="flex flex-col gap-2">
          {NOTIFICATION_TRIGGERS.map((trigger) => {
            const setting = settingFor(settings, trigger, actorId);
            return (
              <Card
                key={trigger}
                className="flex flex-wrap items-center justify-between gap-density"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="text-density text-ink">{TRIGGER_LABELS[trigger]}</p>
                  <p className="text-sm text-muted">{leadLine(setting, trigger)}</p>
                </div>

                <Select
                  label={`How ${TRIGGER_LABELS[trigger].toLowerCase()} arrives`}
                  hideLabel
                  options={[...CHANNEL_OPTIONS]}
                  value={setting?.channel ?? "both"}
                  disabled={pending}
                  onChange={(event) => run(() => setTriggerChannel(trigger, event.target.value))}
                />
              </Card>
            );
          })}
        </div>
      </Section>
    </div>
  );
}
