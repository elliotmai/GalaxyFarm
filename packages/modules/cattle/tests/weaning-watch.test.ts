import { describe, expect, it } from "vitest";

import type { Animal, Ulid } from "@galaxy-farm/core";

import type { CattleProfile } from "../src/domain/cattle-profile.js";
import {
  DEFAULT_BATCH_WINDOW_DAYS,
  DEFAULT_WEANING_AGE_DAYS,
  describeBatch,
  groupIntoBatches,
  overdueToWean,
  weaningBatches,
  weaningCandidates,
} from "../src/domain/weaning-watch.js";

/**
 * When to wean (spec §6).
 *
 * The trigger §6's list of twenty-two did not have. Three things carry most of
 * the weight. The age is deliberately not the 205-day figure the app already
 * computes against — that is a *measurement* standard so calves born a month
 * apart can be compared, and taking it as a management instruction would put
 * this farm's show calves two months late. The unit is the batch, not the calf,
 * because contemporaries come off together. And the cow to separate a calf from
 * is not always the one on its papers.
 */

const TODAY = new Date("2026-08-14T12:00:00Z");
const daysAgo = (days: number): Date => new Date(TODAY.getTime() - days * 86_400_000);

let seq = 0;
const id = (): Ulid => `01ARZ3NDEKTSV4RRFFQ69G5F${String(seq++).padStart(2, "0")}` as Ulid;

const calf = (over: Partial<Animal> & { bornDaysAgo?: number } = {}): Animal => {
  const { bornDaysAgo, ...rest } = over;
  return {
    id: id(),
    species: "cattle",
    name: "Bandit",
    sex: "male",
    status: "active",
    ...(bornDaysAgo === undefined ? {} : { dob: daysAgo(bornDaysAgo) }),
    ...rest,
  } as Animal;
};

type Profile = Pick<CattleProfile, "animalId" | "weanedOn" | "dam" | "raisedById">;

const profile = (animalId: Ulid, over: Partial<CattleProfile> = {}): Profile =>
  ({ animalId, ...over }) as Profile;

const watch = (animals: Animal[], profiles: Profile[] = []) =>
  weaningBatches({ animals, profiles, asOf: TODAY });

/** Every calf the watch raised, across all its batches. */
const raised = (animals: Animal[], profiles: Profile[] = []) =>
  watch(animals, profiles).flatMap((batch) => batch.calves);

describe("which calves are on the list at all", () => {
  const all = (animals: Animal[], profiles: Profile[] = []) =>
    weaningCandidates({ animals, profiles, asOf: TODAY });

  it("drops a calf once it has been weaned", () => {
    const bandit = calf({ bornDaysAgo: 200 });

    expect(all([bandit], [profile(bandit.id, { weanedOn: daysAgo(3) })])).toEqual([]);
  });

  it("says nothing about a calf that is not on the place", () => {
    expect(all([calf({ bornDaysAgo: 200, status: "sold" })])).toEqual([]);
    expect(all([calf({ bornDaysAgo: 200, status: "deceased" })])).toEqual([]);
  });

  it("stays quiet about a calf with no birthday rather than guessing one", () => {
    // A guessed weaning date on a calf whose age nobody knows is worse than
    // none, because it would be acted on.
    expect(all([calf({})])).toEqual([]);
  });

  it("leaves other species alone", () => {
    expect(all([calf({ bornDaysAgo: 200, species: "horse" })])).toEqual([]);
  });

  it("keeps calves nowhere near ready, because they set the batch's date", () => {
    // The whole reason this is not filtered by lead time: the calves that are
    // not yet due are exactly the ones deciding when the batch is.
    expect(all([calf({ bornDaysAgo: 20 })])).toHaveLength(1);
  });
});

describe("when a batch comes up", () => {
  it("raises one that has reached weaning age", () => {
    expect(watch([calf({ bornDaysAgo: DEFAULT_WEANING_AGE_DAYS })])).toHaveLength(1);
  });

  it("opens a fortnight ahead, because weaning is not done the morning it is thought of", () => {
    // The pair has to be separated far enough apart not to hear each other and
    // the calf's pen and water have to be ready. An alert on the day is late.
    expect(watch([calf({ bornDaysAgo: DEFAULT_WEANING_AGE_DAYS - 10 })])).toHaveLength(1);
    expect(watch([calf({ bornDaysAgo: DEFAULT_WEANING_AGE_DAYS - 40 })])).toHaveLength(0);
  });

  it("does not wait for 205 days, which is a measurement and not an instruction", () => {
    // A calf at 140 days is due on a show place; against the benchmark it would
    // have another nine weeks on its dam.
    expect(watch([calf({ bornDaysAgo: 140 })])).toHaveLength(1);
  });
});

