import { SkeletonScreen } from "@galaxy-farm/ui";

/** Landing, login and invitation pages, mid-navigation. */
export default function PublicLoading() {
  return <SkeletonScreen stats={0} rows={3} />;
}
