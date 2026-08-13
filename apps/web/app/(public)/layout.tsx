/**
 * public surface. Theme is fixed per surface (spec §8): this one renders
 * flying-day.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-surface="public" data-theme="flying-day">
      {children}
    </div>
  );
}
