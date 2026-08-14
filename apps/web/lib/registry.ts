import { neo4jRegistryGraph } from "@galaxy-farm/infra-registry-graph";
import type { RegistryGraph } from "@galaxy-farm/module-cattle";

/**
 * The catalog's composition root (spec §4.1).
 *
 * The one place that reads the environment. The adapter takes its credentials
 * as arguments and knows nothing about `process.env`, which is what lets it be
 * tested twice against two different instances — and what stops a connection
 * string ending up somewhere it gets committed.
 *
 * Not being configured is a real state rather than an error: the crawl is an
 * optional extra, and every other screen on the site works without it.
 */

/** The four the adapter needs. All or nothing — three of four is not a connection. */
const NEEDED = ["NEO4J_URI", "NEO4J_USERNAME", "NEO4J_PASSWORD", "NEO4J_DATABASE"] as const;

/**
 * Which of them are not set.
 *
 * Names only, and never a value — this is on its way into an HTTP response.
 * Worth having at all because "not connected" and "you set three of the four"
 * send somebody to completely different places, and the second is by far the
 * likelier of the two once anybody has started.
 */
export function missingRegistrySettings(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return NEEDED.filter((name) => {
    const value = env[name];
    return value === undefined || value.trim() === "";
  });
}

export function registryGraph(): RegistryGraph | undefined {
  if (missingRegistrySettings().length > 0) return undefined;

  return neo4jRegistryGraph({
    url: process.env["NEO4J_URI"] as string,
    username: process.env["NEO4J_USERNAME"] as string,
    password: process.env["NEO4J_PASSWORD"] as string,
    database: process.env["NEO4J_DATABASE"] as string,
  });
}

/** What to tell somebody looking at a catalog that is not there. */
export function registryNotConfigured(): string {
  const missing = missingRegistrySettings();

  return (
    "The association catalog is not connected on this server. Everything else " +
    "on the site works without it — it is the crawled herdbooks that are " +
    `missing, not your own records. ${
      missing.length === NEEDED.length
        ? `Set all four of ${NEEDED.join(", ")} and restart.`
        : `Set ${missing.join(" and ")} — the rest is already there — and restart.`
    }`
  );
}
