import { writeStorageState, type E2ERole } from "./session.js";

/**
 * Mint a session per role before the suite runs (spec §4.3).
 *
 * Three, because the surfaces are not interchangeable: an owner reaching
 * `/account` is redirected to their own home surface by the middleware, so
 * testing the customer portal with an owner's cookie would assert the redirect
 * rather than the page.
 */
const ROLES: readonly E2ERole[] = ["owner", "customer", "housesitter"];

export default async function globalSetup(): Promise<void> {
  for (const role of ROLES) {
    await writeStorageState(role);
  }
}
