import { ADJUSTMENT_REASONS, type AdjustmentReason } from "@galaxy-farm/module-poultry";

/**
 * What each headcount reason is called out loud (spec §5.4).
 *
 * Shared between the two panels rather than written twice: the log offers
 * these words in its dropdown, and the flock's delete dialog names the entries
 * it is about to take with it. Two spellings of "predator" would be two names
 * for one thing in a confirmation somebody is reading in order to decide.
 */

export const REASON_LABEL: Readonly<Record<AdjustmentReason, string>> = {
  added: "Bought in",
  hatched: "Hatched",
  died: "Died",
  predator: "Taken",
  culled: "Culled",
  sold: "Sold",
};

export const REASON_HINT: Readonly<Record<AdjustmentReason, string>> = {
  added: "Birds brought onto the place.",
  hatched: "Hatched here and old enough to count.",
  died: "Died of something that was not a predator.",
  predator: "Something got in. This is the number that decides whether to walk the fence.",
  culled: "Put down deliberately.",
  sold: "Left alive, on purpose.",
};

export const REASON_OPTIONS = ADJUSTMENT_REASONS.map((reason) => ({
  value: reason,
  label: REASON_LABEL[reason],
}));
