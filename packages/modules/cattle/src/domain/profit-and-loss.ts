import { sumMoney, type Money, type Ulid } from "@galaxy-farm/core";

import { cutRevenue, type ProcessingRecord } from "./processing-record.js";
import { netSaleProceeds, type AcquisitionRecord, type SaleRecord } from "./transactions.js";
import type { HealthRecord } from "./health-record.js";

/**
 * Per-animal profit and loss (spec §5.2).
 *
 * A read model — §4.5's first exception — recomputed from its sources, never
 * stored. Editing a treatment's cost has to move the animal's number, and a
 * cached total is how two screens end up disagreeing about what a cow cost.
 *
 * Feed arrives as an already-allocated figure rather than being computed here:
 * §5.3 owns the allocation, §4.1 forbids one module importing another, and the
 * split between animal-targeted and headcount-shared plans is genuinely feed's
 * business. The caller passes the answer in.
 */

export interface AnimalCostInputs {
  readonly animalId: Ulid;
  readonly acquisitions: readonly AcquisitionRecord[];
  readonly sales: readonly SaleRecord[];
  readonly health: readonly HealthRecord[];
  readonly processing: readonly ProcessingRecord[];
  /** From §5.3, already apportioned to this animal. */
  readonly allocatedFeed?: Money | undefined;
  /** Straws, technician fees, embryo work — passed in for the same reason. */
  readonly breedingCost?: Money | undefined;
}

export interface AnimalProfitAndLoss {
  readonly animalId: Ulid;
  readonly acquisitionCost: Money;
  readonly feedCost: Money;
  readonly healthCost: Money;
  readonly breedingCost: Money;
  readonly processingCost: Money;
  readonly totalCost: Money;
  readonly saleRevenue: Money;
  readonly cutRevenue: Money;
  readonly packerRevenue: Money;
  readonly totalRevenue: Money;
  readonly net: Money;
  /**
   * True when every cost line had a figure behind it.
   *
   * A home-raised calf with no feed allocation yet shows a flattering profit,
   * and the screen has to be able to say so rather than presenting a number
   * that is arithmetically right and practically misleading.
   */
  readonly complete: boolean;
}

const forAnimal = <T extends { animalId: Ulid }>(records: readonly T[], animalId: Ulid): T[] =>
  records.filter((record) => record.animalId === animalId);

export function animalProfitAndLoss(input: AnimalCostInputs): AnimalProfitAndLoss {
  const { animalId } = input;

  const acquisitionCost = sumMoney(
    forAnimal(input.acquisitions, animalId).map((record) => record.price),
  );
  const healthRecords = forAnimal(input.health, animalId);
  const healthCost = sumMoney(healthRecords.map((record) => record.cost ?? { cents: 0 }));
  const processingRecords = forAnimal(input.processing, animalId);
  const processingCost = sumMoney(
    processingRecords.map((record) => record.processingCost ?? { cents: 0 }),
  );
  const feedCost = input.allocatedFeed ?? { cents: 0 };
  const breedingCost = input.breedingCost ?? { cents: 0 };

  const saleRevenue = sumMoney(forAnimal(input.sales, animalId).map(netSaleProceeds));
  const cuts = sumMoney(processingRecords.map(cutRevenue));
  const packerRevenue = sumMoney(
    processingRecords.map((record) => record.paymentReceived ?? { cents: 0 }),
  );

  const totalCost = sumMoney([acquisitionCost, feedCost, healthCost, breedingCost, processingCost]);
  const totalRevenue = sumMoney([saleRevenue, cuts, packerRevenue]);

  // Costs recorded without a figure are the gap worth flagging: a treatment
  // logged with no cost is normal and makes the total an understatement.
  const missingHealthCost = healthRecords.some((record) => record.cost === undefined);

  return {
    animalId,
    acquisitionCost,
    feedCost,
    healthCost,
    breedingCost,
    processingCost,
    totalCost,
    saleRevenue,
    cutRevenue: cuts,
    packerRevenue,
    totalRevenue,
    net: { cents: totalRevenue.cents - totalCost.cents },
    complete: input.allocatedFeed !== undefined && !missingHealthCost,
  };
}

export interface HerdRollup {
  readonly animals: number;
  readonly totalCost: Money;
  readonly totalRevenue: Money;
  readonly net: Money;
  /** Averaged over animals, which is §6's "cost per head". */
  readonly costPerHead: Money;
  /** How many of the per-animal figures had every input behind them. */
  readonly completeAnimals: number;
}

export function herdRollup(rows: readonly AnimalProfitAndLoss[]): HerdRollup {
  const totalCost = sumMoney(rows.map((row) => row.totalCost));
  const totalRevenue = sumMoney(rows.map((row) => row.totalRevenue));

  return {
    animals: rows.length,
    totalCost,
    totalRevenue,
    net: { cents: totalRevenue.cents - totalCost.cents },
    costPerHead: { cents: rows.length === 0 ? 0 : Math.round(totalCost.cents / rows.length) },
    completeAnimals: rows.filter((row) => row.complete).length,
  };
}
