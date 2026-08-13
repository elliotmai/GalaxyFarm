import { neo4jRegistryGraph } from "@galaxy-farm/infra-registry-graph";
import type { RegistryGraph } from "@galaxy-farm/module-cattle";

/**
 * The catalogue's composition root (spec §4.1).
 *
 * The one place that reads the environment. The adapter takes its credentials
 * as arguments and knows nothing about `process.env`, which is what lets it be
 * tested twice against two different instances — and what stops a connection
 * string ending up somewhere it gets committed.
 *
 * Returns undefined when the graph is not configured, which is a real state
 * and not an error: the crawl is an optional extra, and every other screen on
 * the site works without it. Callers say "the catalogue is not set up" rather
 * than throwing five hundreds at somebody who never asked for it.
 */
export function registryGraph(): RegistryGraph | undefined {
  const url = process.env["NEO4J_URI"];
  const username = process.env["NEO4J_USERNAME"];
  const password = process.env["NEO4J_PASSWORD"];
  const database = process.env["NEO4J_DATABASE"];

  if (
    url === undefined ||
    url === "" ||
    username === undefined ||
    username === "" ||
    password === undefined ||
    password === "" ||
    database === undefined ||
    database === ""
  ) {
    return undefined;
  }

  return neo4jRegistryGraph({ url, username, password, database });
}
