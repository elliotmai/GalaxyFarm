/**
 * The URLs a page names for its own pedigree panel.
 *
 * Read out of the markup rather than guessed at. Digital Beef loads its tabs
 * with a script, so the address is written in the page — and taking it from
 * there means this keeps working when the path changes and fails *visibly*
 * when the page stops naming one, instead of silently returning an animal
 * with no ancestors.
 *
 * Same host as the page, always. The animal's URL was checked against the
 * three known association hosts before anything was fetched; following an
 * arbitrary link out of a document's markup would give that check away and
 * make this an open proxy.
 */
export function pedigreeDocuments(html: string, pageUrl: string): string[] {
  const page = new URL(pageUrl);
  const found = new Set<string>();

  for (const [, quoted] of html.matchAll(/["'`]([^"'`\s]*pedigree[^"'`\s]*)["'`]/gi)) {
    const candidate = quoted as string;
    // Selectors, class names and ids also contain the word.
    if (!/[?/]/.test(candidate)) continue;
    if (/\.(?:css|js|png|jpe?g|gif|svg|woff2?)(?:$|\?)/i.test(candidate)) continue;

    try {
      const resolved = new URL(candidate, page);
      if (resolved.hostname.toLowerCase() !== page.hostname.toLowerCase()) continue;
      if (resolved.href === page.href) continue;
      found.add(resolved.href);
    } catch {
      continue;
    }
  }

  return [...found];
}
