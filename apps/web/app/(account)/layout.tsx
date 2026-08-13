/**
 * account surface. Theme is fixed per surface (spec §8): this one renders
 * flying-day.
 */
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-surface="account" data-theme="flying-day">
      {children}
    </div>
  );
}
