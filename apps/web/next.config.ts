import type { NextConfig } from "next";

/**
 * Workspace packages are consumed as TypeScript source rather than built
 * artifacts, so Next transpiles them itself. Keeping them unbuilt is what lets
 * the domain packages stay plain TypeScript with no build step of their own.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@galaxy-farm/core", "@galaxy-farm/ui"],
  typedRoutes: false,
  eslint: {
    // Linting is a separate, blocking CI job (see .github/workflows/ci.yml);
    // running it again inside `next build` would only duplicate the work.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
