import {
  dayKey,
  frostRisk,
  type DailyWeather,
  type NotificationTrigger,
  type Ulid,
  type WatchSettings,
} from "@galaxy-farm/core";
import {
  frostDatesFor,
  isInGrowingSeason,
  plantingWindows,
  type Crop,
  type PlannedPlanting,
  type PlantingMethod,
  type Variety,
} from "@galaxy-farm/module-garden";

import { varietyLabel } from "@/lib/garden";

/**
 * What the garden has to say this week (spec §5.5, §6).
 *
 * Two triggers, and the difference between them is worth stating because it is
 * what keeps the notifications readable:
 *
 * - **A planting window opening** fires for entries in the season plan and for
 *   nothing else. §5.5 is explicit — "notifications fire only for what's *in
 *   the plan*, not the whole seed catalog" — and the reason is arithmetic: a
 *   seed box holds forty varieties, each with a spring window and most with a
 *   fall one, so a catalogue-wide alert would be eighty emails a year about
 *   work nobody had decided to do. The general planting calendar stays
 *   browseable for the rest.
 * - **A frost warning** fires on the forecast, during the growing season, at
 *   the property's own threshold. Outside the season a frost is the weather
 *   behaving normally; the whole point of the warning is that there is
 *   something in the ground it will kill.
 *
 * Everything here is pure. The forecast, the records and the mail are the
 * caller's problem — which is what lets the poll in `/api/cron/weather` be the
 * only place any of the three are reached.
 */

export interface GardenAlert {
  /**
   * Which of §6's triggers raised this.
   *
   * Carried on the alert rather than inferred by the caller because it decides
   * who hears about it: the two triggers here have separate opt-outs, and a
   * digest that merged them would make "stop telling me about frost" also stop
   * the planting windows.
   */
  readonly trigger: NotificationTrigger;
  /**
   * A stable key derived from what the alert is *about*, never from when it
   * was computed.
   *
   * The poll runs on a schedule nobody controls to the minute and may run
   * twice in an hour. The key is what makes the second run update one calendar
   * row rather than add a second, and what lets the caller tell a window it
   * has already emailed about from one it has not.
   */
  readonly key: string;
  /** The day this is about — the window opening, or the cold night. */
  readonly at: Date;
  /** Calendar title. */
  readonly title: string;
  /** Calendar detail, and the paragraph under the subject in an email. */
  readonly detail: string;
  /** Email subject, when this alert is the only one. */
  readonly subject: string;
}

/** How a method reads as an instruction rather than as an enum value. */
const METHOD_VERB: Readonly<Record<PlantingMethod, (what: string) => string>> = {
  indoor_start: (what) => `Start ${what} indoors`,
  direct_sow: (what) => `Direct-sow ${what}`,
  transplant: (what) => `Transplant ${what}`,
};

