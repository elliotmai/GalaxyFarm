/**
 * public surface. Theme is fixed per surface (spec §8): this one renders
 * bluebonnet-linen.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-surface="public" data-theme="bluebonnet-linen">
      {children}
    </div>
  );
}
