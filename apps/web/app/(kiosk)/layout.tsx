/**
 * kiosk surface. Theme is fixed per surface (spec §8): this one renders
 * midnight-nebula.
 */
export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-surface="kiosk" data-theme="midnight-nebula">
      {children}
    </div>
  );
}
