import { describe, expect, it } from "vitest";

import { appPageRoutes } from "../../../tools/routes.js";
import { listFiles, readText } from "../../../tools/workspace.js";
import { OFFLINE_ROUTE } from "../lib/sw-contract.js";

/**
 * The PWA shell, asserted as wiring rather than trusted (issue #11, spec §3).
 *
 * None of this can be caught by typecheck: the service worker is a second
 * program compiled by a bundler plugin, its precache manifest is assembled in
 * `next.config.ts`, and what it serves is decided by string URLs agreeing
 * across three files. Every failure below is silent in development and only
 * shows up on a device with no signal, which is the worst place to find one.
 */

const CONFIG = readText("apps/web/next.config.ts");
const WORKER = readText("apps/web/app/sw.ts");

/** Every surface layout — the root one is the document, not a surface. */
const surfaceLayouts = listFiles("apps/web/app", ["layout.tsx"]).filter(
  (file) => file !== "apps/web/app/layout.tsx",
);

describe("the offline fallback is on the device before it is needed", () => {
  it("is precached at the URL the worker actually serves from", () => {
    // `next.config.ts` cannot import the constant — Next loads it before any
    // path alias exists — so the two are checked against each other here. A
    // fallback precached at a URL nothing falls back to is a page nobody sees.
    expect(CONFIG).toContain(`const OFFLINE_ROUTE = "${OFFLINE_ROUTE}"`);
    expect(WORKER).toContain("OFFLINE_ROUTE");
  });

  it("adds itself to the manifest rather than replacing it", () => {
    // `additionalPrecacheEntries` *replaces* the plugin's scan of `public/`.
    // Reaching for it here would quietly drop the icons and the web app
    // manifest out of the precache, which presents as an installed app with no
    // icon the first time somebody opens it in a dead spot.
    expect(CONFIG).toContain("manifestTransforms");
    expect(CONFIG).not.toMatch(/^\s*additionalPrecacheEntries\s*:/m);
    // Everything the plugin found, and then ours.
    expect(CONFIG).toMatch(/manifest:\s*\[\s*\.\.\.entries/);
  });

  it("has a real page behind it", () => {
    expect(appPageRoutes()).toContain(OFFLINE_ROUTE);
  });

  it("renders without a session, a store, or anything else fetched", () => {
    // The one page in the app that must be renderable with the network down
    // and nothing loaded. Anything request-shaped on it would make it
    // unprerenderable, and an unprerendered fallback cannot be precached.
    const page = readText("apps/web/app/(public)/offline/page.tsx");
    expect(page).toContain('export const dynamic = "force-static"');
    expect(page).not.toMatch(/currentActor|useRecords|useSync|localStore/);
  });
});

describe("a new build does not strand a screen", () => {
  it("makes the waiting worker wait, so the client can decide when it lands", () => {
    // The acceptance criterion this whole update path exists for. Skipping the
    // wait would swap the worker under an open page whose next chunk has just
    // been swept out of the precache.
    expect(WORKER).toMatch(/skipWaiting:\s*false/);
    // And claiming is what makes `controllerchange` fire when it finally does
    // take over, which is the signal the page reloads on.
    expect(WORKER).toMatch(/clientsClaim:\s*true/);
  });

  it("is mounted on every surface", () => {
    // Not in the root layout: everything it renders needs the theme and
    // density tokens, and those are declared on the surface element. A surface
    // that forgot it would be one that never hears about a new build.
    const missing = surfaceLayouts.filter((file) => !readText(file).includes("<PwaShell"));

    expect(missing).toEqual([]);
  });

  it("applies updates by itself on exactly the screens nobody reloads", () => {
    // `unattended` is a decision about who is standing in front of the screen,
    // and the kiosk is the only surface where the answer is "nobody".
    const unattended = surfaceLayouts.filter((file) =>
      readText(file).includes("<PwaShell unattended"),
    );

    expect(unattended).toEqual(["apps/web/app/(kiosk)/layout.tsx"]);
  });
});

describe("the compiled worker is a build artifact, not a source file", () => {
  it("is kept out of the repository", () => {
    // Committing it would give every device whatever precache manifest was
    // current the last time somebody happened to build locally.
    const ignored = readText(".gitignore");
    expect(ignored).toContain("/apps/web/public/sw.js");
  });

  it("is listed as a build output, so a cached build still ships one", () => {
    // It lands outside `.next` because a worker only controls paths below its
    // own URL. Turborepo restores what it is told to restore, and a cache hit
    // that left this behind would publish an app with no worker at all.
    expect(readText("turbo.json")).toContain("public/sw.js");
  });
});

describe("the web app manifest still describes something installable", () => {
  it("is linked from the document", () => {
    expect(readText("apps/web/app/layout.tsx")).toContain('manifest: "/manifest.json"');
  });

  it("carries both an ordinary and a maskable icon at both sizes", () => {
    // Maskable is not a nicety: without one, Android puts the square icon in a
    // circle and crops the mark.
    const manifest = JSON.parse(readText("apps/web/public/manifest.json")) as {
      display: string;
      icons: Array<{ sizes: string; purpose: string }>;
    };

    expect(manifest.display).toBe("standalone");
    for (const purpose of ["any", "maskable"]) {
      for (const size of ["192x192", "512x512"]) {
        expect(
          manifest.icons.some((icon) => icon.purpose === purpose && icon.sizes === size),
          `manifest.json is missing a ${size} ${purpose} icon`,
        ).toBe(true);
      }
    }
  });
});

describe("the worker can receive a notification (§6, issue #41)", () => {
  it("handles a push, and shows something for every one", () => {
    // A `push` event that shows no notification is a "silent push", and
    // browsers answer repeated silent pushes by showing their own notice or
    // revoking the permission outright.
    expect(WORKER).toMatch(/addEventListener\("push"/);
    expect(WORKER).toContain("showNotification");
    expect(WORKER).toContain("parsePushPayload");
  });

  it("focuses a window that is already open rather than opening a second app", () => {
    // Two windows means two sync loops and somebody wondering which one is
    // real. `openWindow` is the fallback, not the first move.
    expect(WORKER).toMatch(/addEventListener\("notificationclick"/);
    expect(WORKER).toContain("matchAll");
    expect(WORKER).toContain("client.focus()");
  });

  it("leaves the caching and update policy alone", () => {
    // #35 settled both and the barn screens depend on them. Push is two extra
    // listeners on the same worker; a change here would be a change to what a
    // screen with no signal can still open.
    expect(WORKER).toContain("skipWaiting: false");
    expect(WORKER).toContain("clientsClaim: true");
    expect(WORKER).toMatch(/new NetworkOnly\(\)/);
    expect(WORKER).toContain("app-shell");
  });
});
