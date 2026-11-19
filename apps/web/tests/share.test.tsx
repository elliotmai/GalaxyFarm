import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Tabs, ToastProvider } from "@galaxy-farm/ui";

import {
  ShareButton,
  ShareProvider,
  useShareSummary,
} from "@/app/(admin)/_components/share-button";
import { OpenInAppHint } from "@/app/_components/open-in-app-hint";
import {
  appPathFromLink,
  isAppleMobile,
  MAX_SHARE_LINES,
  requestedTabs,
  shareMessage,
  shareText,
  shareUrl,
} from "@/lib/share";

/** Sharing a screen with the household (spec §8). */

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/feed" }));

describe("the words", () => {
  it("is the title and the facts, blanks dropped", () => {
    expect(
      shareText({
        title: "Bessie · 214",
        lines: ["Cow · North Trap", undefined, "", false, "  Due Mar 3 "],
      }),
    ).toBe("Bessie · 214\nCow · North Trap\nDue Mar 3");
  });

  it("is a glance, not the page", () => {
    const lines = Array.from({ length: 20 }, (_, index) => `line ${index}`);
    expect(shareText({ title: "T", lines }).split("\n")).toHaveLength(MAX_SHARE_LINES + 1);
  });

  it("puts the link last when it is copied", () => {
    expect(shareMessage({ title: "Today" }, "https://farm.test/admin")).toBe(
      "Today\nhttps://farm.test/admin",
    );
  });
});

describe("the link back", () => {
  const here = { origin: "https://farm.test", pathname: "/admin/garden/seeds", search: "?q=1" };

  it("keeps the page and its query, and names the open tabs", () => {
    expect(shareUrl(here, ["catalog"])).toBe(
      "https://farm.test/admin/garden/seeds?q=1&tab=catalog&shared=1",
    );
  });

  it("replaces tabs a link already carried rather than piling them up", () => {
    expect(shareUrl({ ...here, search: "?tab=box" }, ["catalog", "plan"])).toBe(
      "https://farm.test/admin/garden/seeds?tab=catalog&tab=plan&shared=1",
    );
    expect(requestedTabs("?tab=catalog&tab=plan")).toEqual(["catalog", "plan"]);
  });

  it("opens a tab strip on the tab the link names", () => {
    window.history.replaceState(null, "", "/admin/garden/seeds?tab=other&tab=catalog");
    const onTabChange = vi.fn();
    render(
      <Tabs
        label="Seeds"
        activeTab="box"
        onTabChange={onTabChange}
        tabs={[
          { id: "box", label: "Seed box" },
          { id: "catalog", label: "Plants" },
        ]}
      >
        {(id) => <p>{id}</p>}
      </Tabs>,
    );
    // Through the same path as a tap, so a parent holding the state follows.
    expect(onTabChange).toHaveBeenCalledWith("catalog");
    window.history.replaceState(null, "", "/");
  });
});

describe("the button", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
  });

  function Page({ summary }: { readonly summary?: { title: string; lines: string[] } }) {
    useShareSummary(summary);
    return (
      <main>
        <h1>Feed</h1>
        <p data-share-detail>Hay, grain and what is left</p>
        <div role="tablist">
          <button role="tab" aria-selected="true" data-tab-id="plan">
            Plans
          </button>
        </div>
      </main>
    );
  }

  function view(summary?: { title: string; lines: string[] }) {
    window.history.replaceState(null, "", "/admin/feed?view=plan");
    render(
      <ToastProvider>
        <ShareProvider>
          <ShareButton variant="bar" />
          <Page summary={summary} />
        </ShareProvider>
      </ToastProvider>,
    );
  }

  it("hands the page's own summary and a link to this tab to the share sheet", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    view({ title: "Feeding today", lines: ["☐ Morning feed · Herd ration — 40 lb hay"] });

    await userEvent.click(screen.getByRole("button", { name: "Share this screen" }));

    expect(share).toHaveBeenCalledWith({
      title: "Feeding today",
      text: "Feeding today\n☐ Morning feed · Herd ration — 40 lb hay",
      url: `${window.location.origin}/admin/feed?view=plan&tab=plan&shared=1`,
    });
  });

  it("shares the heading and the line under it on a page that said nothing", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    view();

    await userEvent.click(screen.getByRole("button", { name: "Share this screen" }));

    expect(share.mock.calls[0]?.[0]).toMatchObject({
      title: "Feed",
      text: "Feed\nHay, grain and what is left",
    });
  });

  it("copies the words and the link where there is no share sheet, and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    view();

    await userEvent.click(screen.getByRole("button", { name: "Share this screen" }));

    expect(writeText).toHaveBeenCalledWith(
      `Feed\nHay, grain and what is left\n${window.location.origin}/admin/feed?view=plan&tab=plan&shared=1`,
    );
    expect(await screen.findByText(/Copied/)).toBeInTheDocument();
  });

  it("says nothing when the share sheet is closed without sharing", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("closed", "AbortError"));
    const writeText = vi.fn();
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    view();

    await userEvent.click(screen.getByRole("button", { name: "Share this screen" }));

    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByText(/Copied|Could not/)).not.toBeInTheDocument();
  });
});

describe("getting a shared link into the installed app", () => {
  it("reads the screen out of a pasted link, or the whole shared message", () => {
    expect(appPathFromLink("https://farm.test/admin/feed?tab=plan&shared=1")).toBe(
      "/admin/feed?tab=plan",
    );
    expect(
      appPathFromLink(
        "Feeding today\n☐ Morning feed\nhttps://farm.test/admin/feed?tab=today&shared=1.",
      ),
    ).toBe("/admin/feed?tab=today");
    expect(appPathFromLink("/admin/garden/seeds")).toBe("/admin/garden/seeds");
  });

  it("only ever opens a screen of this app, whatever host the link names", () => {
    expect(appPathFromLink("https://evil.test/admin/feed")).toBe("/admin/feed");
    expect(appPathFromLink("https://farm.test/login")).toBeUndefined();
    expect(appPathFromLink("Bessie")).toBeUndefined();
    expect(appPathFromLink("https://farm.test/administrator")).toBeUndefined();
  });

  it("knows an iPhone, and an iPad that says it is a Mac", () => {
    expect(
      isAppleMobile({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }),
    ).toBe(true);
    expect(
      isAppleMobile({
        userAgent: "Mozilla/5.0 (Macintosh)",
        platform: "MacIntel",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
    expect(isAppleMobile({ userAgent: "Mozilla/5.0 (Linux; Android 15)" })).toBe(false);
  });

  it("says what to do in Safari on an iPhone, only for a shared link", async () => {
    const ua = vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone)");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    window.history.replaceState(null, "", "/admin/feed?tab=plan&shared=1");
    const { unmount } = render(<OpenInAppHint />);
    expect(await screen.findByRole("note", { name: "Open in the app" })).toHaveTextContent(
      /paste it into Search/,
    );
    await userEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/admin/feed?tab=plan&shared=1`,
    );
    unmount();

    // Somebody just browsing the site is not asked about an app.
    window.history.replaceState(null, "", "/admin/feed");
    render(<OpenInAppHint />);
    expect(screen.queryByRole("note", { name: "Open in the app" })).not.toBeInTheDocument();

    ua.mockRestore();
    window.history.replaceState(null, "", "/");
  });
});
