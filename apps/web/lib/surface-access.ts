import type { Role } from "@galaxy-farm/core";

/**
 * Which roles may reach which surface (spec §4.3).
 *
 * Separated from the middleware so it can be tested without a request, a
 * session, or a Next runtime. The table is the interesting part; the
 * middleware around it is plumbing.
 *
 * This is a **surface** gate, not a permission check. It stops a housesitter
 * from loading the admin app at all. What they may do once inside a surface is
 * decided by capabilities in the application layer (§4.3), because a route
 * they cannot load is not the same as a record they cannot touch.
 */

export const SURFACES = ["admin", "kiosk", "account", "sitter"] as const;
export type Surface = (typeof SURFACES)[number];

const ACCESS: Readonly<Record<Surface, readonly Role[]>> = {
  admin: ["owner", "member"],
  kiosk: ["owner", "member", "kiosk"],
  account: ["owner", "customer"],
  sitter: ["owner", "member", "housesitter"],
};

/**
 * `owner` appears everywhere on purpose. Being unable to look at the customer
 * portal you are responsible for makes it impossible to answer "what does it
 * look like from their side", which is a question that gets asked constantly.
 */
export function mayReachSurface(role: Role, surface: Surface): boolean {
  return ACCESS[surface].includes(role);
}

export function surfaceOf(pathname: string): Surface | undefined {
  return SURFACES.find(
    (surface) => pathname === `/${surface}` || pathname.startsWith(`/${surface}/`),
  );
}

/**
 * Where to send someone who has landed somewhere they cannot be.
 *
 * Their own surface, not a 403. A housesitter who taps a stale bookmark should
 * arrive at the care guide, not at a wall — they are not doing anything wrong
 * and there is nothing for them to fix.
 */
export function homeSurfaceFor(role: Role): string {
  switch (role) {
    case "owner":
    case "member":
      return "/admin";
    case "kiosk":
      return "/kiosk";
    case "customer":
      return "/account";
    case "housesitter":
      return "/sitter";
  }
}
