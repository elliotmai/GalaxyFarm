/**
 * Which species the Animals tab opens on (decision 45).
 *
 * The two people on this farm each tend to be "in" one kind of animal for a
 * stretch — the cattle at calving, the hens in the spring — so the tab reopens
 * the species last looked at, per device, rather than a list of everything
 * that has to be narrowed again every time. "Every animal" is remembered the
 * same way.
 *
 * A per-device convenience in localStorage: it never syncs, and a device that
 * cannot store it simply opens on every animal.
 */

const KEY = "gf-animals-home";

/** Every place the Animals tab may reopen. Anything else in storage is ignored. */
export const ANIMAL_HOMES = [
  "/admin/animals",
  "/admin/cattle",
  "/admin/horses",
  "/admin/chickens/flock",
  "/admin/pets/dogs",
  "/admin/pets/cats",
] as const;
export type AnimalHome = (typeof ANIMAL_HOMES)[number];

export const DEFAULT_ANIMAL_HOME: AnimalHome = "/admin/animals";

export function isAnimalHome(value: string | null | undefined): value is AnimalHome {
  return (ANIMAL_HOMES as readonly (string | null | undefined)[]).includes(value);
}

export function rememberAnimalHome(home: AnimalHome): void {
  try {
    window.localStorage.setItem(KEY, home);
    window.dispatchEvent(new Event(KEY));
  } catch {
    // Private windows and blocked storage: the tab opens on every animal.
  }
}

export function lastAnimalHome(): AnimalHome {
  try {
    const stored = window.localStorage.getItem(KEY);
    return isAnimalHome(stored) ? stored : DEFAULT_ANIMAL_HOME;
  } catch {
    return DEFAULT_ANIMAL_HOME;
  }
}

/** Subscribe to changes made by this tab, for the nav to follow along. */
export function onAnimalHomeChange(listener: () => void): () => void {
  window.addEventListener(KEY, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(KEY, listener);
    window.removeEventListener("storage", listener);
  };
}
