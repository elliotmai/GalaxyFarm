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
    "@galaxy-farm/infra-email",
  ],
  typedRoutes: false,

  /**
   * Keep a visited route in the client router cache (spec §4.2).
   *
   * Next's default for a dynamically-rendered segment is zero: the payload
   * fetched when a link was prefetched is thrown away, and clicking that link
   * asks the server again. Every surface here is dynamic — each layout reads
   * the session — so the default meant a round trip in front of every
   * navigation, on pages that carry no server data at all. What comes back is
   * the shell around a client component; everything on it is read from
   * IndexedDB once it mounts.
   *
   * So the prefetched payload is kept, and the tap that follows renders from
   * it. Two minutes rather than something longer because the shell does carry
   * one request-shaped fact — whether there is still a session — and a
   * signed-out or revoked device should not keep drawing an admin frame for an
   * hour on the strength of a payload it fetched before.
   */
  experimental: {
    staleTimes: { dynamic: 120, static: 300 },

    /**
     * Both workspace barrels are one `export *` list deep, and the app imports
     * everything through them — `import { Card, Pill } from "@galaxy-farm/ui"`
     * asks the bundler to load the whole design system and the whole kernel to
     * find two components. It shakes back out of the production bundle, but
     * only after every module has been read and analysed, and in `next dev`
     * nothing shakes at all: the barrel is compiled and shipped whole on the
     * first request to any page that touches it.
     */
    optimizePackageImports: ["@galaxy-farm/core", "@galaxy-farm/ui"],
  },

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
