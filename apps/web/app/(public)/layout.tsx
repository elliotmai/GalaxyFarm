import { PwaShell } from "@/app/_components/pwa-shell";

/**
 * public surface. Daylight, fixed — not `flying-auto` (spec §8 v0.9).
 *
 * The front door. Whoever arrives here has never seen the farm before, and the
 * first impression should be the one impression rather than whichever of two
 * their laptop happened to be set to.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-surface="public" data-theme="flying-day">
      {children}
      {/* The worker is registered here too — the front door is on the same
          origin, and a visitor who signs in should not have to load the app
          twice. The install offer is not: see `PwaShell`. */}
      <PwaShell offerInstall={false} />
    </div>
  );
}
