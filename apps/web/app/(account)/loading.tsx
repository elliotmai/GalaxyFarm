import { SkeletonScreen } from "@galaxy-farm/ui";

/** The customer portal, mid-navigation. Fewer tiles than admin; it shows less. */
export default function AccountLoading() {
  return <SkeletonScreen stats={2} rows={4} />;
}
