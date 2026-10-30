import type { Animal, Ulid } from "@galaxy-farm/core";

/**
 * What the ＋ Log flow can write, and who each kind is for.
 *
 * Pure data and pure functions, so the query contract other screens link with
 * (`/admin/log?kind=…&animals=…`) is pinned by a test rather than by reading
 * the component.
 */

export const LOG_KINDS = [
  "treatment",
  "weight",
  "calving",
  "heat",
  "breeding",
  "move",
  "photo",
  "note",
  "eggs",
  "feeding",
  "supplies",
] as const;

export type LogKind = (typeof LOG_KINDS)[number];

export function isLogKind(value: string | null | undefined): value is LogKind {
  return value !== null && value !== undefined && (LOG_KINDS as readonly string[]).includes(value);
}

/**
 * The tiles on step 1, in the mockup's order.
 *
 * Nine tiles for eleven kinds: heat and breeding are one trip to the cow, and
 * a note and a photo are both "anything else". Each pair shares step 2's
 * animals, and step 3 switches between the two without going back.
 */
export const TILES: readonly {
  readonly kind: LogKind;
  readonly label: string;
  readonly hint: string;
  /** The other kinds this tile stands for, so a linked kind lights it. */
  readonly also?: readonly LogKind[];
}[] = [
  { kind: "treatment", label: "Treatment", hint: "Shot, drench, pour-on" },
  { kind: "weight", label: "Weight", hint: "One or a run of animals" },
  { kind: "feeding", label: "Feeding", hint: "Tick or log amounts" },
  { kind: "calving", label: "Calving", hint: "Calf, ease, vigour" },
  { kind: "heat", label: "Heat / breeding", hint: "Seen in heat, AI, bull", also: ["breeding"] },
  { kind: "move", label: "Move", hint: "To a pen or pasture" },
  { kind: "eggs", label: "Eggs", hint: "Today’s basket" },
  { kind: "supplies", label: "Feed or supplies in", hint: "Restock the shed" },
  { kind: "note", label: "Note or photo", hint: "Anything else", also: ["photo"] },
];

/** The heading for a kind, as step 2 and step 3 say it. */
export const KIND_LABELS: Readonly<Record<LogKind, string>> = {
  treatment: "Treatment",
  weight: "Weight",
  calving: "Calving",
  heat: "Heat",
  breeding: "Breeding",
  move: "Move",
  photo: "Photo",
  note: "Note",
  eggs: "Eggs",
  feeding: "Feeding",
  supplies: "Feed or supplies in",
};

/**
 * Kinds that are about the place rather than an animal.
 *
 * A basket of eggs belongs to a flock, a feeding to a plan and a pallet of
 * mineral to the shed — none of them has a "who", so step 2 is skipped.
 */
export function needsAnimals(kind: LogKind): boolean {
  return kind !== "eggs" && kind !== "feeding" && kind !== "supplies";
}

/** A calving makes one calf from one cow. Everything else can be a run. */
export function singleAnimal(kind: LogKind): boolean {
  return kind === "calving";
}

/**
 * Who a kind can be written against.
 *
 * The same narrowing the screens behind these writes already make: health and
 * weights are cattle-only (the pets screen writes to the same tables, and the
 * health screen draws doses out of the cattle fridge), calving, heats and
 * breeding are active cattle females, and a move is anything on the place —
 * dogs and cats included, since a livestock guardian dog lives with the flock
 * and barn cats live in the barn. Notes and photos go on anything on the
 * place too.
 */
export function eligible(kind: LogKind, animal: Animal): boolean {
  const onPlace = animal.status === "active" || animal.status === "boarding";
  switch (kind) {
    case "treatment":
    case "weight":
      return animal.species === "cattle" && animal.status === "active";
    case "calving":
    case "heat":
    case "breeding":
      return animal.species === "cattle" && animal.sex === "female" && animal.status === "active";
    case "move":
      return onPlace;
    case "photo":
    case "note":
      return onPlace;
    default:
      return false;
  }
}