describe("calves born close together come off together", () => {
  it("holds an older calf back until its contemporaries are ready", () => {
    // Waiting a fortnight to wean a calf with its contemporaries costs nothing;
    // splitting a pen twice costs a morning and unsettles the ones left behind.
    const older = calf({ bornDaysAgo: DEFAULT_WEANING_AGE_DAYS + 10, name: "Older" });
    const younger = calf({ bornDaysAgo: DEFAULT_WEANING_AGE_DAYS - 5, name: "Younger" });

    const batches = watch([older, younger]);

    expect(batches).toHaveLength(1);
    expect(batches[0]?.calves).toHaveLength(2);
    // The youngest decides: five days out, not ten days overdue.
    expect(batches[0]?.daysUntilReady).toBe(5);
    expect(batches[0]?.overdue).toBe(false);
  });

  it("raises the job once rather than once per calf", () => {
    // Four calves over a fortnight is one morning's work, and raising it four
    // times means three raisings answered by doing nothing.
    const born = [0, 5, 10, 14].map((offset) =>
      calf({ bornDaysAgo: DEFAULT_WEANING_AGE_DAYS + offset }),
    );

    expect(watch(born)).toHaveLength(1);
    expect(raised(born)).toHaveLength(4);
  });

  it("keeps separate calving groups apart", () => {
    // Two months apart is not one batch, and weaning them together would hold
    // the first group back to no purpose.
    const spring = calf({ bornDaysAgo: DEFAULT_WEANING_AGE_DAYS });
    const autumn = calf({ bornDaysAgo: DEFAULT_WEANING_AGE_DAYS - 60 });

    expect(watch([spring, autumn])).toHaveLength(1);
  });

  it("measures the window from the earliest calf, so a season cannot chain into one batch", () => {
    // Calves born a fortnight apart all season would chain end to end if each
    // were compared with the previous one, and a batch whose youngest member
    // keeps moving is a batch that never becomes ready.
    const trickle = [0, 14, 28, 42, 56].map((offset) => ({
      calfId: id(),
      calfName: `Calf ${offset}`,
      bornOn: daysAgo(200 - offset),
      ageDays: 200 - offset,
      readyOn: TODAY,
      daysUntilReady: 0,
    }));

    const batches = groupIntoBatches(trickle, DEFAULT_BATCH_WINDOW_DAYS);

    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) {
      const first = batch[0]?.bornOn.getTime() ?? 0;
      const last = batch[batch.length - 1]?.bornOn.getTime() ?? 0;
      expect((last - first) / 86_400_000).toBeLessThanOrEqual(DEFAULT_BATCH_WINDOW_DAYS);
    }
  });

  it("lists a batch oldest first, the order they are looked at in the pen", () => {
    const found = watch([
      calf({ bornDaysAgo: DEFAULT_WEANING_AGE_DAYS - 2, name: "Younger" }),
      calf({ bornDaysAgo: DEFAULT_WEANING_AGE_DAYS + 8, name: "Older" }),
    ]);

    expect(found[0]?.calves.map((entry) => entry.calfName)).toEqual(["Older", "Younger"]);
  });
});