function formatDay(at: Date): string {
  return at.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Windows opening inside the lead time, one alert each.
 *
 * `leadDays` is the season plan's own lead rather than a §6 `WatchTrigger`,
 * because a planting window is not an event with a moment: it is a fortnight
 * that opens, and §5.5's example alerts — "start tomatoes indoors this week",
 * "direct-sow okra window opens Friday" — are both spoken from inside it.
 */
export function plantingWindowAlerts(
  planned: readonly PlannedPlanting[],
  varieties: readonly Variety[],
  crops: readonly Crop[],
  now: Date,
  leadDays = 7,
): GardenAlert[] {
  return plantingWindows(planned, now, leadDays).map((window) => {
    const variety = varieties.find((entry) => entry.id === window.planned.varietyId);
    const what = varietyLabel(variety, crops);
    const instruction = METHOD_VERB[window.planned.method](what);

    const when = window.open
      ? window.closingSoon
        ? `The window closes ${formatDay(window.planned.windowTo)} — this is the last of it.`
        : `The window is open now and runs to ${formatDay(window.planned.windowTo)}.`
      : `The window opens ${formatDay(window.opensOn)}.`;

    const bed =
      window.planned.bedId === undefined
        ? "No bed picked yet."
        : "The plan already says which bed.";

    return {
      trigger: "planting_window_opening",
      key: windowKey(window.planned.id),
      at: window.opensOn,
      title: window.open ? `${instruction} this week` : instruction,
      detail: `${when} ${bed}`,
      subject: window.open
        ? `${instruction} this week`
        : `${instruction} — ${formatDay(window.opensOn)}`,
    };
  });
}

/** The calendar id one planned planting owns, forever. */
export function windowKey(plannedPlantingId: Ulid): string {
  return `garden-window-${plannedPlantingId}`;
}

/**
 * Nights cold enough to matter, filtered to the growing season (spec §6).
 *
 * The threshold and the hard-freeze cutoff are the property's `WatchSettings`,
 * defaulting to §6's 36 °F and 28 °F. The season comes from the property's
 * growing zone, which is a setting and not a constant — Fort Worth reads ≈8b
 * today and the farm may not be in Fort Worth forever.
 *
 * A zone the frost table does not know produces no season, and
 * `isInGrowingSeason` then lets every night through. That is the right way for
 * this to fail: a farm that has not set its zone gets more frost warnings than
 * it strictly needs, rather than silently getting none on the night it had
 * tomatoes out.
 */
export function frostAlerts(
  daily: readonly DailyWeather[],
  growingZone: string | undefined,
  settings: Pick<WatchSettings, "frostF" | "hardFreezeF">,
): GardenAlert[] {
  return frostRisk(daily, { frostF: settings.frostF, hardFreezeF: settings.hardFreezeF })
    .filter((risk) =>
      isInGrowingSeason(frostDatesFor(growingZone, risk.date.getUTCFullYear()), risk.date),
    )
    .map((risk) => ({
      trigger: "frost_warning" as const,
      key: frostKey(risk.date),
      at: risk.date,
      title: risk.hardFreeze
        ? `Hard freeze in the garden — ${Math.round(risk.lowF)} °F`
        : `Frost in the garden — ${Math.round(risk.lowF)} °F`,
      detail: risk.hardFreeze
        ? `${formatDay(risk.date)} is forecast to reach ${Math.round(risk.lowF)} °F, below the ${settings.hardFreezeF} °F hard freeze. Row cover will not save anything tender; pick what is ready.`
        : `${formatDay(risk.date)} is forecast to reach ${Math.round(risk.lowF)} °F, below the ${settings.frostF} °F frost threshold. Cover the tender beds or pick them.`,
      subject: risk.hardFreeze
        ? `Hard freeze ${formatDay(risk.date)} — ${Math.round(risk.lowF)} °F`
        : `Frost ${formatDay(risk.date)} — ${Math.round(risk.lowF)} °F`,
    }));
}

/** The calendar id one frost night owns. Two polls in a day write one row. */
export function frostKey(date: Date): string {
  return `garden-frost-${dayKey(date)}`;
}

/**
 * One message per trigger for everything new, rather than one per alert.
 *
 * Three separate messages arriving in the same minute is how somebody learns
 * to filter the sender, and §6's per-trigger opt-out exists precisely because
 * an alert nobody reads is worse than no alert.
 *
 * **Grouped by trigger, and that is not an implementation detail.** A frost
 * warning and a planting window have separate opt-outs, so a single digest
 * carrying both could only be sent under one of the two preferences —
 * switching frost off would take the season plan with it, or fail to switch
 * frost off at all. Two triggers means at most two messages.
 *
 * Empty when there is nothing new, so the caller sends nothing at all rather
 * than a message saying so.
 */
export function gardenDigests(
  alerts: readonly GardenAlert[],
): { readonly trigger: NotificationTrigger; readonly subject: string; readonly body: string }[] {
  const byTrigger = new Map<NotificationTrigger, GardenAlert[]>();
  for (const alert of alerts) {
    byTrigger.set(alert.trigger, [...(byTrigger.get(alert.trigger) ?? []), alert]);
  }

  return [...byTrigger].map(([trigger, group]) => {
    const first = group[0] as GardenAlert;
    return {
      trigger,
      subject: group.length === 1 ? first.subject : `Garden: ${group.length} things this week`,
      body: group.map((alert) => `${alert.subject}\n${alert.detail}`).join("\n\n"),
    };
  });
}
