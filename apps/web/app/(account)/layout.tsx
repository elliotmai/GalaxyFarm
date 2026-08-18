import { PwaShell } from "@/app/_components/pwa-shell";

/**
 * account surface. Daylight, fixed — not `flying-auto` (spec §8 v0.9).
 *
 * Night is a working mode for people doing chores in the dark, and a customer
 * reading an invoice or a pedigree is not doing chores. This surface is also
 * the one that gets printed and shown to a buyer, where the brand's daylight
 * look is the point.
 */
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-surface="account" data-theme="flying-day">
      {children}
      <PwaShell />
    </div>
  );
}
