/**
 * sitter surface. Theme is fixed per surface (spec §8): this one renders
 * bluebonnet-linen.
 */
export default function SitterLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-surface="sitter" data-theme="bluebonnet-linen">
      {children}
    </div>
  );
}