/** The kind that pairs with this one on a shared tile, if any. */
export function partnerOf(kind: LogKind): LogKind | undefined {
  if (kind === "heat") return "breeding";
  if (kind === "breeding") return "heat";
  if (kind === "note") return "photo";
  if (kind === "photo") return "note";
  return undefined;
}

export type Step = 1 | 2 | 3 | 4;

export interface LogStart {
  readonly kind: LogKind | undefined;
  readonly animalIds: readonly Ulid[];
  readonly step: Step;
}

/**
 * Where the flow opens, from the query string.
 *
 * A kind skips step 1. Animals preselect step 2, and skip it too when a kind
 * came with them — "Treatment" on her page means *her* treatment, and asking
 * who again would be a tap for nothing. Animals that cannot take the kind (a
 * steer sent to Heat) are dropped, and if that leaves nobody, step 2 opens so
 * somebody can choose. A calving keeps only the first cow.
 */
export function startFrom(
  params: { readonly kind: string | null; readonly animals: string | null },
  animals: readonly Animal[],
): LogStart {
  const kind = isLogKind(params.kind) ? params.kind : undefined;
  const asked = (params.animals ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "") as Ulid[];

  const known = new Map(animals.map((animal) => [animal.id, animal]));
  let ids = [...new Set(asked)].filter((id) => {
    const animal = known.get(id);
    if (animal === undefined) return false;
    return kind === undefined || !needsAnimals(kind) || eligible(kind, animal);
  });
  if (kind !== undefined && singleAnimal(kind)) ids = ids.slice(0, 1);

  if (kind === undefined) return { kind, animalIds: ids, step: 1 };
  if (!needsAnimals(kind)) return { kind, animalIds: ids, step: 3 };
  return { kind, animalIds: ids, step: ids.length > 0 ? 3 : 2 };
}

export function plural(count: number, noun: string, many = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : many}`;
}

/** Where Close and Done go when the Log was not opened from anywhere in particular. */
export const LOG_HOME = "/admin";

/**
 * Where Close and Done go: back to the page the Log was opened from.
 *
 * Every way in carries `?from=` — Weight on Andromeda's page closes back to
 * her page, ＋ Log in the tab bar back to whatever was underneath. Only an
 * admin page is honoured, so a crafted link cannot send someone off the site
 * or round in a loop back into the Log.
 */
export function returnTo(from: string | null | undefined): string {
  if (from === null || from === undefined) return LOG_HOME;
  const inAdmin = from === "/admin" || from.startsWith("/admin/") || from.startsWith("/admin?");
  const isLog =
    from === "/admin/log" || from.startsWith("/admin/log/") || from.startsWith("/admin/log?");
  if (!inAdmin || isLog || from.includes("\\") || from.includes("//")) return LOG_HOME;
  return from;
}

/**
 * The Log's address, opened part-way and knowing where to close back to.
 *
 * `flock` preselects the flock on the eggs form — "Collect eggs" on a flock's
 * page means *that* coop's basket. It is a separate parameter rather than one
 * more id in `animals`, because a flock is not an `Animal` and the who step
 * would quietly drop it.
 */
export function logHref({
  kind,
  animals = [],
  flock,
  from,
}: {
  readonly kind?: LogKind;
  readonly animals?: readonly Ulid[];
  readonly flock?: Ulid | undefined;
  readonly from?: string | null;
}): string {
  const query = [
    kind === undefined ? undefined : `kind=${kind}`,
    animals.length === 0 ? undefined : `animals=${animals.join(",")}`,
    flock === undefined ? undefined : `flock=${flock}`,
    returnTo(from) === LOG_HOME ? undefined : `from=${encodeURIComponent(returnTo(from))}`,
  ].filter((part) => part !== undefined);
  return query.length === 0 ? "/admin/log" : `/admin/log?${query.join("&")}`;
}
