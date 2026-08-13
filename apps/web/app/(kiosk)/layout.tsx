/**
 * kiosk surface. Theme is fixed per surface (spec §8): this one renders
 * flying-day.
 *
 * Density is fixed here too, and only here. A kiosk is a known screen at a
 * known distance, pressed with a gloved hand in February — 64px targets, not
 * whatever the viewport width would have suggested. Every other surface lets
 * the viewport decide.
 */
export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-surface="kiosk" data-theme="flying-day" data-density="kiosk">
      {children}
    </div>
  );
}
