import type { Crop } from "./beds.js";

/**
 * Which botanical family a crop belongs to, without asking (spec §5.5).
 *
 * The rotation guard runs on the family, and asking somebody to type
 * "Solanaceae" before they can record a tomato was the one field on the crop
 * form that nobody knew the answer to. So the family is *inferred*: a short
 * built-in table of what actually gets grown in a kitchen garden, matched on
 * the crop's name or its scientific name. It needs no network, which is what
 * lets the rotation guard keep working in the barn — the plant search
 * (`/api/plants/search`) is a nicety on top of this, never a dependency.
 *
 * A family somebody typed, or one a search result supplied, always wins over
 * the table: `cropFamily` reads the stored value first and only falls back to
 * the inference when there is none. That keeps the derived value derived (§2)
 * — a crop saved as "Tomato" with no family picks up a better answer the day
 * this table learns one, rather than carrying a stale copy.
 *
 * Families follow APG IV, so onions are Amaryllidaceae rather than the older
 * Alliaceae and beets and spinach are Amaranthaceae rather than
 * Chenopodiaceae. Two spellings of one family would read as two families to
 * the guard, which compares the strings — `normaliseFamily` folds the old
 * names onto the current ones for the same reason.
 */

export interface GardenCrop {
  /** What it is called in a garden, singular. */
  readonly name: string;
  readonly scientificName: string;
  readonly family: string;
  /** Other names it goes by, plurals that are not just "+s", and close kin. */
  readonly aliases?: readonly string[];
}

