import type { GrowingFacts } from "./growing.js";

/**
 * The kinds of a crop a gardener actually means (spec §5.5).
 *
 * "Pepper" is one species to a botanist and half a dozen plants to anybody
 * who grows them: a bell is picked green at 75 days, a habanero wants ten
 * weeks inside and a long hot summer, and nobody puts either in a salsa by
 * mistake. Zucchini is ready in fifty days and butternut in a hundred. Every
 * plant database worth the name stops at the species — *Capsicum annuum* —
 * which is exactly the level at which these are all the same thing.
 *
 * So the kinds live here, under the crop they belong to. A kind inherits its
 * crop's family, companions and rotation (a jalapeño is still a nightshade
 * after tomatoes) and its crop's growing facts, and overrides only the figures
 * that differ: days, spacing, how long it picks, how early it starts inside.
 * `note` is the line somebody tells kinds apart by — "Hot", "Winter squash ·
 * keeps for months" — never a Latin name.
 *
 * Typical US figures, like the crop table; a variety's packet will differ and
 * the variety keeps its own.
 */

export interface GardenKind {
  /** What it is called, as it goes on a seed list: "Jalapeño pepper". */
  readonly name: string;
  /** The built-in crop it is a kind of, by that crop's `name`. */
  readonly crop: string;
  /** How it differs, in a gardener's words: "Hot · thick-walled". */
  readonly note: string;
  /** Other names it goes by. */
  readonly aliases?: readonly string[];
  /** Only what differs from the crop's own facts. */
  readonly growing?: Partial<GrowingFacts>;
}

