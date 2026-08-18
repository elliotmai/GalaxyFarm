import { randomUUID } from "node:crypto";

import withSerwistInit from "@serwist/next";
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

/**
 * The offline fallback the service worker serves for an uncached document.
 *
 * The literal, not an import: Next loads this file before any path alias
 * exists, so `@/lib/sw-contract` cannot be reached from here. `OFFLINE_ROUTE`
 * there is the same string, and `apps/web/tests/pwa-wiring.test.ts` fails if the
 * two ever stop agreeing — a fallback precached at a URL the worker does not
 * serve from would be a page nobody ever sees.
 */
const OFFLINE_ROUTE = "/offline";

/**
 * A fresh revision every build, on purpose.
 *
 * The offline page is precached by URL, and the HTML behind that URL names this
 * build's content-hashed chunks. Pinning the revision to something stable would
 * leave a device holding a fallback page that asks for JavaScript three deploys
 * old, which 404s at the exact moment there is no network to recover with. A
 * new value per build means the page is refetched whenever anything ships, and
 * the cost of that is one small HTML document.
 */
const buildRevision = randomUUID();

/**
 * Serwist (spec §3), which compiles `app/sw.ts` into `public/sw.js` and hands
 * it the manifest of everything this build emitted.
 *
 * Off in development. The worker's job is to serve a build from cache, and a
 * build that changes on every keystroke is the one thing that should not be
 * cached — a stale chunk served to a hot-reloading page presents as an app that
 * has quietly stopped responding to edits.
 */
const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",

  /**
   * Registered by `app/_components/pwa-shell.tsx` instead.
   *
   * Serwist's own registration script is a fine default and takes the update
   * decision out of our hands, which is the one part of this that issue #11
   * asks to be deliberate: a barn screen has to end up on the new build without
   * anybody walking out to reload it, and a phone must not reload under
   * somebody's thumb. That policy needs a component, so registration lives with
   * it.
   */
  register: false,

  /**
   * Add the offline page to the manifest the plugin builds.
   *
   * A transform rather than `additionalPrecacheEntries`, which *replaces* the
   * plugin's scan of `public/` — passing the offline page there would silently
   * drop the icons and the web app manifest out of the precache, and an
   * installed app whose icon 404s offline is a subtle way to lose exactly what
   * this work is for.
   */
  manifestTransforms: [
    (entries) => ({
      manifest: [
        ...entries,
        // `size` is what the plugin adds up to report how much it precached.
        // The page has not been rendered at this point in the build, so there
        // is no honest number to give it; zero understates the total by one
        // small HTML document rather than inventing one.
        { url: OFFLINE_ROUTE, revision: buildRevision, size: 0 },
      ],
      warnings: [],
    }),
  ],
});

export default withSerwist(nextConfig);