export const GARDEN_CROPS: readonly GardenCrop[] = [
  // Nightshades
  {
    name: "Tomato",
    scientificName: "Solanum lycopersicum",
    family: "Solanaceae",
    aliases: ["tomatoes", "cherry tomato"],
  },
  {
    name: "Pepper",
    scientificName: "Capsicum annuum",
    family: "Solanaceae",
    aliases: ["bell pepper", "chili", "chile", "chilli", "jalapeno", "jalapeño", "capsicum"],
  },
  {
    name: "Potato",
    scientificName: "Solanum tuberosum",
    family: "Solanaceae",
    aliases: ["potatoes"],
  },
  {
    name: "Eggplant",
    scientificName: "Solanum melongena",
    family: "Solanaceae",
    aliases: ["aubergine", "brinjal"],
  },
  {
    name: "Tomatillo",
    scientificName: "Physalis philadelphica",
    family: "Solanaceae",
    aliases: ["ground cherry"],
  },
  // Brassicas
  { name: "Cabbage", scientificName: "Brassica oleracea", family: "Brassicaceae" },
  {
    name: "Kale",
    scientificName: "Brassica oleracea",
    family: "Brassicaceae",
    aliases: ["collards", "collard greens", "collard"],
  },
  { name: "Broccoli", scientificName: "Brassica oleracea", family: "Brassicaceae" },
  { name: "Cauliflower", scientificName: "Brassica oleracea", family: "Brassicaceae" },
  {
    name: "Brussels sprouts",
    scientificName: "Brassica oleracea",
    family: "Brassicaceae",
    aliases: ["brussels sprout", "sprouts"],
  },
  { name: "Kohlrabi", scientificName: "Brassica oleracea", family: "Brassicaceae" },
  {
    name: "Turnip",
    scientificName: "Brassica rapa",
    family: "Brassicaceae",
    aliases: ["bok choy", "pak choi", "napa cabbage", "chinese cabbage"],
  },
  {
    name: "Mustard",
    scientificName: "Brassica juncea",
    family: "Brassicaceae",
    aliases: ["mustard greens"],
  },
  {
    name: "Radish",
    scientificName: "Raphanus sativus",
    family: "Brassicaceae",
    aliases: ["radishes", "daikon"],
  },
  {
    name: "Arugula",
    scientificName: "Eruca vesicaria",
    family: "Brassicaceae",
    aliases: ["rocket"],
  },
  {
    name: "Rutabaga",
    scientificName: "Brassica napus",
    family: "Brassicaceae",
    aliases: ["swede"],
  },
  // Cucurbits
  {
    name: "Cucumber",
    scientificName: "Cucumis sativus",
    family: "Cucurbitaceae",
    aliases: ["pickling cucumber"],
  },
  {
    name: "Squash",
    scientificName: "Cucurbita pepo",
    family: "Cucurbitaceae",
    aliases: [
      "summer squash",
      "winter squash",
      "zucchini",
      "courgette",
      "butternut",
      "pumpkin",
      "pumpkins",
    ],
  },
  {
    name: "Melon",
    scientificName: "Cucumis melo",
    family: "Cucurbitaceae",
    aliases: ["cantaloupe", "muskmelon", "honeydew"],
  },
  { name: "Watermelon", scientificName: "Citrullus lanatus", family: "Cucurbitaceae" },
  {
    name: "Gourd",
    scientificName: "Lagenaria siceraria",
    family: "Cucurbitaceae",
    aliases: ["luffa", "loofah"],
  },
  // Legumes
  {
    name: "Bean",
    scientificName: "Phaseolus vulgaris",
    family: "Fabaceae",
    aliases: ["green bean", "bush bean", "pole bean", "snap bean", "dry bean"],
  },
  {
    name: "Pea",
    scientificName: "Pisum sativum",
    family: "Fabaceae",
    aliases: ["snap pea", "snow pea", "sugar snap"],
  },
  {
    name: "Southern pea",
    scientificName: "Vigna unguiculata",
    family: "Fabaceae",
    aliases: ["cowpea", "black-eyed pea", "black eyed pea", "purple hull pea"],
  },
  {
    name: "Lima bean",
    scientificName: "Phaseolus lunatus",
    family: "Fabaceae",
    aliases: ["butter bean"],
  },
  { name: "Fava bean", scientificName: "Vicia faba", family: "Fabaceae", aliases: ["broad bean"] },
  { name: "Peanut", scientificName: "Arachis hypogaea", family: "Fabaceae" },
  { name: "Soybean", scientificName: "Glycine max", family: "Fabaceae", aliases: ["edamame"] },
  // Alliums
  {
    name: "Onion",
    scientificName: "Allium cepa",
    family: "Amaryllidaceae",
    aliases: ["shallot", "scallion", "green onion"],
  },
  { name: "Garlic", scientificName: "Allium sativum", family: "Amaryllidaceae" },
  { name: "Leek", scientificName: "Allium ampeloprasum", family: "Amaryllidaceae" },
  {
    name: "Chives",
    scientificName: "Allium schoenoprasum",
    family: "Amaryllidaceae",
    aliases: ["chive"],
  },
  // Umbellifers
  { name: "Carrot", scientificName: "Daucus carota", family: "Apiaceae" },
  { name: "Parsnip", scientificName: "Pastinaca sativa", family: "Apiaceae" },
  { name: "Celery", scientificName: "Apium graveolens", family: "Apiaceae", aliases: ["celeriac"] },
  { name: "Parsley", scientificName: "Petroselinum crispum", family: "Apiaceae" },
  { name: "Dill", scientificName: "Anethum graveolens", family: "Apiaceae" },
  {
    name: "Cilantro",
    scientificName: "Coriandrum sativum",
    family: "Apiaceae",
    aliases: ["coriander"],
  },
  { name: "Fennel", scientificName: "Foeniculum vulgare", family: "Apiaceae" },
  // Daisies
  { name: "Lettuce", scientificName: "Lactuca sativa", family: "Asteraceae", aliases: ["romaine"] },
  { name: "Sunflower", scientificName: "Helianthus annuus", family: "Asteraceae" },
  { name: "Artichoke", scientificName: "Cynara cardunculus", family: "Asteraceae" },
  {
    name: "Endive",
    scientificName: "Cichorium endivia",
    family: "Asteraceae",
    aliases: ["escarole", "radicchio", "chicory"],
  },
  { name: "Zinnia", scientificName: "Zinnia elegans", family: "Asteraceae" },
  {
    name: "Marigold",
    scientificName: "Tagetes erecta",
    family: "Asteraceae",
    aliases: ["calendula"],
  },
  // Amaranths (beets and spinach were Chenopodiaceae)
  { name: "Beet", scientificName: "Beta vulgaris", family: "Amaranthaceae", aliases: ["beetroot"] },
  {
    name: "Swiss chard",
    scientificName: "Beta vulgaris",
    family: "Amaranthaceae",
    aliases: ["chard"],
  },
  { name: "Spinach", scientificName: "Spinacia oleracea", family: "Amaranthaceae" },
  { name: "Amaranth", scientificName: "Amaranthus cruentus", family: "Amaranthaceae" },
  { name: "Quinoa", scientificName: "Chenopodium quinoa", family: "Amaranthaceae" },
  // Grasses
  {
    name: "Corn",
    scientificName: "Zea mays",
    family: "Poaceae",
    aliases: ["sweet corn", "maize", "popcorn"],
  },
  { name: "Sorghum", scientificName: "Sorghum bicolor", family: "Poaceae" },
  { name: "Wheat", scientificName: "Triticum aestivum", family: "Poaceae" },
  // Mallows
  { name: "Okra", scientificName: "Abelmoschus esculentus", family: "Malvaceae" },
  { name: "Cotton", scientificName: "Gossypium hirsutum", family: "Malvaceae" },
  // Mints
  { name: "Basil", scientificName: "Ocimum basilicum", family: "Lamiaceae" },
  {
    name: "Mint",
    scientificName: "Mentha spicata",
    family: "Lamiaceae",
    aliases: ["spearmint", "peppermint"],
  },
  { name: "Oregano", scientificName: "Origanum vulgare", family: "Lamiaceae" },
  { name: "Thyme", scientificName: "Thymus vulgaris", family: "Lamiaceae" },
  { name: "Rosemary", scientificName: "Salvia rosmarinus", family: "Lamiaceae" },
  { name: "Sage", scientificName: "Salvia officinalis", family: "Lamiaceae" },
  // Everything else a kitchen garden commonly holds
  {
    name: "Sweet potato",
    scientificName: "Ipomoea batatas",
    family: "Convolvulaceae",
    aliases: ["sweet potatoes", "yam"],
  },
  {
    name: "Strawberry",
    scientificName: "Fragaria × ananassa",
    family: "Rosaceae",
    aliases: ["strawberries"],
  },
  {
    name: "Blackberry",
    scientificName: "Rubus fruticosus",
    family: "Rosaceae",
    aliases: ["raspberry", "dewberry"],
  },
  {
    name: "Blueberry",
    scientificName: "Vaccinium corymbosum",
    family: "Ericaceae",
    aliases: ["blueberries"],
  },
  { name: "Asparagus", scientificName: "Asparagus officinalis", family: "Asparagaceae" },
  { name: "Rhubarb", scientificName: "Rheum rhabarbarum", family: "Polygonaceae" },
];

