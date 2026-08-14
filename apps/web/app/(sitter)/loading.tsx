import { SkeletonScreen } from "@galaxy-farm/ui";

/** The housesitter view, mid-navigation. A chore list and nothing else. */
export default function SitterLoading() {
  return <SkeletonScreen stats={0} rows={6} />;
}
