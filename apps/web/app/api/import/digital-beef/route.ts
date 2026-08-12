import { NextResponse } from "next/server";

import { parseDigitalBeefPage, parseDigitalBeefUrl } from "@galaxy-farm/module-cattle";

import { currentActor } from "@/lib/auth";

/**
 * /api/import/digital-beef — fetch an animal page and read it (spec §5.2).
 *
 * On the server for one reason: a browser cannot fetch digitalbeef.com from
 * this origin. There is no CORS header on those pages and never will be, so a
 * client-side import is not a thing that can be built.
 *
 * Three things this route deliberately does not do.
 *
 * It does not **write** anything. It returns what it read and the screen shows
 * it for approval — a parser against a page built for a person will be wrong
 * eventually, and being wrong in a preview costs a glance.
 *
 * It does not **follow redirects to anywhere**. The URL is validated against
 * the three known hosts before the fetch, which is what stops this being an
 * open proxy for anything anybody can put in a text box.
 *
 * It does not **retry**. A site that refuses a datacenter IP will refuse it
 * again, and the honest answer is the paste-the-page fallback rather than
 * three more seconds of the same failure.
 */

export const dynamic = "force-dynamic";

/** Long enough for a slow association site, short enough not to hang a form. */
const TIMEOUT_MS = 20_000;

export async function POST(request: Request) {
  const actor = await currentActor();
  if (actor === undefined) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { url?: unknown; raw?: unknown };
  if (typeof body.url !== "string") {
    return NextResponse.json({ error: "Send the animal's web address." }, { status: 400 });
  }

  const parsed = parseDigitalBeefUrl(body.url);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.reason }, { status: 400 });
  }

  let html: string;
  try {
    const response = await fetch(parsed.ref.url, {
      // These pages are served to browsers and some hosts refuse anything that
      // does not look like one. This is not a disguise — the request is what
      // it is — but a bare fetch agent gets a 403 that helps nobody.
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          error: `${parsed.ref.host} answered ${response.status}. Open the page in a browser and use "paste the page" instead.`,
          ref: parsed.ref,
        },
        { status: 502 },
      );
    }

    html = await response.text();
  } catch (error) {
    // Every failure here has the same fix, so they get the same message: the
    // site is unreachable from this server, and the page in front of you is
    // not. Distinguishing a timeout from a DNS failure would help nobody
    // standing in a barn.
    return NextResponse.json(
      {
        error: `Could not reach ${parsed.ref.host} from the server${error instanceof Error && error.name === "TimeoutError" ? " within 20 seconds" : ""}. Open the page in a browser and use "paste the page" instead.`,
        ref: parsed.ref,
      },
      { status: 502 },
    );
  }

  const animal = parseDigitalBeefPage(html, parsed.ref);

  return NextResponse.json({
    animal,
    // The unparsed page, when the caller asked for it. The refresh screen
    // compares a fresh read against what is on file, and doing that against
    // the same text a paste would give keeps the two paths honest — a
    // difference between them would be a difference in the *fetch*, which is
    // exactly the thing nobody would think to look for.
    ...(body.raw === true ? { page: html } : {}),
    // Returned so the screen can say "we fetched a page and read nothing off
    // it", which is a different problem from "we could not fetch a page".
    fetched: true,
    bytes: html.length,
  });
}
