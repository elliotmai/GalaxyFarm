import { SkeletonScreen } from "@galaxy-farm/ui";

/**
 * The barn screen, mid-navigation.
 *
 * Fewer, larger rows than the other surfaces: at kiosk density a row is 64px
 * of touch target, so six of them is already most of the screen.
 */
export default function KioskLoading() {
  return <SkeletonScreen stats={0} rows={4} />;
}