describe("which cow the calf is actually on", () => {
  it("uses the pedigree dam for an ordinary calf", () => {
    const bandit = calf({ bornDaysAgo: 150 });
    const dolly = id();

    const found = raised([bandit], [profile(bandit.id, { dam: { kind: "animal", id: dolly } })]);

    expect(found[0]?.damId).toBe(dolly);
    expect(found[0]?.geneticDamId).toBeUndefined();
  });

  it("follows the recipient on an embryo-transfer calf, not the donor", () => {
    // The donor may be in another state. Sending somebody to split a pair that
    // is not there is the failure this prevents — and ET needs no field of its
    // own, because the recipient is the cow who calved.
    const bandit = calf({ bornDaysAgo: 150 });
    const donor = id();
    const recip = id();

    const found = weaningBatches({
      animals: [bandit],
      profiles: [profile(bandit.id, { dam: { kind: "animal", id: donor } })],
      calvings: [{ damId: recip, calfAnimalId: bandit.id }],
      asOf: TODAY,
    }).flatMap((batch) => batch.calves);

    expect(found[0]?.damId).toBe(recip);
    expect(found[0]?.geneticDamId).toBe(donor);
    expect(found[0]?.raisedByOther).toBe("recipient");
  });

  it("follows the nurse cow on a grafted calf, over everything else", () => {
    // A graft happens after the birth, so neither the calving record nor the
    // pedigree can know it — and the genetic dam may be dead.
    const bandit = calf({ bornDaysAgo: 150 });
    const genetic = id();
    const calvedBy = id();
    const nurse = id();

    const found = weaningBatches({
      animals: [bandit],
      profiles: [profile(bandit.id, { dam: { kind: "animal", id: genetic }, raisedById: nurse })],
      calvings: [{ damId: calvedBy, calfAnimalId: bandit.id }],
      asOf: TODAY,
    }).flatMap((batch) => batch.calves);

    expect(found[0]?.damId).toBe(nurse);
    expect(found[0]?.geneticDamId).toBe(genetic);
    expect(found[0]?.raisedByOther).toBe("grafted");
  });

  it("says nothing about a difference when there is none", () => {
    const bandit = calf({ bornDaysAgo: 150 });
    const dolly = id();

    const found = weaningBatches({
      animals: [bandit],
      profiles: [profile(bandit.id, { dam: { kind: "animal", id: dolly } })],
      calvings: [{ damId: dolly, calfAnimalId: bandit.id }],
      asOf: TODAY,
    }).flatMap((batch) => batch.calves);

    expect(found[0]?.raisedByOther).toBeUndefined();
    expect(found[0]?.geneticDamId).toBeUndefined();
  });

  it("leaves the dam out when she is only an ancestor on paper", () => {
    // An external dam cannot be moved to another pen.
    const bandit = calf({ bornDaysAgo: 150 });
    const found = raised([bandit], [profile(bandit.id, { dam: { kind: "external", id: id() } })]);

    expect(found[0]?.damId).toBeUndefined();
  });
});

describe("what the watch says", () => {
  it("counts the days past for a lone calf, and marks it overdue", () => {
    const late = watch([calf({ bornDaysAgo: DEFAULT_WEANING_AGE_DAYS + 20 })])[0];

    expect(late?.overdue).toBe(true);
    expect(late?.daysUntilReady).toBe(-20);
    expect(describeBatch(late as never)).toBe("1 calf — 20 days past weaning age.");
  });

  it("counts the days remaining while there are any", () => {
    const soon = watch([calf({ bornDaysAgo: DEFAULT_WEANING_AGE_DAYS - 7 })])[0];

    expect(describeBatch(soon as never)).toBe("1 calf — ready to wean in 7 days.");
  });

  it("says today on the day", () => {
    const due = watch([calf({ bornDaysAgo: DEFAULT_WEANING_AGE_DAYS })])[0];

    expect(describeBatch(due as never)).toBe("1 calf — ready to wean today.");
  });

  it("shows the spread of a batch, since it changes what the morning looks like", () => {
    // Four calves born the same day is a different job from four spanning
    // three weeks.
    const batch = watch([
      calf({ bornDaysAgo: DEFAULT_WEANING_AGE_DAYS + 12 }),
      calf({ bornDaysAgo: DEFAULT_WEANING_AGE_DAYS }),
    ])[0];

    expect(describeBatch(batch as never)).toBe(
      "2 calves, born 12 days apart — ready to wean today when the youngest is ready.",
    );
  });
});

describe("the order batches come in", () => {
  it("puts the nearest deadline first", () => {
    const found = watch([
      calf({ bornDaysAgo: DEFAULT_WEANING_AGE_DAYS - 5, name: "Later" }),
      calf({ bornDaysAgo: DEFAULT_WEANING_AGE_DAYS + 90, name: "Worst" }),
    ]);

    expect(found.map((batch) => batch.calves[0]?.calfName)).toEqual(["Worst", "Later"]);
  });

  it("separates out the batches already past the day", () => {
    const found = watch([
      calf({ bornDaysAgo: DEFAULT_WEANING_AGE_DAYS - 5 }),
      calf({ bornDaysAgo: DEFAULT_WEANING_AGE_DAYS + 90 }),
    ]);

    expect(overdueToWean(found)).toHaveLength(1);
  });
});

describe("the age is a setting, not a constant", () => {
  it("takes a different weaning age for an operation that runs one", () => {
    // A club calf and a replacement heifer do not come off at the same age.
    // 195 days old against a 205-day age: ten days out, inside the fortnight.
    const bandit = calf({ bornDaysAgo: 195 });

    expect(
      weaningBatches({ animals: [bandit], profiles: [], asOf: TODAY, weaningAgeDays: 205 }),
    ).toHaveLength(1);
    expect(
      weaningBatches({
        animals: [bandit],
        profiles: [],
        asOf: TODAY,
        weaningAgeDays: 205,
        leadDays: 3,
      }),
    ).toHaveLength(0);
  });
});
