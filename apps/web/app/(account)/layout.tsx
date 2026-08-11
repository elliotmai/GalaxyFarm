/**
 * account surface. Theme is fixed per surface (spec §8): this one renders
 * bluebonnet-linen.
 */
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-surface="account" data-theme="bluebonnet-linen">
      {children}
    </div>
  );
}
