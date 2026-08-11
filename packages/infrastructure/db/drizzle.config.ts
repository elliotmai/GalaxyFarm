import { defineConfig } from "drizzle-kit";

/**
 * Migrations are plain SQL files, reviewable in a diff and applicable by any
 * Postgres — which is what makes §10's move to a box in the barn a restore
 * rather than a rewrite.
 */
export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env["DATABASE_URL"] ?? "" },
  strict: true,
  verbose: true,
});
