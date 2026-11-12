"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { KIOSK_BOARDS } from "@/lib/kiosk-boards";

/**
 * The board switcher, on every board.
 *
 * A board used to end in a small "← Kiosk" link, so getting from the chores to
 * the eggs was two taps through a picker. Here every board is one tap from
 * every other, and the one you are on is marked. Home is the wordmark's job.
 */
export function KioskNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Boards" className="gf-kiosk-nav">
      <Link href="/kiosk" prefetch aria-current={pathname === "/kiosk" ? "page" : undefined}>
        Home
      </Link>
      {KIOSK_BOARDS.map((board) => (
        <Link
          key={board.slug}
          href={board.route}
          prefetch
          aria-current={pathname.startsWith(board.route) ? "page" : undefined}
        >
          {board.short}
        </Link>
      ))}
    </nav>
  );
}