/**
 * Old family names, folded onto the ones the table uses.
 *
 * A crop typed as "Alliaceae" last year and one inferred as "Amaryllidaceae"
 * this year are the same onions, and the guard compares strings.
 */
const FAMILY_SYNONYMS: Readonly<Record<string, string>> = {
  alliaceae: "Amaryllidaceae",
  chenopodiaceae: "Amaranthaceae",
  cruciferae: "Brassicaceae",
  leguminosae: "Fabaceae",
  umbelliferae: "Apiaceae",
  compositae: "Asteraceae",
  gramineae: "Poaceae",
  labiatae: "Lamiaceae",
};

/** "solanaceae " → "Solanaceae"; "Alliaceae" → "Amaryllidaceae". */
export function normaliseFamily(family: string | undefined): string | undefined {
  const trimmed = family?.trim() ?? "";
  if (trimmed === "") return undefined;
  const synonym = FAMILY_SYNONYMS[trimmed.toLowerCase()];
  if (synonym !== undefined) return synonym;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

/** Lower case, accents off, punctuation to spaces, one space between words. */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9× ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "tomatoes" → "tomato", "radishes" → "radish", "peas" → "pea". */
function singular(word: string): string {
  if (word.endsWith("oes")) return word.slice(0, -2);
  if (word.endsWith("shes") || word.endsWith("ches")) return word.slice(0, -2);
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** Every name the table answers to, folded and singular, longest first. */
const BY_NAME: ReadonlyArray<readonly [string, GardenCrop]> = GARDEN_CROPS.flatMap((crop) =>
  [crop.name, ...(crop.aliases ?? [])].map(
    (name) => [fold(name).split(" ").map(singular).join(" "), crop] as const,
  ),
).sort((left, right) => right[0].length - left[0].length);

/** Genus → family, from the scientific names in the table. */
const BY_GENUS: ReadonlyMap<string, string> = new Map(
  GARDEN_CROPS.map((crop) => [fold(crop.scientificName).split(" ")[0] ?? "", crop.family]),
);

/**
 * The table's entry for a name, if it has one.
 *
 * Whole name first ("Swiss chard"), then the longest name found as whole words
 * inside it ("Cherokee Purple tomato" → tomato, "sweet corn" → corn rather
 * than nothing). Whole words only, so "peanut" is not a pea.
 */
export function gardenCropFor(name: string | undefined): GardenCrop | undefined {
  const folded = fold(name ?? "")
    .split(" ")
    .map(singular)
    .join(" ");
  if (folded === "") return undefined;

  const padded = ` ${folded} `;
  for (const [known, crop] of BY_NAME) {
    if (known === folded || padded.includes(` ${known} `)) return crop;
  }
  return undefined;
}

/**
 * The family for a crop name (and, failing that, its scientific name's genus).
 *
 * Undefined when the table has never heard of it, which the screens show as
 * "family unknown" and the rotation guard reads as "nothing to check" — the
 * same as a crop with no family before this existed.
 */
export function inferFamily(name: string | undefined, scientificName?: string): string | undefined {
  const byName = gardenCropFor(name);
  if (byName !== undefined) return byName.family;

  const genus = fold(scientificName ?? "").split(" ")[0] ?? "";
  return genus === "" ? undefined : BY_GENUS.get(genus);
}

/**
 * The family the rotation guard reads for a crop: the stored one, else the
 * inferred one.
 */
export function cropFamily(
  crop: Pick<Crop, "name" | "family" | "scientificName"> | undefined,
): string | undefined {
  if (crop === undefined) return undefined;
  return normaliseFamily(crop.family) ?? inferFamily(crop.name, crop.scientificName);
}

/**
 * The built-in table as a search, for the plant picker offline and as the
 * first answers online. Name matches beat alias matches; prefix beats infix.
 */
export function searchGardenCrops(query: string, limit = 8): GardenCrop[] {
  const q = fold(query);
  if (q === "") return [];
  const words = q.split(" ").map(singular);

  const scored: Array<{ crop: GardenCrop; score: number }> = [];
  for (const crop of GARDEN_CROPS) {
    const names = [crop.name, ...(crop.aliases ?? []), crop.scientificName].map(fold);
    let best = 0;
    names.forEach((name, index) => {
      const weight = index === 0 ? 3 : 1;
      const singularName = name.split(" ").map(singular).join(" ");
      if (name === q || singularName === words.join(" ")) best = Math.max(best, 100 * weight);
      else if (name.startsWith(q)) best = Math.max(best, 50 * weight);
      else if (words.some((word) => word.length >= 3 && ` ${singularName} `.includes(` ${word} `)))
        best = Math.max(best, 20 * weight);
      else if (q.length >= 3 && name.includes(q)) best = Math.max(best, 10 * weight);
    });
    if (best > 0) scored.push({ crop, score: best });
  }

  return (
    scored
      // Shorter first on a tie: "tom" means tomato before it means tomatillo.
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.crop.name.length - right.crop.name.length ||
          left.crop.name.localeCompare(right.crop.name),
      )
      .slice(0, limit)
      .map((entry) => entry.crop)
  );
}
