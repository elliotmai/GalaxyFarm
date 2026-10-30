"use client";

import { useEffect, useState } from "react";

import {
  DEFAULT_ANIMAL_HOME,
  lastAnimalHome,
  onAnimalHomeChange,
  type AnimalHome,
} from "@/lib/last-species";

/**
 * Where the Animals tab goes: the species last looked at on this device.
 *
 * Every animal until the device has been asked, so the server render and the
 * first client render agree, and then whatever is stored — following along as
 * the person moves between species.
 */
export function useAnimalHome(): AnimalHome {
  const [home, setHome] = useState<AnimalHome>(DEFAULT_ANIMAL_HOME);
  useEffect(() => {
    setHome(lastAnimalHome());
    return onAnimalHomeChange(() => setHome(lastAnimalHome()));
  }, []);
  return home;
}
