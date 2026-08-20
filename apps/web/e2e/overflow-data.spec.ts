import { expect, test, type Page } from "@playwright/test";

import { storageStatePath } from "./session.js";

/**
 * The same width rule, on screens that have something on them.
 *
 * `overflow.spec.ts` walks every route with an empty device store, which is
 * the wrong half of the problem: the screens that were reported as scrolling
 * sideways on a phone are the record lists, and a record list with no records
 * is a paragraph saying there is nothing here. This one puts a herd, a
 * breeding, a treatment, a weight and an ancestor into the device's own store
 * first — with the kind of values a registry actually prints, which is where
 * the width comes from.
 */

const PROPERTY = "01HQ00000000000000000000P0";

async function seed(page: Page) {
  await page.evaluate(async (propertyId) => {
    const open = (): Promise<IDBDatabase> =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("galaxy-farm");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

    const db = await open();
    const now = new Date();
    const base = (n: number) => ({
      id: `01HQ0000000000000000000${String(n).padStart(3, "0")}`,
      propertyId,
      createdAt: now,
      updatedAt: now,
    });

    const rows: Record<string, unknown[]> = {
      animals: [
        {
          ...base(10),
          species: "cattle",
          name: "Andromeda",
          tagNumber: "6001A",
          sex: "female",
          dob: new Date("2021-04-02"),
          dobIsEstimate: false,
          status: "active",
          ownership: "own",
          safetyLevel: 1,
          photoKeys: [],
        },
        {
          ...base(11),
          species: "cattle",
          name: "Cassiopeia",
          tagNumber: "6002A",
          sex: "female",
          dob: new Date("2022-03-14"),
          dobIsEstimate: false,
          status: "active",
          ownership: "own",
          safetyLevel: 1,
          photoKeys: [],
        },
      ],
      cattleProfiles: [
        {
          ...base(20),
          animalId: `01HQ0000000000000000000010`,
          registeredName: "GALAXY FARM ANDROMEDA'S SOLUTION 601P",
          breedComposition: [],
          registrations: [
            { association: "Maine-Anjou", regNumber: "MA364424", status: "registered" },
          ],
          colour: "red roan",
        },
      ],
      breedingRecords: [
        {
          ...base(30),
          damId: `01HQ0000000000000000000010`,
          method: "AI",
          sireName: "ZNT MONTEGO BAY 2416 ET",
          date: new Date("2026-02-14"),
          notes: "Bred at the vet's, technician was running late.",
        },
      ],
      healthRecords: [
        {
          ...base(40),
          animalId: `01HQ0000000000000000000010`,
          date: new Date("2026-05-02"),
          kind: "treatment",
          product: "Draxxin (tulathromycin) 100 mg/mL",
          dose: "6 mL subcutaneous",
          withdrawalDays: 18,
          administeredBy: "Dr. Wilhelmina Fotheringay-Smythe",
          notes: "Right shoulder.",
        },
      ],
      weightRecords: [
        {
          ...base(50),
          animalId: `01HQ0000000000000000000010`,
          date: new Date("2026-05-02"),
          weightLb: 1284,
          context: "routine",
        },
      ],
      externalAnimals: [
        {
          ...base(60),
          name: "SULL TINA'S SOLUTION ET 4157771",
          regNumber: "4157771",
          association: "Shorthorn",
          sourceUrl:
            "https://www.shorthorn.org/animal-search/detail/?regnumber=4219133&herdbook=american-shorthorn-association",
          registrations: [
            { association: "Shorthorn", regNumber: "4157771" },
            { association: "Maine-Anjou", regNumber: "MA364424" },
            { association: "Chianina", regNumber: "CA240047" },
            { association: "Angus", regNumber: "AR30478" },
          ],
        },
      ],
      purchaseCandidates: [
        {
          ...base(80),
          module: "cattle",
          title: "Pair of bred Maine-Anjou heifers, AI'd to SULL Solution",
          status: "considering",
          askingPrice: { cents: 450000 },
          // A real listing link: long, and with nowhere to break.
          listingUrl:
            "https://www.superiorlivestock.com/auctions/2026-fall-classic/lots/1184-bred-heifers-maine-anjou?utm_source=newsletter",
          location: "Cedar Falls, Iowa",
          sex: "female",
          notes: "Seller says they are AI'd; asked for the breeding paperwork.",
        },
      ],
      calvingRecords: [
        {
          ...base(70),
          damId: `01HQ0000000000000000000011`,
          date: new Date("2026-01-18"),
          calvingEase: 2,
          birthType: "pulled",
          vigour: "vigorous",
          calfSex: "female",
          birthWeightLb: 82,
          assisted: true,
          assistDetail: "One person, chains, twenty minutes.",
        },
      ],
    };

    for (const [store, records] of Object.entries(rows)) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, "readwrite");
        for (const record of records) tx.objectStore(store).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
    db.close();
  }, PROPERTY);
}

