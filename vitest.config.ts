import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "packages/**/tests/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/.next/**", "**/dist/**", "apps/web/e2e/**"],
    environment: "node",
    // Only the design system needs a DOM. Everything else stays on node, which
    // is faster and keeps the domain honest about having no browser.
    environmentMatchGlobs: [["packages/ui/**", "jsdom"]],
    setupFiles: ["./tests/setup/dom.ts"],
    reporters: process.env["CI"] ? ["default", "github-actions"] : ["default"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      include: ["tools/**/*.ts", "packages/*/src/**/*.{ts,tsx}", "packages/*/*/src/**/*.{ts,tsx}"],
      exclude: ["**/index.ts", "**/*.d.ts", "**/tests/**"],
      // Thresholds fail the build (spec §11.1). They are deliberately set at
      // the current real coverage of the code that exists; raise them as the
      // domain packages fill in, never lower them to make a red build green.
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
});
