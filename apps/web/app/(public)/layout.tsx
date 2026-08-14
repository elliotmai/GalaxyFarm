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
    </div>
  );
}
