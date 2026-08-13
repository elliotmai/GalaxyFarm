/**
 * sitter surface. Theme is fixed per surface (spec §8): this one renders
 * flying-day.
 */
export default function SitterLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-surface="sitter" data-theme="flying-day">
      {children}
    </div>
  );
}
