import { SkeletonScreen } from "@galaxy-farm/ui";

/**
 * The admin surface, mid-navigation.
 *
 * Next paints this the moment a nav item is clicked — before the route's
 * JavaScript is fetched, let alone hydrated. Without it the click produces
 * nothing visible until the server answers, which reads as a control that did
 * not work rather than as a page on its way.
 */
export default function AdminLoading() {
  return <SkeletonScreen stats={4} rows={6} />;
}
