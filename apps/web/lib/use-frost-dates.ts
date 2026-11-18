"use client";

import { useMemo } from "react";

import type { Property, Ulid } from "@galaxy-farm/core";
import { frostDatesFor, type FrostDates } from "@galaxy-farm/module-garden";

import { useRecords } from "@/lib/local/use-records";

/**
 * The farm's frost dates for a year: its own where it has written them, else
 * its zone's averages. Undefined when it has neither, and then the garden
 * declines to guess a schedule rather than inventing one.
 */
export function useFrostDates(
  propertyId: Ulid,
  year = new Date().getFullYear(),
): FrostDates | undefined {
  const { records } = useRecords<Property>("properties", { propertyId });
  return useMemo(() => {
    const property = records.find((held) => held.id === propertyId) ?? records[0];
    if (property === undefined) return undefined;
    return frostDatesFor(property.growingZone, year, property);
  }, [records, propertyId, year]);
}