/**
 * What is sticking out, in the terms somebody would go and fix it in.
 *
 * Anything inside a horizontal scroller is skipped. The tab strip and the wide
 * tables are *meant* to run past their box — that is what `overflow-x: auto`
 * is for, and their children's right edges say so without the page being any
 * wider. Reporting them buries the one element that actually widened it.
 */
async function overflowReport(page: Page) {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const offenders: { tag: string; className: string; right: number; text: string }[] = [];

    const inAScroller = (element: HTMLElement): boolean => {
      for (let node = element.parentElement; node !== null; node = node.parentElement) {
        const overflow = getComputedStyle(node).overflowX;
        if (overflow === "auto" || overflow === "scroll" || overflow === "hidden") return true;
      }
      return false;
    };

    for (const element of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;
      if (box.right <= limit + 1) continue;
      if (inAScroller(element)) continue;
      // Only the outermost: every descendant of one wide row is one row.
      if (element.parentElement !== null) {
        const parent = element.parentElement.getBoundingClientRect();
        if (parent.right > limit + 1 && !inAScroller(element.parentElement)) continue;
      }
      offenders.push({
        tag: element.tagName.toLowerCase(),
        className: typeof element.className === "string" ? element.className : "",
        right: Math.round(box.right),
        text: (element.textContent ?? "").trim().slice(0, 80),
      });
    }

    return { limit, scrollWidth: document.documentElement.scrollWidth, offenders };
  });
}

const ROUTES = [
  "/admin/cattle",
  "/admin/cattle/breeding",
  "/admin/cattle/calving",
  "/admin/cattle/health",
  "/admin/cattle/weights",
  "/admin/cattle/ancestors",
  "/admin/cattle/candidates",
  "/admin/cattle/supplies",
  "/admin/cattle/sales",
  "/admin/cattle/roadmap",
  "/admin/calendar",
  "/admin/reports",
  "/admin/settings",
];

/**
 * Two widths, because the phone that reported this is narrower than the one
 * the suite emulates by default. 375 is an iPhone SE or a mini and is the
 * strictest thing anybody here carries; 390 is the ordinary modern iPhone.
 */
const WIDTHS = [375, 390];

for (const width of WIDTHS) {
  test.describe(`a ${width}px page with records on it`, () => {
    test.use({ storageState: storageStatePath("owner"), viewport: { width, height: 844 } });

    for (const route of ROUTES) {
      test(`does not scroll sideways: ${route}`, async ({ page }) => {
        await page.goto("/admin");
        await page.waitForLoadState("domcontentloaded");
        await seed(page);

        await page.goto(route);
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(1500);

        const report = await overflowReport(page);
        // The elements, not `document.scrollWidth`: the surface clips its
        // overflow so a stray element no longer widens the page — which is the
        // point of the clip, and would be the end of this test if it kept
        // measuring the page instead of what is in it.
        expect(
          report.offenders,
          `${route} has something wider than ${width}px: ${JSON.stringify(report.offenders, null, 2)}`,
        ).toEqual([]);
        expect(report.scrollWidth).toBeLessThanOrEqual(report.limit + 1);
      });
    }
  });
}
