/**
 * USDA plant hardiness zone from a ZIP code (spec §5.1).
 *
 * §5.1: "growingZone (auto-suggested from ZIP against the USDA dataset,
 * editable)". Both halves of that are load-bearing. The suggestion saves
 * somebody looking it up; the *editable* saves them from a wrong one, and a
 * wrong one is entirely possible — a zone boundary can run through a county,
 * and this farm sits near the 7b/8a line.
 *
 * The lookup is a third-party mirror of the USDA map rather than the USDA's
 * own service, which publishes a raster rather than an API. So it is a
 * suggestion presented as a suggestion, never written without being shown.
 */

const ENDPOINT = "https://phzmapi.org";

export interface HardinessOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly endpoint?: string;
}

export interface HardinessZone {
  /** "8a". Matches the `growingZone` field's own format. */
  readonly zone: string;
  /** "10 to 15 (F)" — shown alongside, because "8a" means nothing on its own. */
  readonly temperatureRange?: string | undefined;
}

/** Five digits. A ZIP+4 is trimmed; anything else is not a ZIP. */
export function normalizeZip(postalCode: string): string | undefined {
  const match = /^(\d{5})(-\d{4})?$/.exec(postalCode.trim());
  return match?.[1];
}

/**
 * Look one up, or return undefined.
 *
 * Never throws. This is a nicety attached to saving an address, and a farm
 * whose address would not save because a hardiness mirror was down would be a
 * worse farm app than one that quietly leaves the field for somebody to fill
 * in.
 */
export async function hardinessZone(
  postalCode: string,
  options: HardinessOptions = {},
): Promise<HardinessZone | undefined> {
  const zip = normalizeZip(postalCode);
  if (zip === undefined) return undefined;

  const doFetch = options.fetch ?? globalThis.fetch;

  try {
    const response = await doFetch(`${options.endpoint ?? ENDPOINT}/${zip}.json`);
    if (!response.ok) return undefined;

    const body = (await response.json()) as { zone?: string; temperature_range?: string };
    if (typeof body.zone !== "string" || body.zone === "") return undefined;

    return {
      zone: body.zone,
      ...(typeof body.temperature_range === "string"
        ? { temperatureRange: body.temperature_range }
        : {}),
    };
  } catch {
    return undefined;
  }
}
