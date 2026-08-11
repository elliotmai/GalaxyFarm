import baseConfig from "./packages/config/eslint.config.js";

/**
 * Root ESLint config. Package-specific layering rules live in the shared
 * preset (packages/config/eslint.config.js) because they are keyed on paths
 * that only make sense from the workspace root.
 */
export default [
  ...baseConfig,
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { React: "readonly", process: "readonly" },
    },
  },
];
