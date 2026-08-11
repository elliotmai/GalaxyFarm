import { listFiles, readText } from "./workspace.js";

export const APP_DIR = "apps/web/app";
export const SPEC_PATH = "docs/galaxy-farm-spec.md";

export interface SpecRoute {
  /** Route as written in spec §7, minus any trailing wildcard. */
  route: string;
  /** True when the spec wrote it as `/admin/business/*`. */
  wildcard: boolean;
  /** The prose to the right of the route on that line. */
  description: string;
}

/**
 * Routes that spec §7 documents as a single line with their sub-pages listed
 * inline in the description rather than as separate route entries. Children of
 * these are considered documented; children of anything else are not.
 *
 * Keep this list short and justified — it is the one place the route-map check
 * is deliberately loosened, so every entry needs a reason.
 */
export const GROUPED_SPEC_ROUTES: ReadonlyArray<{ route: string; because: string }> = [
  {
    route: "/admin/business",
    because: "spec §7 writes `/admin/business/*` and lists the scaffold sub-pages inline",
  },
  {
    route: "/kiosk",
    because: "spec §7 lists the kiosk boards inline; §4.4 names them individually",
  },
  { route: "/account", because: "spec §7 lists the customer portal sub-pages inline" },
];

/** Strip Next.js route groups — `(admin)` — and turn a file path into a URL path. */
export function routeFromFile(file: string, kind: "page" | "route"): string {
  const rel = file.slice(`${APP_DIR}/`.length);
  const segments = rel
    .split("/")
    .slice(0, -1)
    .filter((s) => !(s.startsWith("(") && s.endsWith(")")))
    .filter((s) => !s.startsWith("_"));
  void kind;
  return "/" + segments.join("/");
}

/** Every user-facing page route present in the app directory. */
export function appPageRoutes(): string[] {
  return listFiles(APP_DIR, ["page.tsx"])
    .filter((f) => f.endsWith("/page.tsx"))
    .map((f) => routeFromFile(f, "page"))
    .sort();
}

/** Every API route handler present in the app directory. */
export function appApiRoutes(): string[] {
  return listFiles(APP_DIR, ["route.ts"])
    .filter((f) => f.endsWith("/route.ts"))
    .map((f) => routeFromFile(f, "route"))
    .sort();
}

/** Route-shaped tokens, used to pick sub-routes out of a description. */
const ROUTE_TOKEN = /\/[a-z][\w-]*(?:\/[\w\-[\]]+)*/g;

/**
 * Parse the route map out of spec §7.
 *
 * The section is a fenced code block of `\/path   description` lines. Two
 * things need reading, not one:
 *
 *   - lines that *start* with a slash, which are the primary entries; and
 *   - routes named inside a description, because the spec documents some
 *     sub-routes inline rather than giving them their own line — for example
 *     `/admin/equipment  fleet · /admin/equipment/[id] · /admin/equipment/roadmap`.
 *
 * Missing the second kind would report genuinely documented routes as
 * undocumented, which trains people to ignore the conformance test.
 */
export function parseSpecRoutes(markdown = readText(SPEC_PATH)): SpecRoute[] {
  const section = /^## 7\. Route map\s*$([\s\S]*?)^## /m.exec(markdown);
  if (!section?.[1]) throw new Error("Could not locate section 7 (Route map) in the spec");

  const fence = /```([\s\S]*?)```/.exec(section[1]);
  if (!fence?.[1]) throw new Error("Section 7 has no fenced route-map block");

  const routes: SpecRoute[] = [];
  const inlineCandidates: Array<{ route: string; parent: string }> = [];

  for (const line of fence[1].split("\n")) {
    if (!line.startsWith("/")) continue;
    const [raw, ...rest] = line.trim().split(/\s{2,}/);
    if (!raw) continue;
    const wildcard = raw.endsWith("/*");
    const route = wildcard ? raw.slice(0, -2) : raw;
    const description = rest.join(" ").trim();
    routes.push({ route, wildcard, description });

    for (const match of description.matchAll(ROUTE_TOKEN)) {
      inlineCandidates.push({ route: match[0], parent: route });
    }
  }

  // Only accept an inline token if it sits under a route the spec already
  // lists — otherwise a stray "10,000 free map loads / month" style fragment
  // could invent routes that do not exist.
  const known = new Set(routes.map((r) => r.route));
  for (const { route, parent } of inlineCandidates) {
    if (known.has(route)) continue;
    if (!routes.some((r) => isGroupedUnder(route, r.route))) continue;
    known.add(route);
    routes.push({
      route,
      wildcard: false,
      description: `documented inline on the ${parent} line`,
    });
  }

  return routes;
}

/** Is `route` the documented group parent of `candidate`? */
export function isGroupedUnder(candidate: string, parent: string): boolean {
  return candidate.startsWith(`${parent}/`);
}
