import { cropFamily } from "./families.js";
import { gardenCropFor } from "./families.js";

/**
 * Which crops do well beside each other, and which do badly (spec §5.5).
 *
 * Built in and offline, like the growing table: the pairings below are the
 * ones the extension services and long garden practice agree on, each with
 * the reason a gardener would give, because "these two are bad together" with
 * no reason is a rule nobody remembers. Companion planting is a mix of real
 * effects (shared pests and blights, one crop shading or out-competing
 * another, a herb confusing a pest) and folklore; this keeps to the first.
 *
 * Keyed by the family table's crop names, so "Cherokee Purple tomato" and
 * "Roma" both find the tomato's pairings. One rule is written by family
 * rather than by crop: onions, garlic, leeks and chives all stunt beans and
 * peas, and listing all twenty pairs would be twenty chances to miss one.
 */

export type Companionship = "good" | "bad";

export interface Pairing {
  readonly with: string;
  readonly kind: Companionship;
  readonly why: string;
}

const PAIRS: readonly (readonly [string, string, Companionship, string])[] = [
  // Good together
  ["Tomato", "Basil", "good", "Basil is said to deter hornworms and thrips"],
  ["Tomato", "Marigold", "good", "Marigolds deter root-knot nematodes"],
  ["Tomato", "Carrot", "good", "Different root depths; carrots use the space under tomatoes"],
  ["Tomato", "Onion", "good", "The smell confuses pests that find tomatoes by scent"],
  ["Tomato", "Parsley", "good", "Draws hoverflies that eat aphids"],
  ["Pepper", "Basil", "good", "Basil deters aphids and thrips"],
  ["Pepper", "Onion", "good", "Alliums mask the peppers from pests"],
  ["Eggplant", "Bean", "good", "Beans repel Colorado potato beetles"],
  ["Bean", "Corn", "good", "Corn is a pole for the beans; beans feed the corn nitrogen"],
  ["Bean", "Squash", "good", "The three sisters: squash shades out weeds beneath"],
  ["Corn", "Squash", "good", "The three sisters: squash shades the corn's roots"],
  ["Bean", "Carrot", "good", "Beans fix nitrogen the carrots use"],
  ["Bean", "Cucumber", "good", "Beans fix nitrogen; cucumbers climb alongside"],
  ["Bean", "Potato", "good", "Beans repel Colorado potato beetles"],
  ["Cucumber", "Dill", "good", "Dill draws wasps and hoverflies that eat cucumber pests"],
  ["Cucumber", "Radish", "good", "Radishes deter cucumber beetles"],
  ["Cucumber", "Sunflower", "good", "Sunflowers give cucumbers something to climb"],
  ["Lettuce", "Radish", "good", "Radishes are up and out before the lettuce needs the room"],
  ["Lettuce", "Carrot", "good", "Shallow and deep roots share one bed"],
  ["Carrot", "Onion", "good", "Onions mask carrots from the carrot fly"],
  ["Carrot", "Leek", "good", "Leeks deter carrot fly; carrots deter onion fly"],
  ["Beet", "Onion", "good", "No shared pests, and they fill a bed well together"],
  ["Cabbage", "Dill", "good", "Dill draws wasps that eat cabbage worms"],
  ["Cabbage", "Onion", "good", "Alliums deter cabbage loopers and maggots"],
  ["Broccoli", "Onion", "good", "Alliums deter cabbage pests"],
  ["Kale", "Beet", "good", "Different nutrient needs and root depths"],
  ["Spinach", "Strawberry", "good", "Spinach fills the space between strawberry crowns"],
  ["Strawberry", "Bean", "good", "Beans fix nitrogen the strawberries use"],
  ["Pea", "Carrot", "good", "Peas fix nitrogen; carrots grow beneath"],
  ["Pea", "Radish", "good", "Radishes break the soil and are out before the peas spread"],
  ["Melon", "Marigold", "good", "Marigolds deter nematodes and beetles"],
  ["Squash", "Marigold", "good", "Marigolds deter squash bugs"],
  ["Potato", "Marigold", "good", "Marigolds deter nematodes"],
  ["Lettuce", "Chives", "good", "Chives deter aphids"],
  ["Pepper", "Carrot", "good", "Carrots use the ground under the peppers"],

  // Bad together
  ["Tomato", "Fennel", "bad", "Fennel stunts most vegetables near it"],
  ["Tomato", "Potato", "bad", "Both nightshades: they share early and late blight"],
  ["Tomato", "Corn", "bad", "Both are hit by the corn earworm (tomato fruitworm)"],
  ["Tomato", "Cabbage", "bad", "Brassicas and tomatoes stunt each other"],
  ["Tomato", "Broccoli", "bad", "Brassicas and tomatoes stunt each other"],
  ["Tomato", "Kale", "bad", "Brassicas and tomatoes stunt each other"],
  ["Tomato", "Dill", "bad", "Mature dill stunts tomatoes"],
  ["Pepper", "Fennel", "bad", "Fennel stunts most vegetables near it"],
  ["Bean", "Fennel", "bad", "Fennel stunts most vegetables near it"],
  ["Cucumber", "Potato", "bad", "Potatoes are more prone to blight beside cucumbers"],
  ["Cucumber", "Sage", "bad", "Sage stunts cucumbers"],
  ["Potato", "Squash", "bad", "They compete hard for water and nutrients and share blight"],
  ["Potato", "Sunflower", "bad", "Sunflowers suppress potato growth"],
  ["Carrot", "Dill", "bad", "Related plants that cross-pollinate and share pests"],
  ["Cabbage", "Strawberry", "bad", "Brassicas stunt strawberries"],
  ["Broccoli", "Strawberry", "bad", "Brassicas stunt strawberries"],
  ["Asparagus", "Onion", "bad", "Onions stunt asparagus"],
  ["Asparagus", "Garlic", "bad", "Garlic stunts asparagus"],
  ["Lettuce", "Parsley", "bad", "Parsley crowds lettuce out as it grows"],
];

