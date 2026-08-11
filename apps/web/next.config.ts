import type { NextConfig } from "next";

/**
 * Workspace packages are consumed as TypeScript source rather than built
 * artifacts, so Next transpiles them itself. Keeping them unbuilt is what lets
 * the domain packages stay plain TypeScript with no build step of their own.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@galaxy-farm/core",
    "@galaxy-farm/ui",
    "@galaxy-farm/infra-auth",
    "@galaxy-farm/infra-db",
  ],
  typedRoutes: false,
  eslint: {
    // Linting is a separate, blocking CI job (see .github/workflows/ci.yml);
    // running it again inside `next build` would only duplicate the work.
    ignoreDuringBuilds: true,
  },
  webpack: (config) => {
    // The packages write `./thing.js` in their imports, which is what ESM
    // requires and what Node resolves. Webpack does not map that back to the
    // `.ts` file on disk unless told to, so importing any workspace package
    // from the app fails at `Can't resolve './types/index.js'`.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
