import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Shared ESLint preset.
 *
 * The interesting part is the layer restrictions at the bottom, which encode
 * the dependency rules from spec §4.1. They are duplicated — deliberately — by
 * `tests/architecture/boundaries.test.ts`, which analyses the whole import
 * graph rather than one file at a time. Lint catches a violation while you are
 * typing it; the test catches the ones lint cannot see (module-to-module
 * cycles, transitive reach-through) and produces a better failure message.
 */

/** Layers a pure domain module is allowed to know nothing about. */
const domainForbidden = [
  {
    group: ["react", "react-dom", "react/*", "next", "next/*"],
    message: "Domain code is framework-free (spec §2). Move this to apps/web.",
  },
  {
    group: ["@galaxy-farm/infra-*"],
    message: "Domain defines ports; infrastructure implements them. Never the reverse (spec §4.1).",
  },
  { group: ["@galaxy-farm/ui"], message: "Domain code cannot import the design system (spec §2)." },
  {
    group: ["drizzle-orm", "drizzle-orm/*", "dexie", "pg", "postgres"],
    message: "Domain code cannot know about the database (spec §2).",
  },
];

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/*.d.ts",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": ["error", { allow: ["warn", "error"] }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSEnumDeclaration",
          message:
            "Use a union of string literals or a const object; enums do not survive `isolatedModules` cleanly.",
        },
      ],
    },
  },

  // ---------------------------------------------------------------------
  // Spec §4.1 dependency rules
  // ---------------------------------------------------------------------

  {
    // `modules/*/domain` imports only `core`. Nothing else. Ever.
    files: ["packages/modules/*/src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...domainForbidden,
            {
              group: ["@galaxy-farm/module-*"],
              message:
                "Modules never import each other. Communicate through IDs and domain events (spec §4.1).",
            },
            {
              group: ["**/application/**"],
              message:
                "The domain layer cannot depend on the application layer above it (spec §4.1).",
            },
          ],
        },
      ],
    },
  },

  {
    // `modules/*/application` imports its own domain + `core`.
    files: ["packages/modules/*/src/application/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...domainForbidden,
            {
              group: ["@galaxy-farm/module-*"],
              message:
                "Modules never import each other. Communicate through IDs and domain events (spec §4.1).",
            },
          ],
        },
      ],
    },
  },

  {
    // The shared kernel sits below everything and depends on none of it.
    files: ["packages/core/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...domainForbidden,
            {
              group: ["@galaxy-farm/*"],
              message: "core is the bottom of the graph; it imports nothing from the workspace.",
            },
          ],
        },
      ],
    },
  },

  {
    // Infrastructure implements ports. It must not reach into another
    // module's internals or into the UI.
    files: ["packages/infrastructure/*/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@galaxy-farm/ui"],
              message: "Infrastructure has no presentation concerns (spec §4.1).",
            },
            {
              group: ["@galaxy-farm/module-*/src/**"],
              message: "Import a module's public entry point, not its internals.",
            },
          ],
        },
      ],
    },
  },

  {
    files: [
      "**/*.config.{ts,mts,js,mjs}",
      "tools/**/*",
      "tests/**/*",
      "**/*.test.ts",
      "**/*.test.tsx",
      // CLI entry points. A migration runner that cannot say what it applied
      // is worse than one that can, and the same goes for a seed script.
      "**/src/migrate.ts",
      "**/scripts/**/*",
    ],
    rules: { "no-console": "off" },
  },
);