/** Alliums stunt legumes — every onion, garlic, leek and chive against every bean and pea. */
const ALLIUM = "Amaryllidaceae";
const LEGUME = "Fabaceae";
const ALLIUM_LEGUME_WHY = "Onions, garlic, leeks and chives stunt beans and peas";

/** The family table's name for a crop, or the name itself for a plant it does not know. */
function canonical(name: string): string {
  return gardenCropFor(name)?.name ?? name.trim();
}

function familyOf(name: string): string | undefined {
  return cropFamily({ name });
}

/**
 * How two crops get on, or undefined when nothing is known either way.
 *
 * Order does not matter. A crop beside itself is not a pairing.
 */
export function companionship(left: string, right: string): Pairing | undefined {
  const a = canonical(left);
  const b = canonical(right);
  if (a.toLowerCase() === b.toLowerCase()) return undefined;

  for (const [x, y, kind, why] of PAIRS) {
    if ((x === a && y === b) || (x === b && y === a)) return { with: b, kind, why };
  }

  const families = [familyOf(a), familyOf(b)];
  if (families.includes(ALLIUM) && families.includes(LEGUME)) {
    return { with: b, kind: "bad", why: ALLIUM_LEGUME_WHY };
  }
  return undefined;
}

/** Everything known about one crop's neighbours, friends first. */
export function companionsOf(name: string): { good: Pairing[]; bad: Pairing[] } {
  const a = canonical(name);
  const good: Pairing[] = [];
  const bad: Pairing[] = [];
  for (const [x, y, kind, why] of PAIRS) {
    if (x !== a && y !== a) continue;
    const other = x === a ? y : x;
    (kind === "good" ? good : bad).push({ with: other, kind, why });
  }
  const family = familyOf(a);
  if (family === ALLIUM || family === LEGUME) {
    bad.push({
      with: family === ALLIUM ? "Beans and peas" : "Onions, garlic, leeks and chives",
      kind: "bad",
      why: ALLIUM_LEGUME_WHY,
    });
  }
  return { good, bad };
}

/**
 * The clashes among crops sharing a bed: each bad pair once.
 *
 * What the bed's view and the planting form warn with. Warn, never block —
 * the gardener may know their own soil better than the folklore.
 */
export function clashesAmong(
  names: readonly string[],
): { readonly a: string; readonly b: string; readonly why: string }[] {
  const unique = [...new Set(names.map(canonical))];
  const clashes: { a: string; b: string; why: string }[] = [];
  for (let i = 0; i < unique.length; i += 1) {
    for (let j = i + 1; j < unique.length; j += 1) {
      const pairing = companionship(unique[i]!, unique[j]!);
      if (pairing?.kind === "bad") clashes.push({ a: unique[i]!, b: unique[j]!, why: pairing.why });
    }
  }
  return clashes;
}
