import Link from "next/link";

import { Logomark } from "@galaxy-farm/ui";

/**
 * The front door (spec §7, §8).
 *
 * Written for the people the boarding business will serve — somebody deciding
 * whether to send a show calf here — rather than for the family. §8 puts this
 * on Bluebonnet Linen for that reason: the dark theme is a working surface for
 * a barn at night, and a stranger's first impression of the place should be
 * daylight.
 *
 * **The admin way in is deliberately quiet.** It is a small link in the footer,
 * not a button in the header. Nothing about it is hidden — hiding it would be
 * security theatre, since `/admin` is gated by the middleware whether or not
 * anything links to it (§4.3) — but a customer reading about the farm should
 * not be offered a staff door as one of two equal choices at the top of the
 * page. The person who needs it knows it is there.
 *
 * Every claim here is deliberately about the operation rather than about
 * results. There are no client calves yet, and a landing page quoting a record
 * this farm has not set would be the one thing on it that a buyer could catch.
 */

const OFFERINGS = [
  {
    title: "Show calf boarding",
    detail:
      "Daily feeding to a plan you can see, weights on a schedule, and a photo record of how the calf is coming along.",
  },
  {
    title: "Halter breaking and daily work",
    detail:
      "Rinsed, tied, worked, and handled every day, with the week's work written down rather than remembered.",
  },
  {
    title: "Registered genetics",
    detail:
      "Maine-Anjou, Chianina and Shorthorn breeding, with papers and pedigrees kept alongside every animal.",
  },
];

const HOW_IT_WORKS = [
  {
    step: "1",
    title: "Tell us about the calf",
    detail: "Age, sex, breed, and where it is in its program.",
  },
  {
    step: "2",
    title: "We agree the plan",
    detail: "Feed, handling, and what you want the calf ready for.",
  },
  {
    step: "3",
    title: "You watch it happen",
    detail: "Your own portal: weights, feed, photos, and what was done each day.",
  },
];

export function Landing({
  farmName,
  businessName,
}: {
  readonly farmName: string;
  readonly businessName?: string | undefined;
}) {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="border-b border-edge">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-density py-4">
          <span className="flex min-w-0 items-center gap-2">
            <Logomark size="small" decorative />
            <span className="truncate font-heading text-lg font-semibold text-ink">{farmName}</span>
          </span>
          <Link
            href="/book"
            className="min-h-target rounded-density bg-action px-4 py-2 text-density font-medium text-action-ink"
          >
            Enquire
          </Link>
        </div>
      </header>

      <main className="flex flex-1 flex-col">
        <section className="mx-auto flex w-full max-w-5xl flex-col gap-density px-density py-12 sm:py-16">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted">
            Wise County, Texas
          </p>
          <h1 className="max-w-3xl font-heading text-4xl font-semibold leading-tight text-ink sm:text-5xl">
            A family cattle operation, and a place to send a show calf.
          </h1>
          <p className="max-w-2xl text-lg text-muted">
            We raise registered Maine-Anjou, Chianina and Shorthorn cattle north of Fort Worth.{" "}
            {businessName === undefined || businessName === ""
              ? "We are opening for show calf boarding and daily care."
              : `${businessName} is our show calf boarding and daily care program.`}
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Link
              href="/book"
              className="min-h-target rounded-density bg-action px-5 py-2.5 text-density font-medium text-action-ink"
            >
              Ask about boarding
            </Link>
            <Link
              href="/account"
              className="min-h-target rounded-density border border-edge px-5 py-2.5 text-density font-medium text-ink hover:border-action"
            >
              Owner sign in
            </Link>
          </div>
        </section>

        <section className="border-y border-edge bg-panel">
          <div className="mx-auto grid w-full max-w-5xl gap-density px-density py-12 md:grid-cols-3">
            {OFFERINGS.map((offering) => (
              <div key={offering.title} className="flex flex-col gap-2">
                <h2 className="font-heading text-lg font-semibold text-ink">{offering.title}</h2>
                <p className="text-muted">{offering.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto flex w-full max-w-5xl flex-col gap-density px-density py-12">
          <h2 className="font-heading text-2xl font-semibold text-ink">How it works</h2>
          <ol className="grid gap-density md:grid-cols-3">
            {HOW_IT_WORKS.map((entry) => (
              <li key={entry.step} className="flex flex-col gap-2">
                <span
                  aria-hidden
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-edge font-heading text-lg font-semibold text-action"
                >
                  {entry.step}
                </span>
                <h3 className="font-heading text-lg font-semibold text-ink">{entry.title}</h3>
                <p className="text-muted">{entry.detail}</p>
              </li>
            ))}
          </ol>
        </section>

        {/*
          `flex-1` on the closing section rather than on `main` alone. On a tall
          screen the leftover height has to land somewhere, and on `main` it
          landed *below* the last section's background — a band of bare canvas
          between a white panel and the footer that looked like a rendering
          fault. Here the slack is inside the section, so its background runs
          down to the footer however tall the window is.
        */}
        <section className="flex flex-1 flex-col border-t border-edge bg-panel">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-density py-12">
            <h2 className="font-heading text-2xl font-semibold text-ink">
              Everything written down
            </h2>
            <p className="max-w-2xl text-muted">
              Every feeding, weight, treatment and working day is recorded as it happens — from a
              phone, in the barn, with or without signal. When your calf goes home you get the
              record, not a recollection.
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-edge">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-density py-6 text-sm text-muted">
          <span>
            {farmName} · Rhome, Texas ·{" "}
            <Link href="/book" className="underline underline-offset-2 hover:text-ink">
              Get in touch
            </Link>
          </span>
          {/*
            The staff door. Small, in the footer, and last — where a site puts
            the thing that is not for the person reading it. Not hidden: the
            middleware gates `/admin` whether or not anything links to it
            (§4.3), so concealing the link would buy nothing and cost the
            person who actually needs it a typed URL every morning.
          */}
          <Link href="/admin" className="underline underline-offset-2 hover:text-ink">
            Farm login
          </Link>
        </div>
      </footer>
    </div>
  );
}
