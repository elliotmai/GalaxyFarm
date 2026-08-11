/**
 * admin surface. Theme is fixed per surface (spec §8): this one renders
 * midnight-nebula.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-surface="admin" data-theme="midnight-nebula">
      {children}
    </div>
  );
}
