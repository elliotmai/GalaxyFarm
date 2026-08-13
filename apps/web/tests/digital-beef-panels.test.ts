import { describe, expect, it } from "vitest";

import { pedigreeDocuments } from "../lib/digital-beef-panels";

/**
 * Following a page to its own pedigree tab (spec §5.2).
 *
 * The bug this exists for took three rounds to find, and each round looked
 * like a different bug. Digital Beef renders an animal's detail panel
 * server-side and loads the tabs beneath it — pedigree, EPDs, progeny —
 * separately. A plain fetch of the animal's URL comes back with the name, the
 * sex and the colour and **no ancestors at all**, while pasting the page works
 * perfectly, because a browser has already run those requests and a select-all
 * copies what they produced.
 *
 * Every defect result lives on that chart, printed beside each ancestor and
 * never on the animal's own page. So the whole feature was reading a document
 * that could not contain the thing it was looking for, and reporting "nothing
 * has changed".
 *
 * The address is read out of the page rather than hardcoded. A path invented
 * here would break silently the day the template moved, and the failure would
 * be indistinguishable from an animal that genuinely has no pedigree.
 */

const PAGE =
  "https://maine-anjou.digitalbeef.com/modules.php?op=modload&name=_animal&file=_animal&animal_registration=402303";

describe("finding the pedigree tab", () => {
  it("takes the address out of the page's own markup", () => {
    const html = `<script>loadTab("modules.php?op=modload&name=_animal&file=_animal_pedigree&animal_registration=402303");</script>`;

    expect(pedigreeDocuments(html, PAGE)).toEqual([
      "https://maine-anjou.digitalbeef.com/modules.php?op=modload&name=_animal&file=_animal_pedigree&animal_registration=402303",
    ]);
  });

  it("resolves a relative address against the page", () => {
    expect(pedigreeDocuments(`<a href="/ajax/pedigree.php?id=402303">Pedigree</a>`, PAGE)[0]).toBe(
      "https://maine-anjou.digitalbeef.com/ajax/pedigree.php?id=402303",
    );
  });

  it("refuses to leave the host the URL was checked against", () => {
    // The animal's URL is validated against the three known association hosts
    // before anything is fetched. Following an arbitrary link out of a
    // document's markup would give that guarantee away and turn the route into
    // an open proxy for whatever anyone can get into a page.
    expect(pedigreeDocuments(`<img src="https://evil.example.com/pedigree?x=1">`, PAGE)).toEqual(
      [],
    );
  });

  it("ignores a stylesheet or a script named for it", () => {
    const html = `<link href="/css/pedigree.css"><script src="/js/pedigree.js"></script>`;

    expect(pedigreeDocuments(html, PAGE)).toEqual([]);
  });

  it("ignores a class name or a selector containing the word", () => {
    expect(pedigreeDocuments(`<div class="pedigree-panel">`, PAGE)).toEqual([]);
    expect(pedigreeDocuments(`$("#pedigree").show()`, PAGE)).toEqual([]);
  });

  it("does not fetch the page it is already reading", () => {
    expect(pedigreeDocuments(`<a href="${PAGE}">Pedigree</a>`, PAGE)).toEqual([]);
  });

  it("lists each address once, however often the page names it", () => {
    expect(
      pedigreeDocuments(`<a href="/p?pedigree=1">x</a><a href="/p?pedigree=1">y</a>`, PAGE),
    ).toHaveLength(1);
  });

  it("finds nothing in a page that names nothing", () => {
    // The honest answer, and the screen now says it rather than reporting an
    // animal with no ancestors.
    expect(pedigreeDocuments("<html><body>Animal Detail Screen</body></html>", PAGE)).toEqual([]);
  });
});