export const GARDEN_KINDS: readonly GardenKind[] = [
  // Peppers — heat first, because it is the question.
  {
    name: "Bell pepper",
    crop: "Pepper",
    note: "Sweet · blocky, picked green or left to ripen",
    aliases: ["bell", "bell peppers", "sweet pepper", "green pepper", "red pepper"],
    growing: { daysToMaturity: 75 },
  },
  {
    name: "Jalapeño pepper",
    crop: "Pepper",
    note: "Hot · medium heat, thick-walled, picked green",
    aliases: ["jalapeño", "jalapeno", "jalapenos", "jalapeños", "jalapeno pepper"],
    growing: { daysToMaturity: 70, spacingInches: 15 },
  },
  {
    name: "Serrano pepper",
    crop: "Pepper",
    note: "Hot · hotter than a jalapeño, slim",
    aliases: ["serrano"],
    growing: { daysToMaturity: 75 },
  },
  {
    name: "Poblano pepper",
    crop: "Pepper",
    note: "Mild · for stuffing and roasting; dried, an ancho",
    aliases: ["poblano", "ancho"],
    growing: { daysToMaturity: 70 },
  },
  {
    name: "Anaheim pepper",
    crop: "Pepper",
    note: "Mild · long green chile for roasting",
    aliases: ["anaheim", "hatch chile", "hatch pepper", "new mexico chile", "green chile"],
    growing: { daysToMaturity: 75 },
  },
  {
    name: "Banana pepper",
    crop: "Pepper",
    note: "Mild · yellow and tangy, for pickling",
    aliases: ["banana peppers", "hungarian wax", "hungarian wax pepper", "pepperoncini"],
    growing: { daysToMaturity: 65, spacingInches: 15 },
  },
  {
    name: "Shishito pepper",
    crop: "Pepper",
    note: "Mild · thin-walled, blistered in a pan",
    aliases: ["shishito", "padron", "padron pepper"],
    growing: { daysToMaturity: 60, spacingInches: 15 },
  },
  {
    name: "Cayenne pepper",
    crop: "Pepper",
    note: "Hot · long and thin, for drying and flakes",
    aliases: ["cayenne"],
    growing: { daysToMaturity: 75 },
  },
  {
    name: "Thai chili",
    crop: "Pepper",
    note: "Very hot · small, dozens to a plant",
    aliases: ["thai pepper", "thai chile", "bird's eye chili", "birds eye pepper"],
    growing: { daysToMaturity: 85, spacingInches: 12 },
  },
  {
    name: "Habanero pepper",
    crop: "Pepper",
    note: "Very hot · fruity; slow, needs a long hot summer",
    aliases: ["habanero", "habaneros", "scotch bonnet"],
    growing: { daysToMaturity: 95, startIndoorsWeeks: 10, germinationDays: 14 },
  },
  {
    name: "Ghost pepper",
    crop: "Pepper",
    note: "Extremely hot · very slow to start and to ripen",
    aliases: ["bhut jolokia", "ghost chili"],
    growing: {
      daysToMaturity: 120,
      spacingInches: 24,
      startIndoorsWeeks: 10,
      germinationDays: 21,
    },
  },

  // Tomatoes — by what they are for.
  {
    name: "Cherry tomato",
    crop: "Tomato",
    note: "Bite-size · first to ripen, picks all summer",
    aliases: ["cherry tomatoes"],
    growing: { daysToMaturity: 65, harvestWeeks: 12 },
  },
  {
    name: "Grape tomato",
    crop: "Tomato",
    note: "Small and firm · keeps well on the counter",
    aliases: ["grape tomatoes"],
    growing: { daysToMaturity: 65, harvestWeeks: 12 },
  },
  {
    name: "Paste tomato",
    crop: "Tomato",
    note: "For sauce and canning · meaty, few seeds",
    aliases: ["roma", "roma tomato", "plum tomato", "san marzano", "sauce tomato"],
    growing: { daysToMaturity: 75, spacingInches: 18, harvestWeeks: 4 },
  },
  {
    name: "Slicing tomato",
    crop: "Tomato",
    note: "Round · for sandwiches and salads",
    aliases: ["slicer", "slicer tomato", "salad tomato"],
    growing: { daysToMaturity: 75 },
  },
  {
    name: "Beefsteak tomato",
    crop: "Tomato",
    note: "Big slicers · late, needs a sturdy cage",
    aliases: ["beefsteak", "heirloom tomato"],
    growing: { daysToMaturity: 85, spacingInches: 30 },
  },

  // Squash — summer is picked young, winter is cured and stored.
  {
    name: "Zucchini",
    crop: "Squash",
    note: "Summer squash · pick small, pick often",
    aliases: ["courgette", "zucchinis", "green zucchini"],
    growing: { daysToMaturity: 50, spacingInches: 24, harvestWeeks: 10 },
  },
  {
    name: "Yellow squash",
    crop: "Squash",
    note: "Summer squash · crookneck or straightneck",
    aliases: ["summer squash", "crookneck", "straightneck", "yellow crookneck"],
    growing: { daysToMaturity: 50, spacingInches: 24, harvestWeeks: 10 },
  },
  {
    name: "Pattypan squash",
    crop: "Squash",
    note: "Summer squash · scalloped, flying-saucer shape",
    aliases: ["pattypan", "scallop squash"],
    growing: { daysToMaturity: 55, spacingInches: 24, harvestWeeks: 10 },
  },
  {
    name: "Butternut squash",
    crop: "Squash",
    note: "Winter squash · cured, keeps for months",
    aliases: ["butternut", "winter squash"],
    growing: { daysToMaturity: 100, spacingInches: 36, harvestWeeks: 3 },
  },
  {
    name: "Acorn squash",
    crop: "Squash",
    note: "Winter squash · small, ribbed, keeps a couple of months",
    aliases: ["acorn"],
    growing: { daysToMaturity: 85, spacingInches: 36, harvestWeeks: 3 },
  },
  {
    name: "Spaghetti squash",
    crop: "Squash",
    note: "Winter squash · flesh pulls into strands",
    aliases: ["spaghetti"],
    growing: { daysToMaturity: 90, spacingInches: 36, harvestWeeks: 3 },
  },
  {
    name: "Delicata squash",
    crop: "Squash",
    note: "Winter squash · thin skin you can eat",
    aliases: ["delicata"],
    growing: { daysToMaturity: 100, spacingInches: 36, harvestWeeks: 3 },
  },
  {
    name: "Pumpkin",
    crop: "Squash",
    note: "Winter squash · vines run far; for pie or carving",
    aliases: ["pumpkins", "pie pumpkin", "jack o lantern", "carving pumpkin"],
    growing: { daysToMaturity: 110, spacingInches: 60, harvestWeeks: 3 },
  },

  // Cucumbers and melons.
  {
    name: "Slicing cucumber",
    crop: "Cucumber",
    note: "For salads · long and smooth",
    aliases: ["slicer cucumber", "salad cucumber"],
    growing: { daysToMaturity: 60 },
  },
  {
    name: "Pickling cucumber",
    crop: "Cucumber",
    note: "For pickles · short and bumpy, picked small",
    aliases: ["pickling cucumbers", "pickler", "gherkin", "cornichon"],
    growing: { daysToMaturity: 55 },
  },
  {
    name: "English cucumber",
    crop: "Cucumber",
    note: "Thin-skinned and nearly seedless · best on a trellis",
    aliases: ["seedless cucumber", "burpless cucumber", "persian cucumber"],
    growing: { daysToMaturity: 65 },
  },
  {
    name: "Cantaloupe",
    crop: "Melon",
    note: "Netted skin, orange flesh · slips off the vine when ripe",
    aliases: ["cantaloupes", "muskmelon"],
    growing: { daysToMaturity: 85 },
  },
  {
    name: "Honeydew",
    crop: "Melon",
    note: "Smooth skin, green flesh · late, wants heat",
    aliases: ["honeydew melon"],
    growing: { daysToMaturity: 100 },
  },

  // Lettuce — by head.
  {
    name: "Leaf lettuce",
    crop: "Lettuce",
    note: "Loose leaves · cut-and-come-again, the quickest",
    aliases: ["looseleaf lettuce", "loose leaf lettuce", "lettuce mix", "mesclun"],
    growing: { daysToMaturity: 45, spacingInches: 6, harvestWeeks: 6 },
  },
  {
    name: "Romaine lettuce",
    crop: "Lettuce",
    note: "Tall, crunchy heads · holds in the heat a little longer",
    aliases: ["romaine", "cos lettuce"],
    growing: { daysToMaturity: 70, spacingInches: 10 },
  },
  {
    name: "Butterhead lettuce",
    crop: "Lettuce",
    note: "Soft, loose heads · Bibb and Boston",
    aliases: ["butterhead", "bibb lettuce", "boston lettuce", "butter lettuce"],
    growing: { daysToMaturity: 60, spacingInches: 10 },
  },
  {
    name: "Iceberg lettuce",
    crop: "Lettuce",
    note: "Tight crisp heads · slow, bolts in heat",
    aliases: ["iceberg", "crisphead lettuce"],
    growing: { daysToMaturity: 80, spacingInches: 12 },
  },

  // Onions — the day length matters more than the colour.
  {
    name: "Yellow onion",
    crop: "Onion",
    note: "The all-purpose storing onion",
    aliases: ["yellow onions", "storage onion"],
  },
  {
    name: "Red onion",
    crop: "Onion",
    note: "Mild enough to eat raw · stores less well",
    aliases: ["red onions", "purple onion"],
    growing: { daysToMaturity: 110 },
  },
  {
    name: "Sweet onion",
    crop: "Onion",
    note: "Mild and juicy · short-day, for the South; does not store",
    aliases: ["vidalia", "walla walla", "short-day onion"],
    growing: { daysToMaturity: 110 },
  },
  {
    name: "Green onion",
    crop: "Onion",
    note: "Pulled young for the tops · sow every few weeks",
    aliases: ["green onions", "scallion", "scallions", "spring onion", "bunching onion"],
    growing: { daysToMaturity: 60, spacingInches: 2, sowing: "direct", successionDays: 21 },
  },
  {
    name: "Shallot",
    crop: "Onion",
    note: "Clusters of small bulbs · planted from sets",
    aliases: ["shallots"],
    growing: { daysToMaturity: 100, spacingInches: 6 },
  },

  // Beans and peas — how they grow, and what you eat.
  {
    name: "Green bean (bush)",
    crop: "Bean",
    note: "Compact plant · no trellis needed, picks in a rush",
    aliases: [
      "green bean",
      "green beans",
      "bush bean",
      "bush beans",
      "snap bean",
      "snap beans",
      "string bean",
      "string beans",
    ],
    growing: { daysToMaturity: 55, spacingInches: 4, harvestWeeks: 3 },
  },
  {
    name: "Green bean (pole)",
    crop: "Bean",
    note: "Climbs · needs a trellis, picks all summer",
    aliases: ["pole bean", "pole beans", "runner bean", "runner beans", "climbing bean"],
    growing: { daysToMaturity: 65, spacingInches: 6, harvestWeeks: 8 },
  },
  {
    name: "Dry bean",
    crop: "Bean",
    note: "Left to dry on the plant · black, pinto, kidney",
    aliases: ["dry beans", "dried beans", "black bean", "pinto bean", "kidney bean", "navy bean"],
    growing: { daysToMaturity: 95, harvestWeeks: 2 },
  },
  {
    name: "Snap pea",
    crop: "Pea",
    note: "Eat the whole pod · fat and sweet",
    aliases: ["snap peas", "sugar snap", "sugar snap pea"],
    growing: { daysToMaturity: 65 },
  },
  {
    name: "Snow pea",
    crop: "Pea",
    note: "Flat pods eaten whole · for stir-fries",
    aliases: ["snow peas", "chinese pea pod"],
    growing: { daysToMaturity: 60 },
  },
  {
    name: "Shelling pea",
    crop: "Pea",
    note: "Shell out the peas · the pod is too tough to eat",
    aliases: ["shelling peas", "english pea", "garden pea"],
    growing: { daysToMaturity: 65 },
  },

  // Corn.
  {
    name: "Sweet corn",
    crop: "Corn",
    note: "Picked in the milk stage · plant in blocks to pollinate",
    aliases: ["sweetcorn", "corn on the cob"],
  },
  {
    name: "Popcorn",
    crop: "Corn",
    note: "Dried on the stalk · keep apart from sweet corn",
    aliases: ["pop corn"],
    growing: { daysToMaturity: 105 },
  },

  // Potatoes — by what they do in the kitchen.
  {
    name: "Russet potato",
    crop: "Potato",
    note: "Baking and fries · late, stores best",
    aliases: ["russet", "russets", "baking potato", "idaho potato"],
    growing: { daysToMaturity: 110 },
  },
  {
    name: "Yukon Gold potato",
    crop: "Potato",
    note: "Yellow, all-purpose · buttery",
    aliases: ["yukon gold", "yellow potato", "gold potato"],
    growing: { daysToMaturity: 90 },
  },
  {
    name: "Red potato",
    crop: "Potato",
    note: "Waxy, for boiling and salads · early",
    aliases: ["red potatoes", "red bliss", "new potato", "new potatoes"],
    growing: { daysToMaturity: 80 },
  },
  {
    name: "Fingerling potato",
    crop: "Potato",
    note: "Small and finger-shaped · waxy",
    aliases: ["fingerling", "fingerlings"],
    growing: { daysToMaturity: 100 },
  },

  // Greens that were hiding under another name.
  {
    name: "Curly kale",
    crop: "Kale",
    note: "Ruffled leaves · the hardiest",
    aliases: ["curly kale", "scotch kale"],
  },
  {
    name: "Lacinato kale",
    crop: "Kale",
    note: "Dark, flat, bumpy leaves · dinosaur or Tuscan kale",
    aliases: ["dinosaur kale", "dino kale", "tuscan kale", "cavolo nero"],
    growing: { daysToMaturity: 60 },
  },
  {
    name: "Collard greens",
    crop: "Kale",
    note: "Big flat leaves · takes heat and frost",
    aliases: ["collards", "collard"],
    growing: { daysToMaturity: 75, spacingInches: 18 },
  },
  {
    name: "Bok choy",
    crop: "Turnip",
    note: "Asian green · quick, bolts in heat",
    aliases: ["pak choi", "pak choy", "baby bok choy"],
    growing: { daysToMaturity: 45, spacingInches: 8, sowing: "either" },
  },
  {
    name: "Napa cabbage",
    crop: "Turnip",
    note: "Asian heading cabbage · a fall crop",
    aliases: ["chinese cabbage", "napa", "wombok"],
    growing: { daysToMaturity: 70, spacingInches: 12, sowing: "either" },
  },
  {
    name: "Daikon radish",
    crop: "Radish",
    note: "Long white winter radish · sow in late summer",
    aliases: ["daikon", "winter radish", "japanese radish"],
    growing: { daysToMaturity: 60, spacingInches: 4 },
  },
];
